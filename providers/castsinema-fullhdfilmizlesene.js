/* SPDX-License-Identifier: GPL-3.0-only
 * CastSinema FullHDFilmizlesene native HTML/JS scraper for CastSinema.
 * Scrapes Turkish dubbed movies from FullHDFilmizlesene.
 *
 * Flow: TMDB id -> IMDb id -> /arama/<imdb> -> /film/<slug>/ -> scx sources.
 * The site hides its embed URLs inside the inline `scx` object as ROT13 +
 * base64; both are reversed here without executing any page script.
 */
"use strict";
// --- request layer ---------------------------------------------------------
// Most of these sites sit behind Cloudflare, which refuses requests whose
// client looks like a bot. The plugin runtime bridges fetch to a native HTTP
// client, and the profile that client sends by default is turned away by
// several of these sites with 403 Forbidden. Sending a browser profile
// usually gets through; when it does not, the next profile is tried.
var UA_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
var UA_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";
var UA_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0";
var UA_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15";
var UA_MEDIA = "VLC/3.0.21 LibVLC/3.0.21";
var ACCEPT_HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
var ACCEPT_LANG = "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7";

// Headers that describe the request itself and must survive a profile swap.
var KEEP_HEADERS = ["Referer", "Origin", "Cookie", "X-Requested-With", "X-CSRF-TOKEN", "X-CSRF-Token", "X-Api-Key", "X-Cap-Token", "X-Fingerprint-Lite", "Content-Type", "Authorization"];

function requestProfiles() {
  return [
    { "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 13; SM-G998B Build/TP1A.220624.014)", "Accept": "*/*" },
    { "User-Agent": "okhttp/4.9.2", "Accept": "*/*" },
    { "User-Agent": "ExoPlayerLib/2.19.1", "Accept": "*/*" },
    { "User-Agent": "stagefright/1.2 (Linux;Android 11)", "Accept": "*/*" },
    { "User-Agent": "VLC/3.0.21 LibVLC/3.0.21", "Accept": "*/*" },
    { "User-Agent": UA_CHROME, "Accept": ACCEPT_HTML, "Accept-Language": ACCEPT_LANG, "Upgrade-Insecure-Requests": "1", "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none", "Sec-Fetch-User": "?1" },
    { "User-Agent": UA_FIREFOX, "Accept": ACCEPT_HTML, "Accept-Language": ACCEPT_LANG, "Upgrade-Insecure-Requests": "1" },
    { "User-Agent": UA_EDGE, "Accept": ACCEPT_HTML, "Accept-Language": ACCEPT_LANG, "Upgrade-Insecure-Requests": "1", "Sec-Ch-Ua": "\"Chromium\";v=\"139\", \"Not;A=Brand\";v=\"24\"", "Sec-Ch-Ua-Mobile": "?0", "Sec-Ch-Ua-Platform": "\"Windows\"" },
    { "User-Agent": UA_SAFARI, "Accept": ACCEPT_HTML, "Accept-Language": ACCEPT_LANG },
    { "User-Agent": UA_MEDIA, "Accept": "*/*" },
    { "Accept": "*/*" }
  ];
}

function mergeHeaders(base, profile) {
  var headers = {};
  var key;
  for (key in base) {
    if (!Object.prototype.hasOwnProperty.call(base, key)) continue;
    if (KEEP_HEADERS.indexOf(key) !== -1) headers[key] = base[key];
  }
  for (key in profile) {
    if (!Object.prototype.hasOwnProperty.call(profile, key)) continue;
    headers[key] = profile[key];
  }
  return headers;
}

function isRefused(response) {
  if (!response) return true;
  if (typeof response.status !== "number") return false;
  return response.status === 403 || response.status === 503;
}

