// One-shot GitHub bootstrap for this repository.
//
//   GITHUB_TOKEN=<token> node scripts/github-setup.mjs [repo-name]
//
// Does everything that is needed to publish the addon:
//   1. creates the repository (if it does not exist yet)
//   2. points the local git remote at it
// 3. patches manifest.json + docs with the real repository coordinates
//   4. pushes main
//   5. verifies that every published file is reachable over raw.githubusercontent
//
// The token is read from the GITHUB_TOKEN environment variable and is never
// written to disk. It is passed to git through a temporary HTTP header, so it
// does not end up in .git/config either.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const API = 'https://api.github.com';

const token = process.env.GITHUB_TOKEN || resolveGhToken();
if (!token) {
  console.error('No GitHub credentials found.');
  console.error('Either set the GITHUB_TOKEN environment variable, or run: gh auth login');
  console.error('Token scope: fine-grained token with "Administration: write" and "Contents: write".');
  process.exit(1);
}

const authHeaders = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'castsinema-setup',
  Authorization: `Bearer ${token}`,
};

// Fall back to the GitHub CLI's own credentials when GITHUB_TOKEN is unset,
// so `gh auth login` is enough to run this script.
function resolveGhToken() {
  const result = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  if (result.status !== 0) return '';
  return (result.stdout || '').trim();
}

async function api(pathname, options = {}) {
  const response = await fetch(`${API}${pathname}`, { ...options, headers: { ...authHeaders, ...(options.headers || {}) } });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: response.status, data, ok: response.ok };
}

function git(args, extraEnv = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return (result.stdout || '').trim();
}

// Basic auth header for git over HTTPS, so the token never touches disk.
const gitAuth = Buffer.from(`x-access-token:${token}`).toString('base64');
const gitEnv = { GIT_TERMINAL_PROMPT: '0' };

// ---------------------------------------------------------------------------
// 1. Who am I?
// ---------------------------------------------------------------------------
const me = await api('/user');
if (!me.ok) {
  console.error(`Token rejected by GitHub: ${me.status} ${me.data?.message || ''}`);
  process.exit(1);
}
const login = me.data.login;
console.log(`Authenticated as ${login}`);

const repoName = process.argv[2] || 'castsinema-addons';
const fullName = `${login}/${repoName}`;

// ---------------------------------------------------------------------------
// 2. Create the repository (idempotent).
// ---------------------------------------------------------------------------
let repo = await api(`/repos/${fullName}`);
if (repo.status === 404) {
  console.log(`Creating repository ${fullName}...`);
  repo = await api('/user/repos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: repoName,
      description: 'CastSinema - Turkish content scraper addons for Stremio / CastSinema.',
      private: false,
      auto_init: false,
      has_issues: true,
      has_projects: false,
      has_wiki: false,
    }),
  });
  if (!repo.ok) {
    console.error(`Could not create ${fullName}: ${repo.status} ${repo.data?.message || ''}`);
    process.exit(1);
  }
  console.log(`Created ${repo.data.html_url}`);
} else if (repo.ok) {
  console.log(`Repository ${fullName} already exists (${repo.data.html_url})`);
} else {
  console.error(`Unexpected response for ${fullName}: ${repo.status}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Patch the repository coordinates into the manifest and docs.
// ---------------------------------------------------------------------------
console.log('Patching repository coordinates...');
const setRepo = spawnSync(process.execPath, [path.join(here, 'set-repo.mjs'), login, repoName], {
  cwd: repoRoot,
  encoding: 'utf8',
});
if (setRepo.status !== 0) {
  console.error(setRepo.stderr || setRepo.stdout);
  process.exit(1);
}
process.stdout.write(setRepo.stdout || '');

// ---------------------------------------------------------------------------
// 4. Point the remote at GitHub and push.
// ---------------------------------------------------------------------------
const remoteUrl = `https://github.com/${fullName}.git`;
const remotes = git(['remote']).split('\n').filter(Boolean);
if (remotes.includes('origin')) {
  git(['remote', 'set-url', 'origin', remoteUrl]);
} else {
  git(['remote', 'add', 'origin', remoteUrl]);
}
console.log(`Remote origin -> ${remoteUrl}`);

const header = `AUTHORIZATION: basic ${gitAuth}`;
const status = git(['-c', `http.extraheader=${header}`, 'status', '--porcelain']);
if (status) {
  console.log('Committing coordinate changes...');
  git(['add', '-A']);
  git(['commit', '-m', `chore: set repository coordinates to ${fullName}`]);
}
git(['-c', `http.extraheader=${header}`, 'push', '-u', 'origin', 'main'], gitEnv);
console.log(`Pushed main -> ${fullName}`);

// ---------------------------------------------------------------------------
// 5. Verify that everything is reachable AND serves the expected content.
//
// A status-code check alone is not enough: raw.githubusercontent serves stale
// CDN copies of a branch for a short while after a push, and a 200 response
// would happily mask that. The commit-pinned URL is always fresh, so it is
// used as the source of truth and the branch URL is compared against it.
// ---------------------------------------------------------------------------
console.log('\nVerifying published files...');
const rawBase = `https://raw.githubusercontent.com/${login}/${repoName}/main`;
const sha = git(['rev-parse', 'HEAD']);
const pinnedBase = `https://raw.githubusercontent.com/${login}/${repoName}/${sha}`;
const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'manifest.json'), 'utf8'));

