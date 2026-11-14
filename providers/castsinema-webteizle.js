/* SPDX-License-Identifier: MIT
 * CastSinema Webteizle provider.
 * Turkish film/series scraper for Webteizle (webteizle.info).
 *
 * Verified flow (live site, 2026-11): /filtre?a= (win1254) -> player iframe
 *   -> vidmoly / streamruby / ok.ru / pixel -> master m3u8 + VTT.
 * Flow logic adapted from the working BigBull CS Nuvio addon (MIT).
 */
"use strict";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
var BASE = "https://webteizle.info";
var HOSTS = ["vidmoly", "streamruby", "ok.ru", "pixel"];
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";

function text(url, opts) {
  var o = opts || {};
  var headers = { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9" };
  if (o.referer) headers.Referer = o.referer;
  if (o.headers) for (var k in o.headers) headers[k] = o.headers[k];
  return fetch(url, { method: o.method || "GET", headers: headers, body: o.body })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
      return r.text();
    });
}

function form(url, body, referer) {
  return text(url, {
    method: "POST",
    referer: referer,
    body: body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "application/json, text/javascript, */*; q=0.01"
    }
  });
}

function first(pattern, body) {
  var m = pattern.exec(String(body || ""));
  return m ? m[1] : null;
}

function abs(base, href) {
  if (!href) return null;
  if (/^https?:/i.test(href)) return href;
  if (String(href).indexOf("//") === 0) return "https:" + href;
  var origin = /^(https?:\/\/[^/]+)/.exec(base);
  if (href.charAt(0) === "/") return origin ? origin[1] + href : href;
  return base.replace(/[^/]*$/, "") + href;
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function slugify(s) {
  var map = { "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u" };
  return String(s || "")
    .toLowerCase()
    .replace(/[çğışöü]/g, function (c) { return map[c] || c; })
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function langOf(label) {
  var s = String(label || "").toLowerCase();
  if (/t[üu]rk|^tr$/.test(s)) return "tr";
  if (/eng|^en$/.test(s)) return "en";
  return "";
}

function titleOf(id, mediaType) {
  var path = mediaType === "tv" ? "/tv/" : "/movie/";
  return text(TMDB_API + path + encodeURIComponent(String(id)) + "?api_key=" + TMDB_KEY + "&language=tr-TR")
    .then(function (body) {
      var meta = JSON.parse(body) || {};
      return String(meta.title || meta.name || meta.original_title || meta.original_name || "").trim();
    })
    .catch(function () { return ""; });
}

var WIN1254 = {
  "ç": "%E7", "Ç": "%C7", "ğ": "%F0", "Ğ": "%D0",
  "ı": "%FD", "İ": "%DD", "ö": "%F6", "Ö": "%D6",
  "ş": "%FE", "Ş": "%DE", "ü": "%FC", "Ü": "%DC"
};

function encodeWin1254(s) {
  return encodeURIComponent(String(s || "")).replace(/(?:%[0-9A-F]{2})+/gi, function (m) {
    try {
      var dec = decodeURIComponent(m);
      var out = "";
      for (var i = 0; i < dec.length; i++) {
        var ch = dec.charAt(i);
        out += WIN1254[ch] || encodeURIComponent(ch);
      }
      return out;
    } catch (e) {
      return m;
    }
  });
}

function filmOf(page, slug) {
  var id = first(/id="wip"[^>]*data-id="(\d+)"/, page) || first(/data-id="(\d+)"[^>]*id="wip"/, page);
  return id ? { id: id, slug: slug } : null;
}

function detail(title) {
  var slug = slugify(title);
  // A direct slug guess can fail (404 or a Cloudflare interstitial) without the
  // real search being broken, so the filter search below always runs.
  return text(BASE + "/hakkinda/" + slug)
    .then(function (page) { return filmOf(page, slug); })
    .catch(function () { return null; })
    .then(function (hit) {
      if (hit) return hit;
      return text(BASE + "/filtre?a=" + encodeWin1254(title)).then(function (list) {
        var links = [];
        var re = /href="\/hakkinda\/([^"?]+)"/g;
        var m;
        while ((m = re.exec(String(list || ""))) !== null) {
          if (links.indexOf(m[1]) === -1) links.push(m[1]);
        }
        if (!links.length) return null;
        var want = norm(title);
        var pick = null;
        for (var i = 0; i < links.length; i++) {
          if (norm(links[i]) === want) { pick = links[i]; break; }
        }
        if (!pick) return null;
        return text(BASE + "/hakkinda/" + pick).then(function (page2) {
          return filmOf(page2, pick);
        });
      });
    })
    .catch(function (e) {
      console.error("[CastSinema Webteizle] " + (e && e.message ? e.message : String(e)));
      return null;
    });
}