// fetch with a browser profile, retrying with another profile when the site
// answers with a bot refusal.
function netFetch(url, options) {
  options = options || {};
  var base = options.headers || {};
  var profiles = requestProfiles();
  var attempt = 0;

  function next() {
    if (attempt >= profiles.length) {
      return fetch(url, { method: options.method || "GET", headers: mergeHeaders(base, profiles[profiles.length - 1]), body: options.body });
    }
    var profile = profiles[attempt++];
    return fetch(url, {
      method: options.method || "GET",
      headers: mergeHeaders(base, profile),
      body: options.body
    }).then(function (response) {
      if (!isRefused(response)) return response;
      return next();
    }).catch(function (error) {
      if (attempt >= profiles.length) throw error;
      return next();
    });
  }

  return next();
}
// --- end request layer -----------------------------------------------------


var HOSTS = ["https://www.fullhdfilmizlesene.cx", "https://www.fullhdfilmizlesene.de", "https://www.fullhdfilmizlesene.net", "https://www.fullhdfilmizlesene.now", "https://fullhdfilmizlesene.pro"];
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

// --- encoding helpers ------------------------------------------------------

// Same ROT13 variant the site applies to its encoded values.
function rot13(value) {
  return String(value || "").replace(/[a-z]/gi, function (c) {
    return String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < "n" ? 13 : -13));
  });
}

function decodeBase64(value) {
  var text = String(value || "");
  if (!text) return "";
  try {
    if (typeof atob === "function") return atob(text);
  } catch (_) {}
  try {
    if (typeof Buffer !== "undefined") return Buffer.from(text, "base64").toString("utf8");
  } catch (_) {}
  return "";
}