const checks = [
  ['manifest.json', `${rawBase}/manifest.json`],
  ['assets/logo.png', `${rawBase}/assets/logo.png`],
  ...manifest.scrapers.map(s => [s.filename, `${rawBase}/${s.filename}`]),
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;

for (const [label, branchUrl] of checks) {
  const local = await fs.readFile(path.join(repoRoot, label));
  const localHash = createHash('sha256').update(local).digest('hex');

  // 1. The pinned URL must match the local file byte for byte.
  const pinnedUrl = `${pinnedBase}/${label}`;
  let pinnedHash = '';
  for (let attempt = 0; attempt < 6 && !pinnedHash; attempt++) {
    const response = await fetch(pinnedUrl);
    if (response.ok) {
      const body = Buffer.from(await response.arrayBuffer());
      pinnedHash = createHash('sha256').update(body).digest('hex');
      if (pinnedHash !== localHash) break; // served, but wrong content
    } else {
      await sleep(2500);
    }
  }
  if (!pinnedHash) {
    console.log(`  FAIL  ${label} (not published)`);
    failed += 1;
    continue;
  }
  if (pinnedHash !== localHash) {
    console.log(`  FAIL  ${label} (published content differs from local)`);
    failed += 1;
    continue;
  }

  // 2. The branch URL may lag behind the CDN; retry until it catches up.
  let branchOk = false;
  for (let attempt = 0; attempt < 10 && !branchOk; attempt++) {
    const response = await fetch(`${branchUrl}?cb=${Date.now()}`);
    if (response.ok) {
      const body = Buffer.from(await response.arrayBuffer());
      branchOk = createHash('sha256').update(body).digest('hex') === localHash;
    }
    if (!branchOk) await sleep(6000);
  }
  console.log(`  ${branchOk ? 'OK  ' : 'OK* '}  ${label}${branchOk ? '' : '  (pinned OK, branch URL still cached)'}`);
}

// ---------------------------------------------------------------------------
// 6. Report.
// ---------------------------------------------------------------------------
console.log('\n--- Install URL ---');
console.log(`${rawBase}/manifest.json`);
console.log('\n--- Repo ---');
console.log(`  ${repo.data.html_url}`);
console.log(`  Actions: ${repo.data.html_url}/actions`);
console.log(`  Settings: ${repo.data.html_url}/settings`);

if (failed) {
  console.log(`\n${failed} file(s) not reachable yet. GitHub's CDN may need a moment - re-run to verify.`);
  process.exit(1);
}
console.log('\nAll published files are reachable.');