function alts(filmId, dil, s, b, referer) {
  var body = "filmid=" + filmId + "&dil=" + dil + "&s=" + (s || "") + "&b=" + (b || "") + "&bot=0";
  return form(BASE + "/ajax/dataAlternatif3.asp", body, referer).then(function (raw) {
    var json;
    try { json = JSON.parse(raw); } catch (e) { return []; }
    return (json && json.data) || [];
  });
}

function rank(item) {
  var name = String((item || {}).baslik || "").toLowerCase();
  for (var i = 0; i < HOSTS.length; i++) if (name.indexOf(HOSTS[i]) !== -1) return i;
  return HOSTS.length;
}

function unhex(s) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(s)) return "";
  var out = "";
  for (var i = 0; i < s.length; i += 2) out += String.fromCharCode(parseInt(s.substr(i, 2), 16));
  return out;
}

function linkOf(raw) {
  var value = String(raw || "").replace(/\\\//g, "/");
  if (/^https?:/i.test(value)) return value;
  var decoded = unhex(value);
  return /^https?:/i.test(decoded) ? decoded : "";
}

function vtts(page) {
  var out = [];
  var re = /\{[^{}]*file\s*:\s*["']([^"']+\.vtt[^"']*)["'][^{}]*\}/g;
  var m;
  while ((m = re.exec(String(page || ""))) !== null) {
    var chunk = m[0];
    if (/thumbnail/i.test(chunk)) continue;
    var kind = first(/kind\s*:\s*["']([^"']+)["']/, chunk);
    if (kind && !/caption|subtitle/i.test(kind)) continue;
    var label = first(/label\s*:\s*["']([^"']+)["']/, chunk);
    var url = linkOf(m[1]);
    if (!url) continue;
    out.push({ url: url, language: langOf(label), name: String(label || "Altyazi") + " [webteizle]" });
  }
  return out;
}

function playable(page) {
  var raw = first(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/, page) ||
    first(/file\s*:\s*["']([^"']+)["']/, page);
  if (!raw) return null;
  var url = linkOf(raw);
  if (!url) return null;
  return { url: url, subs: vtts(page), label: first(/label\s*:\s*["']([^"']+)["']/, page) };
}

function heightOf(playlist) {
  var best = 0;
  var re = /RESOLUTION=\d+x(\d+)/g;
  var m;
  while ((m = re.exec(String(playlist || ""))) !== null) {
    var height = parseInt(m[1], 10) || 0;
    if (height > best) best = height;
  }
  return best;
}

function okru(id) {
  return text("https://ok.ru/dk?cmd=videoPlayerMetadata&mid=" + encodeURIComponent(id), {
    method: "POST",
    headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 13)", "Referer": "https://ok.ru/", "Accept": "application/json" }
  }).then(function (body) {
    var list = JSON.parse(body).videos || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (!v || v.disallowed) continue;
      if (/^mobile$/i.test(String(v.name || ""))) continue;
      var url = String(v.url || "").replace(/\\\//g, "/");
      if (!/^https?:/.test(url)) continue;
      out.push({ url: url, quality: String(v.name || "auto"), hls: /\.m3u8/i.test(url) });
    }
    return out;
  });
}

function row(url, quality, subs, dubbing, hls, referer) {
  var label = (dubbing ? " • TR Dublaj" : "") + (subs.length ? " • Altyazılı" : "");
  var hdrs = { "User-Agent": UA };
  if (referer) hdrs.Referer = referer;
  return {
    name: "CastSinema • Webteizle",
    title: "Webteizle • " + quality + (hls ? " [HLS]" : " [MP4]") + label,
    url: url,
    quality: quality,
    provider: "castsinema-webteizle",
    format: hls ? "m3u8" : "mp4",
    headers: hdrs,
    behaviorHints: { notWebReady: true, proxyHeaders: { request: hdrs } },
    subtitles: subs
  };
}

var PLAYER_PATHS = {
  "vidmoly": "/player/vidmoly.asp?v=",
  "ok.ru": "/player/ok.ru.asp?v=",
  "okru": "/player/ok.ru.asp?v=",
  "pixel": "/player/pixel.asp?v=",
  "dzen": "/player/dzen.asp?v=",
  "mail.ru": "/player/video-mail-ru.asp?v=",
  "mailru": "/player/video-mail-ru.asp?v="
};

function jobOf(html, referer) {
  if (!html || /reCAPTCHADATA/i.test(html)) return null;
  var direct = first(/vidUrl\s*=\s*"([^"]+)"/, html);
  if (direct) return { kind: "mp4", url: abs(BASE + "/", direct), hls: /\.m3u8/i.test(direct) };
  var call = /<script[^>]*>\s*(\w+)\('([^']+)'/.exec(html);
  if (call) {
    var fn = call[1];
    var vid = call[2];
    if (fn === "vidmoly") return { kind: "page", url: "https://vidmoly.net/embed-" + vid + ".html", referer: referer };
    if (fn === "sruby") return { kind: "page", url: "https://rubyvidhub.com/embed-" + vid + ".html", referer: referer };
    if (fn === "okru") return { kind: "okru", id: vid };
    if (fn === "pixel") return { kind: "mp4", url: "https://pixeldrain.com/api/file/" + String(vid).split("|")[0] };
    return null;
  }
  var frame = first(/<iframe[^>]+src="([^"]+)"/, html);
  if (!frame) return null;
  var url = abs(BASE + "/", frame);
  if (!url || /\/ajax\/reCAPTCHADATA/i.test(url)) return null;
  var vp = first(/[?&]v=([^&"']+)/, url);
  if (vp && /\/player\/vidmoly\.asp/i.test(url)) return { kind: "page", url: "https://vidmoly.net/embed-" + vp + ".html", referer: url };
  if (vp && /\/player\/ok\.ru\.asp/i.test(url)) return { kind: "okru", id: vp };
  if (vp && /\/player\/pixel\.asp/i.test(url)) return { kind: "mp4", url: "https://pixeldrain.com/api/file/" + vp.split("|")[0] };
  return { kind: "page", url: url, referer: BASE + "/" };
}

function play(job, dubbing) {
  if (job.kind === "okru") {
    return okru(job.id).then(function (videos) {
      var out = [];
      for (var i = 0; i < videos.length; i++) out.push(row(videos[i].url, videos[i].quality, [], dubbing, videos[i].hls));
      return out;
    });
  }
  if (job.kind === "mp4") {
    if (/pixeldrain\.com/i.test(job.url)) {
      return fetch(job.url, { headers: { "User-Agent": UA, Range: "bytes=0-0" } })
        .then(function (r) { return r.ok ? [row(job.url, "auto", [], dubbing, Boolean(job.hls))] : []; })
        .catch(function () { return []; });
    }
    return Promise.resolve([row(job.url, "auto", [], dubbing, Boolean(job.hls))]);
  }
  return text(job.url, { referer: job.referer, headers: { "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate" } }).then(function (page) {
    var hit = playable(page);
    if (!hit) return [];
    var tagged = /(\d{3,4})p/.exec(String(hit.label || ""));
    var fallback = tagged ? tagged[1] + "p" : "auto";
    return text(hit.url, { referer: job.url })
      .then(function (master) {
        var height = heightOf(master);
        return [row(hit.url, height ? height + "p" : fallback, hit.subs, dubbing, true, job.url)];
      })
      .catch(function () {
        return [row(hit.url, fallback, hit.subs, dubbing, true, job.url)];
      });
  });
}

function resolveRow(item, referer) {
  return form(BASE + "/ajax/dataEmbed.asp", "id=" + item.id, referer)
    .then(function (html) { return jobOf(html, referer); })
    .catch(function () { return null; })
    .then(function (job) {
      if (job) return job;
      var path = PLAYER_PATHS[String(item.baslik || "").toLowerCase().trim()];
      if (!path) return null;
      return text(BASE + path + item.id, { referer: referer })
        .then(function (html2) { return jobOf(html2, referer); })
        .catch(function () { return null; });
    });
}

function tryHosts(list, i, dubbing, referer) {
  if (i >= list.length || rank(list[i]) >= HOSTS.length) return Promise.resolve([]);
  return resolveRow(list[i], referer)
    .then(function (job) {
      return job ? play(job, dubbing) : [];
    })
    .then(function (rows) {
      return rows.length ? rows : tryHosts(list, i + 1, dubbing, referer);
    })
    .catch(function () {
      return tryHosts(list, i + 1, dubbing, referer);
    });
}

function attempt(info, dil, s, b) {
  if (dil > 1) return Promise.resolve([]);
  var watch = BASE + "/izle/" + (dil ? "altyazi" : "dublaj") + "/" + info.slug + (s ? "/" + s + "-sezon-" + b + "-bolum" : "");
  return alts(info.id, dil, s, b, watch)
    .then(function (list) {
      list.sort(function (a, b2) { return rank(a) - rank(b2); });
      return tryHosts(list, 0, dil === 0, watch);
    })
    .then(function (rows) {
      return rows.length ? rows : attempt(info, dil + 1, s, b);
    })
    .catch(function () {
      return attempt(info, dil + 1, s, b);
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var tv = mediaType === "tv" || mediaType === "series";
  var s = tv ? String(parseInt(season, 10) || 1) : "";
  var b = tv ? String(parseInt(episode, 10) || 1) : "";
  return titleOf(tmdbId, mediaType)
    .then(function (title) {
      if (!title) return null;
      return detail(title).then(function (info) {
        return info ? attempt(info, 0, s, b) : [];
      });
    })
    .catch(function (e) {
      console.error("[CastSinema Webteizle] " + (e && e.message ? e.message : String(e)));
      return [];
    });
}

module.exports = { getStreams: getStreams };