// "v2." values are reversed, base64url encoded and XOR masked with the
// hostname. Plain values are ROT13 + base64.
function isPlayableUrl(u) {
  if (!u) return false;
  var s = String(u);
  if (!/^https?:\/\//i.test(s)) return false;
  return /\.m3u8(\?|$)/i.test(s) || /\.mp4(\?|$)/i.test(s) || /\/hls\/|playlist\.m3u8|master\.m3u8/i.test(s);
}
function guessFormat(u) { return /\.mp4(\?|$)/i.test(String(u || "")) ? "mp4" : "m3u8"; }
function originOf(u) { var m = String(u || "").match(/^(https?:\/\/[^\/]+)/i); return m ? m[1] : ""; }
function extractMediaFromHtml(html, baseUrl) {
  var text = String(html || "").replace(/\\\//g, "/");
  var found = [], seen = {};
  function push(u) {
    if (!u) return;
    var v = String(u).replace(/&amp;/g, "&").replace(/\\u0026/g, "&").trim();
    if (!isPlayableUrl(v) || seen[v]) return;
    seen[v] = true;
    found.push(v);
  }
  var m, re = /(https?:\/\/[^\s"'<>\\]+(?:\.m3u8|\.mp4|\/master\.m3u8|\/playlist\.m3u8)[^\s"'<>\\]*)/gi;
  while ((m = re.exec(text))) push(m[1]);
  var patterns = [/file\s*:\s*["']([^"']+)["']/gi,/source\s*:\s*["']([^"']+)["']/gi,/src\s*:\s*["']([^"']+)["']/gi,/"file"\s*:\s*"([^"]+)"/gi,/"url"\s*:\s*"([^"]+)"/gi,/"hls"\s*:\s*"([^"]+)"/gi];
  for (var i = 0; i < patterns.length; i++) {
    re = patterns[i];
    while ((m = re.exec(text))) {
      var val = m[1];
      if (val && val.charAt(0) === "/" && /^https?:\/\//i.test(baseUrl || "")) {
        var o = originOf(baseUrl); if (o) val = o + val;
      }
      push(val);
    }
  }
  return found;
}
function resolvePlayable(url, referer, depth) {
  if (depth == null) depth = 0;
  if (!url) return Promise.resolve([]);
  if (isPlayableUrl(url)) return Promise.resolve([url]);
  if (depth > 1) return Promise.resolve([]);
  return netFetch(url, { headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": referer || "" } })
    .then(function (r) { return r && r.ok ? r.text() : ""; })
    .then(function (body) {
      if (!body) return [];
      var found = extractMediaFromHtml(body, url);
      if (!found.length && depth < 1) {
        var iframe = /<iframe[^>]+(?:data-src|src)=["']([^"']+)["']/i.exec(body);
        if (iframe && iframe[1]) {
          var next = iframe[1];
          if (/^\/\//.test(next)) next = "https:" + next;
          else if (next.charAt(0) === "/") { var o2 = originOf(url); if (o2) next = o2 + next; }
          if (/^https?:\/\//i.test(next) && next !== url) return resolvePlayable(next, url, depth + 1);
        }
      }
      return found;
    }).catch(function () { return []; });
}

function decodeSource(value, host) {
  var text = String(value || "");
  if (!text) return "";
  if (text.indexOf("v2.") !== 0) return decodeBase64(rot13(text));
  try {
    var s = text.slice(3).split("").reverse().join("").replace(/-/g, "+").replace(/_/g, "/");
    s += "===".slice((s.length + 3) % 4);
    var bytes = decodeBase64(s);
    var key = String(host || "").replace(/^www\./, "") + "|fmx";
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      out += String.fromCharCode(
        bytes.charCodeAt(i) ^ key.charCodeAt((i * 7 + bytes.length) % key.length) ^ ((i * 13 + 31) & 255)
      );
    }
    return out;
  } catch (_) {
    return "";
  }
}

// Pulls a balanced JSON object that follows a marker in the markup.
function extractJsonObject(text, marker) {
  var at = String(text || "").indexOf(marker);
  if (at < 0) return null;
  var start = String(text).indexOf("{", at);
  if (start < 0) return null;
  var depth = 0, inString = false, escaped = false;
  for (var i = start; i < text.length; i++) {
    var ch = text.charAt(i);
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { depth++; continue; }
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

// The page carries every playable source in `var scx = {...}`.
function parseSources(html, host) {
  var data = extractJsonObject(html, "scx");
  if (!data || typeof data !== "object") return [];
  var out = [];
  for (var key in data) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    var entry = data[key];
    if (!entry || !entry.sx) continue;
    var label = decodeBase64(entry.tt || "");
    var lists = [];
    if (entry.sx.t) lists = lists.concat(entry.sx.t);
    if (entry.sx.p) lists = lists.concat(entry.sx.p);
    for (var i = 0; i < lists.length; i++) {
      var url = decodeSource(lists[i], host);
      if (url && /^https?:\/\//i.test(url)) {
        out.push({ url: url, source: label || "Kaynak", key: key });
      }
    }
  }
  return out;
}

// --- site helpers ----------------------------------------------------------

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[ıİ]/g, "i").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g")
    .replace(/[çÇ]/g, "c").replace(/[öÖ]/g, "o").replace(/[üÜ]/g, "u")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getMediaInfo(tmdbId, isTv) {
  var path = isTv ? "/tv/" : "/movie/";
  var url = TMDB_API + path + encodeURIComponent(String(tmdbId)) +
    "?api_key=" + encodeURIComponent(TMDB_KEY) + "&language=tr-TR&append_to_response=external_ids";
  return netFetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (info) {
      if (!info) return null;
      var external = info.external_ids || {};
      return {
        title: info.title || info.name || info.original_title || info.original_name || "",
        imdbId: info.imdb_id || external.imdb_id || null
      };
    })
    .catch(function () { return null; });
}

// The search endpoint lives at /arama/<term>; it also accepts an IMDb id.
function searchSite(host, query) {
  return netFetch(host + "/arama/" + encodeURIComponent(query), {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Referer": host + "/" }
  })
    .then(function (r) { return r.ok ? r.text() : ""; })
    .catch(function () { return ""; });
}

// Each result is an <li class="film"> whose poster path carries the IMDb id.
function findFilmUrl(html, imdbId, title) {
  var blocks = String(html || "").split(/<li\b/i).slice(1);
  var normalized = normalizeText(title);
  var titleMatch = null;
  var anyMatch = null;
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i].split(/<\/li>/i)[0];
    if (!/class="[^"]*\bfilm\b/i.test(block)) continue;
    var anchor = /<a[^>]*href="([^"]+)"[^>]*>/i.exec(block);
    if (!anchor) continue;
    var href = anchor[1];
    if (!/\/film\//i.test(href)) continue;
    if (imdbId && block.indexOf(imdbId) !== -1) return href;
    if (!anyMatch) anyMatch = href;
    if (!titleMatch && normalized) {
      var heading = /class="film-title"[^>]*>([^<]*)</i.exec(block);
      if (heading && normalizeText(heading[1]) === normalized) titleMatch = href;
    }
  }
  return titleMatch || anyMatch;
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  var isTv = mediaType === "tv" && season != null && episode != null;
  // The site is movie only.
  if (isTv) return Promise.resolve([]);

  return getMediaInfo(tmdbId, false).then(function (info) {
    var title = info && info.title ? info.title : "";
    var imdbId = info && info.imdbId ? info.imdbId : null;
    var terms = imdbId ? [imdbId, title] : [title || String(tmdbId)];
    return { title: title, imdbId: imdbId, terms: terms, index: 0, html: "" };
  }).then(function (ctx) {
    if (!ctx || !ctx.terms.length) return [];

    function attempt() {
      if (ctx.index >= ctx.terms.length) return Promise.resolve(null);
      var term = ctx.terms[ctx.index++];
      if (!term) return attempt();
      return tryHosts(term, ctx).then(function (result) {
        return result || attempt();
      });
    }
    return attempt();
  }).then(function (ctx) {
    if (!ctx || !ctx.html) return [];

    var itemUrl = findFilmUrl(ctx.html, ctx.imdbId, ctx.title);
    if (!itemUrl) return [];

    return netFetch(itemUrl, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Referer": ctx.host + "/" }
    })
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (pageHtml) {
        if (!pageHtml) return [];
        var sources = parseSources(pageHtml, ctx.host);
        var seen = {};
        var tasks = [];
        for (var i = 0; i < sources.length; i++) {
          (function (source) {
            if (!source || !source.url || seen[source.url]) return;
            seen[source.url] = true;
            tasks.push(resolvePlayable(source.url, itemUrl, 0).then(function (mediaUrls) {
              var urls = (mediaUrls && mediaUrls.length) ? mediaUrls : [];
              // if resolver couldn't extract but URL already playable-like was handled; if still empty, skip unplayable embed
              var out = [];
              for (var j = 0; j < urls.length && j < 2; j++) {
                var murl = urls[j];
                var fmt = guessFormat(murl);
                out.push({
                  name: "CastSinema • FullHDFilmizlesene",
                  title: "FullHDFilmizlesene • " + (ctx.title || "Film") + " • " + (source.source || "Kaynak") + (fmt === "m3u8" ? " • HLS" : " • MP4"),
                  url: murl,
                  quality: 1080,
                  provider: "castsinema-fullhdfilmizlesene",
                  format: fmt,
                  headers: { "User-Agent": UA, "Referer": source.url, "Origin": originOf(source.url) || ctx.host },
                  behaviorHints: { notWebReady: true, proxyHeaders: { request: { "User-Agent": UA, "Referer": source.url } } }
                });
              }
              return out;
            }).catch(function () { return []; }));
          })(sources[i]);
        }
        return Promise.all(tasks).then(function (lists) {
          var flat = [];
          var dedupe = {};
          for (var k = 0; k < lists.length; k++) {
            var list = lists[k] || [];
            for (var m = 0; m < list.length; m++) {
              if (!list[m] || dedupe[list[m].url]) continue;
              dedupe[list[m].url] = true;
              flat.push(list[m]);
            }
          }
          return flat;
        });
      });
  })
    .catch(function (error) {
      console.error("[CastSinema FullHDFilmizlesene] " + (error && error.message ? error.message : String(error)));
      return [];
    });

  // Tries every configured mirror for a search term.
  function tryHosts(term, ctx) {
    var index = 0;
    function next() {
      if (index >= HOSTS.length) return Promise.resolve(null);
      var host = HOSTS[index++];
      return searchSite(host, term).then(function (html) {
        if (!html) return next();
        ctx.host = host;
        return { html: html, host: host, title: ctx.title, imdbId: ctx.imdbId };
      }).catch(function () { return next(); });
    }
    return next();
  }
}

module.exports = { getStreams: getStreams };
