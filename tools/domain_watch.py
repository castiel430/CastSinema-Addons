"""Domain watchdog for the CastSinema provider set.

Scans every provider for a moved or expired domain, runs the provider against
the live site, rewrites the host constant when a working domain is found, and
writes a Markdown report.

    python tools/domain_watch.py              # scan, test and report
    python tools/domain_watch.py --fix        # also rewrite the provider files
    python tools/domain_watch.py --provider castsinema-filmmakinesi
    python tools/domain_watch.py --commit     # commit and push the fixes

The scan does three things per provider:

1. **Discovery** - builds candidate domains from the site name plus a list of
   common TLDs, resolves them and probes the ones that resolve.
2. **Validation** - a candidate counts as the real site only when it answers
   200 and the page contains the provider's marker string.
3. **Live test** - the actual provider JavaScript is executed against the live
   site through a TLS impersonating proxy, so the test covers the real code
   path rather than a re-implementation of it.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tls_proxy import TlsProxy  # noqa: E402

try:
    from curl_cffi import requests as curl_requests
except ImportError:
    curl_requests = None

REPO_ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = REPO_ROOT / "tools"
CONFIG_PATH = TOOLS_DIR / "providers.json"
REPORT_DIR = REPO_ROOT / "reports"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
)

# TLDs worth probing when a site moves. Kept deliberately short: every entry
# costs one DNS lookup plus one HTTP request per provider.
COMMON_TLDS = [
    "to", "co", "com", "net", "org", "tv", "cc", "pro", "io", "app", "live",
    "me", "xyz", "fun", "site", "online", "icu", "biz", "info", "club", "life",
    "ltd", "world", "space", "website", "cfd", "sbs",
]


# ---------------------------------------------------------------------------
# domain helpers
# ---------------------------------------------------------------------------

def probe(url: str, marker: str, timeout: int = 20) -> dict:
    """Probes a host.

    `reachable` means the host answered at all - a 404 or a 403 still proves
    the domain is alive. Only `marker_found` identifies it as the right site.
    The live provider test is what decides whether a provider actually works.
    """
    if curl_requests is None:
        return {"reachable": False, "ok": False, "status": 0, "marker_found": False, "error": "curl_cffi missing"}
    try:
        response = curl_requests.get(
            url,
            impersonate="chrome",
            timeout=timeout,
            headers={"User-Agent": UA, "Accept": "text/html,*/*"},
            allow_redirects=True,
        )
    except Exception as exc:
        return {"reachable": False, "ok": False, "status": 0, "marker_found": False, "error": f"{type(exc).__name__}: {exc}"[:160]}

    body = response.text or ""
    marker_found = marker.lower() in body.lower() if marker else True
    return {
        "reachable": True,
        "ok": response.status_code == 200,
        "status": response.status_code,
        "marker_found": marker_found,
        "length": len(body),
        "error": "",
    }


def discover_domains(base: str, www: bool, marker: str, workers: int = 12) -> list[str]:
    """Looks for a moved domain: resolves candidates in parallel, then probes
    the ones that resolved."""
    names = [base]
    if base.startswith("www."):
        names.append(base[4:])
    elif www:
        names.insert(0, "www." + base)
    else:
        names.append("www." + base)

    candidates: list[str] = []
    for name in names:
        stem = name[4:] if name.startswith("www.") else name
        for tld in COMMON_TLDS:
            candidates.append(f"{stem}.{tld}")

    def probe_host(domain: str) -> tuple[str, dict]:
        host = f"https://{domain}"
        return host, probe(host + "/", marker, timeout=12)

    found: list[str] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for host, result in pool.map(probe_host, candidates):
            if result.get("reachable") and result.get("marker_found"):
                found.append(host)
                # the same site may answer on several domains; keep them all
    return found


# ---------------------------------------------------------------------------
# provider file rewriting
# ---------------------------------------------------------------------------

def read_hosts(provider_file: Path, host_var: str, host_style: str) -> list[str]:
    code = provider_file.read_text(encoding="utf-8")
    if host_style == "list":
        match = re.search(
            rf"var\s+{re.escape(host_var)}\s*=\s*\[([^\]]*)\]", code
        )
        if not match:
            return []
        return re.findall(r'"(https?://[^"]+)"', match.group(1))
    match = re.search(
        rf"var\s+{re.escape(host_var)}\s*=\s*['\"](https?://[^'\"]+)['\"]", code
    )
    return [match.group(1)] if match else []


def write_hosts(provider_file: Path, host_var: str, host_style: str, hosts: list[str]) -> bool:
    """Rewrites the host constant. Returns True when the file changed."""
    code = provider_file.read_text(encoding="utf-8")
    original = code

    if host_style == "list":
        literal = ", ".join(f'"{h}"' for h in hosts)
        pattern = re.compile(rf"var\s+{re.escape(host_var)}\s*=\s*\[[^\]]*\]")
        replacement = f"var {host_var} = [{literal}]"
    else:
        pattern = re.compile(
            rf"var\s+{re.escape(host_var)}\s*=\s*['\"]https?://[^'\"]+['\"]"
        )
        replacement = f"var {host_var} = \"{hosts[0]}\""

    code, count = pattern.subn(replacement, code, count=1)
    if count == 0 or code == original:
        return False
    provider_file.write_text(code, encoding="utf-8")
    return True


# ---------------------------------------------------------------------------
# live provider test
# ---------------------------------------------------------------------------

def run_provider_test(provider_file: Path, proxy_port: int, case: dict) -> dict:
    command = [
        "node",
        str(TOOLS_DIR / "run_provider.mjs"),
        str(provider_file),
        str(proxy_port),
        str(case["tmdbId"]),
        case["type"],
        str(case.get("season", "")),
        str(case.get("episode", "")),
    ]
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=120, cwd=str(REPO_ROOT)
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "node harness timed out", "count": 0, "streams": []}

    output = (result.stdout or "").strip().splitlines()
    for line in reversed(output):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except ValueError:
                continue
    return {
        "ok": False,
        "error": (result.stderr or "no output")[:300],
        "count": 0,
        "streams": [],
    }


def proxy_requests(proxy_port: int) -> list[dict]:
    """The requests the provider made during the last test."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{proxy_port}/log", timeout=10) as response:
            return json.loads(response.read().decode("utf-8")).get("entries", [])
    except Exception:
        return []


def reset_proxy_log(proxy_port: int) -> None:
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{proxy_port}/log/reset", data=b"{}", method="POST"
        )
        urllib.request.urlopen(request, timeout=10).read()
    except Exception:
        pass


def summarise_requests(entries: list[dict], limit: int = 6) -> str:
    """Human readable summary of what the provider tried."""
    if not entries:
        return "no requests were made"
    lines = []
    for entry in entries[-limit:]:
        status = entry.get("status", 0)
        url = entry.get("url", "")
        if status >= 200 and status < 300:
            marker = "ok"
        elif status == 0:
            marker = "ERR"
        else:
            marker = str(status)
        lines.append(f"{marker} {url[:110]}")
    return " | ".join(lines)[:400]


# ---------------------------------------------------------------------------
# per provider workflow
# ---------------------------------------------------------------------------

@dataclass
class ProviderResult:
    key: str
    file: str
    status: str = "unknown"
    current_hosts: list[str] = field(default_factory=list)
    live_hosts: list[str] = field(default_factory=list)
    streams: int = 0
    stream_urls: list[str] = field(default_factory=list)
    duration_ms: int = 0
    note: str = ""
    changed: bool = False
    requests: list[dict] = field(default_factory=list)

    def as_row(self) -> str:
        icon = {"ok": "OK", "fixed": "FIXED", "broken": "FAIL", "unknown": "?"}.get(self.status, "?")
        hosts = ", ".join(h.replace("https://", "") for h in (self.live_hosts or self.current_hosts)) or "-"
        streams = str(self.streams) if self.streams else "0"
        return f"| {icon} | `{self.key}` | {hosts} | {streams} | {self.note[:90]} |"


def check_provider(key: str, config: dict, proxy_port: int, fix: bool) -> ProviderResult:
    provider_file = REPO_ROOT / config["file"]
    result = ProviderResult(key=key, file=config["file"])
    started = time.time()

    if not provider_file.exists():
        result.status = "broken"
        result.note = "provider file missing"
        return result

    current = read_hosts(provider_file, config["hostVar"], config["hostStyle"])
    result.current_hosts = current
    if not current:
        result.status = "broken"
        result.note = f"could not read {config['hostVar']}"
        return result

    # 1. probe the domains the provider already knows about. A host counts as
    #    present when it answers at all - the live test below is the verdict.
    working: list[str] = []
    for host in current:
        probe_result = probe(host + "/", config.get("marker", ""))
        if probe_result["reachable"]:
            working.append(host)

    # 2. discover replacements when none of the known hosts answers
    if not working:
        working = discover_domains(
            config["base"], config.get("www", False), config.get("marker", "")
        )

    result.live_hosts = working or current

    # 3. run the real provider against the live site
    case = config["test"]
    reset_proxy_log(proxy_port)
    test_result = run_provider_test(provider_file, proxy_port, case)
    requests = proxy_requests(proxy_port)
    result.streams = int(test_result.get("count") or 0)
    result.stream_urls = [s.get("url", "") for s in (test_result.get("streams") or [])][:3]

    if result.streams > 0:
        result.status = "ok"
        result.note = "streams resolved"
    else:
        result.status = "broken"
        detail = (test_result.get("error") or "").strip()
        summary = summarise_requests(requests)
        result.note = (detail + " :: " + summary if detail else summary)[:300]
        result.requests = requests

    # 4. rewrite the host constant when a different domain is needed
    if working and current and working[0] != current[0]:
        if fix and write_hosts(provider_file, config["hostVar"], config["hostStyle"], working):
            result.changed = True
            result.status = "fixed"
            result.note = f"{current[0]} -> {working[0]}"
        else:
            result.status = "fixed" if not fix else result.status
            result.note = f"suggest {working[0]} (run with --fix)"

    result.duration_ms = int((time.time() - started) * 1000)
    return result


# ---------------------------------------------------------------------------
# report + git
# ---------------------------------------------------------------------------

def write_report(results: list[ProviderResult], changed: list[ProviderResult]) -> Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d")
    path = REPORT_DIR / f"domain-watch-{stamp}.md"

    working = [r for r in results if r.status == "ok"]
    broken = [r for r in results if r.status == "broken"]
    fixed = [r for r in results if r.status == "fixed"]

    lines = [
        "# Domain watchdog report",
        "",
        f"- Generated: {time.strftime('%Y-%m-%d %H:%M:%S')} UTC",
        f"- Providers checked: **{len(results)}**",
        f"- Working: **{len(working)}** · Fixed: **{len(fixed)}** · Failing: **{len(broken)}**",
        "",
        "| | Provider | Live host(s) | Streams | Note |",
        "|---|---|---|---|---|",
    ]
    lines += [r.as_row() for r in results]
    lines += [
        "",
        "## Failing providers",
        "",
    ]
    if broken:
        for r in broken:
            lines.append(f"### `{r.key}`")
            lines.append("")
            lines.append(f"- Current hosts: {', '.join(r.current_hosts) or '-'}")
            lines.append(f"- Note: {r.note}")
            if r.requests:
                lines.append("- Requests:")
                for entry in r.requests[-8:]:
                    status = entry.get("status", 0)
                    lines.append(f"  - `{status}` {entry.get('url', '')[:130]}")
            lines.append("")
    else:
        lines.append("None.")
        lines.append("")
    lines += [
        "## Changes applied",
        "",
    ]
    if changed:
        for r in changed:
            lines.append(f"- `{r.file}`: {r.note}")
    else:
        lines.append("None.")
    lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def commit_and_push(results: list[ProviderResult]) -> bool:
    changed = [r for r in results if r.changed]
    if not changed:
        return False
    try:
        subprocess.run(["git", "add", "-A"], cwd=str(REPO_ROOT), check=True)
        message = "chore: update provider hosts after domain scan"
        subprocess.run(["git", "commit", "-m", message], cwd=str(REPO_ROOT), check=True)
        subprocess.run(["git", "push"], cwd=str(REPO_ROOT), check=True)
    except subprocess.CalledProcessError as exc:
        print(f"git failed: {exc}", file=sys.stderr)
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan the provider domains and fix what moved.")
    parser.add_argument("--fix", action="store_true", help="rewrite provider files when a host changed")
    parser.add_argument("--commit", action="store_true", help="commit and push the rewrites")
    parser.add_argument("--provider", action="append", default=[], help="limit the scan to these providers")
    parser.add_argument("--report", default="", help="path of the Markdown report to write")
    args = parser.parse_args()

    if curl_requests is None:
        print("curl_cffi is required: pip install -r tools/requirements.txt", file=sys.stderr)
        return 2

    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if args.provider:
        wanted = set(args.provider)
        config = {k: v for k, v in config.items() if k in wanted}
        if not config:
            print(f"no provider matched {args.provider}", file=sys.stderr)
            return 2

    results: list[ProviderResult] = []
    with TlsProxy() as proxy:
        print(f"TLS proxy on 127.0.0.1:{proxy.port}")
        for key, entry in config.items():
            result = check_provider(key, entry, proxy.port, args.fix)
            results.append(result)
            flag = {"ok": "ok", "fixed": "fixed", "broken": "FAIL", "unknown": "??"}[result.status]
            print(f"  {flag:<6} {key:<28} {result.streams} stream(s)  {result.note[:60]}")

    changed = [r for r in results if r.changed]
    report_path = Path(args.report) if args.report else write_report(results, changed)
    print(f"\nreport: {report_path}")

    if args.commit and changed:
        if commit_and_push(results):
            print(f"pushed {len(changed)} provider update(s)")

    broken = [r for r in results if r.status == "broken"]
    return 1 if broken else 0


if __name__ == "__main__":
    raise SystemExit(main())
