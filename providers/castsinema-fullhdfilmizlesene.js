/* SPDX-License-Identifier: MIT
 * CastSinema FullHDFilmizlesene provider.
 * Turkish dubbed movie scraper for FullHDFilmizlesene.
 *
 * Verified flow (live site, 2026-11):
 *   TMDB id -> IMDb id
 *   -> GET /arama/<imdb id|title> -> result list
 *   -> film page -> inline `scx` object (ROT13 + base64 / v2 variant)
 *   -> player page (rapidvid) -> encoded manifest -> HLS master + subtitles
 *
 * Cloudflare guards the site, so requests are retried with different client
 * profiles; the mobile/player profiles are the ones the site answers.
 */
"use strict";

var HOSTS = ["https://www.fullhdfilmizlesene.now", "https://fullhdfilmizlesene.pro"];
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
var UA_CLIENT = "okhttp/4.9.2";

// --- request layer ---------------------------------------------------------
function profileHeaders(ua) {
  return { "User-Agent": ua, "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7" };
}
function requestProfiles() {
  return [
    profileHeaders(UA_CLIENT),
    profileHeaders("ExoPlayerLib/2.19.1"),
    profileHeaders("stagefright/1.2 (Linux;Android 11)"),
    profileHeaders("VLC/3.0.21 LibVLC/3.0.21"),
    profileHeaders("Dalvik/2.1.0 (Linux; U; Android 13; SM-G998B Build/TP1A.220624.014)"),
    profileHeaders(UA),
    profileHeaders("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"),
    profileHeaders("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0"),
    profileHeaders("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15"),
    {}
  ];
}
var KEEP_HEADERS = ["accept", "referer", "origin", "range", "cookie", "content-type", "x-requested-with"];
function mergeHeaders(base, profile) {
  var headers = {}, key;
  for (key in base) {
    if (!Object.prototype.hasOwnProperty.call(base, key)) continue;
    if (KEEP_HEADERS.indexOf(String(key).toLowerCase()) === -1) continue;
    headers[key] = base[key];
  }
  for (key in profile) { if (Object.prototype.hasOwnProperty.call(profile, key)) headers[key] = profile[key]; }
  return headers;
}
function isRefused(response) {
  if (!response) return true;
  if (typeof response.status !== "number") return false;
  return response.status === 403 || response.status === 404 || response.status === 429 || response.status === 503;
}
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
    return fetch(url, { method: options.method || "GET", headers: mergeHeaders(base, profile), body: options.body }).then(function (response) {
      if (!isRefused(response)) return response;
      return next();
    }).catch(function (error) {
      if (attempt >= profiles.length) throw error;
      return next();
    });
  }
  return next();
}
function getText(url, headers) {
  return netFetch(url, { headers: headers || { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*" } })
    .then(function (r) { return r && r.ok ? r.text() : ""; })
    .catch(function () { return ""; });
}
function getJson(url, headers) {
  return netFetch(url, { headers: headers || { "User-Agent": UA, "Accept": "application/json" } })
    .then(function (r) { return r && r.ok ? r.json() : null; })
    .catch(function () { return null; });
}

// --- encoding helpers ------------------------------------------------------
function rot13(value) {
  return String(value || "").replace(/[a-z]/gi, function (c) {
    return String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < "n" ? 13 : -13));
  });
}
function b64Decode(value) {
  var t = String(value || "").replace(/[\r\n\t =]+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out = "";
  for (var i = 0; i < t.length; i += 4) {
    var a = chars.indexOf(t.charAt(i));
    var b = i + 1 < t.length ? chars.indexOf(t.charAt(i + 1)) : -1;
    var c = i + 2 < t.length ? chars.indexOf(t.charAt(i + 2)) : -1;
    var d = i + 3 < t.length ? chars.indexOf(t.charAt(i + 3)) : -1;
    if (a === -1 || b === -1) break;
    out += String.fromCharCode((a << 2) | (b >> 4));
    if (c !== -1) {
      out += String.fromCharCode(((b & 15) << 4) | (c >> 2));
      if (d !== -1) out += String.fromCharCode(((c & 3) << 6) | d);
    }
  }
  return out;
}
function b64Encode(value) {
  var input = String(value || "");
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var output = "", i = 0;
  while (i < input.length) {
    var c1 = input.charCodeAt(i++);
    var c2 = input.charCodeAt(i++);
    var c3 = input.charCodeAt(i++);
    var e1 = c1 >> 2;
    var e2 = ((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4);
    var e3 = isNaN(c2) ? 64 : (((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6));
    var e4 = isNaN(c3) ? 64 : (c3 & 63);
    output += chars.charAt(e1) + chars.charAt(e2) + (e3 === 64 ? "=" : chars.charAt(e3)) + (e4 === 64 ? "=" : chars.charAt(e4));
  }
  return output;
}
function decodeBase64ToText(value) {
  var raw = b64Decode(value);
  try {
    // Re-encode to keep the byte values intact for non-ASCII payloads.
    var escaped = "";
    for (var i = 0; i < raw.length; i++) escaped += "%" + ("00" + raw.charCodeAt(i).toString(16)).slice(-2);
    return decodeURIComponent(escaped);
  } catch (_) {
    return raw;
  }
}

// --- site helpers ----------------------------------------------------------
function foldTurkish(s) {
  var map = { "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g", "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c" };
  var out = String(s || "").replace(/[ıİşŞğĞüÜöÖçÇ]/g, function (c) { return map[c] || c; }).toLowerCase();
  try { out = out.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return out;
}
function normalizeTitle(s) { return foldTurkish(s).replace(/[^a-z0-9]+/g, ""); }
function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, " ").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim(); }
function originOf(u) { var m = String(u || "").match(/^(https?:\/\/[^\/]+)/i); return m ? m[1] : ""; }

function getMediaInfo(tmdbId) {
  return getJson(TMDB_API + "/movie/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_KEY + "&language=tr-TR&append_to_response=external_ids,translations");
}

function collectTitles(info) {
  var titles = [];
  function add(v) {
    var s = String(v || "").trim();
    if (!s) return;
    var n = normalizeTitle(s);
    for (var i = 0; i < titles.length; i++) if (normalizeTitle(titles[i]) === n) return;
    titles.push(s);
  }
  if (!info) return titles;
  add(info.title);
  add(info.original_title);
  var tr = (info.translations && info.translations.translations) || [];
  for (var i = 0; i < tr.length; i++) {
    if (!tr[i] || tr[i].iso_639_1 !== "tr") continue;
    add(tr[i].data && tr[i].data.title);
  }
  return titles;
}

function searchSite(host, query) {
  var url = host + "/arama/" + encodeURIComponent(query).replace(/%20/g, "+");
  return getText(url, { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": host + "/" })
    .then(function (html) {
      if (!html) return [];
      var out = [];
      var re = /<li class="film">([\s\S]*?)<\/li>/gi;
      var m;
      while ((m = re.exec(html))) {
        var block = m[1];
        var href = /<a class="tt" href="([^"]+)"/i.exec(block);
        if (!href) href = /<a[^>]*href="([^"]*\/film\/[^"]+)"[^>]*class="tt"/i.exec(block);
        if (!href) continue;
        var title = /class="film-title">([^<]*)/i.exec(block);
        var year = /class="film-yil">(\d{4})</i.exec(block);
        out.push({
          url: href[1],
          title: title ? stripTags(title[1]) : "",
          year: year ? year[1] : "",
          block: block
        });
        if (out.length >= 20) break;
      }
      return out;
    });
}

function pickResult(results, titles, imdbId) {
  var best = null, bestScore = 0;
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (!r || !r.url) continue;
    var score = 0;
    if (imdbId && r.block && r.block.indexOf(imdbId) !== -1) score += 100;
    var nc = normalizeTitle(r.title);
    for (var j = 0; j < titles.length; j++) {
      var nt = normalizeTitle(titles[j]);
      if (!nt || !nc) continue;
      if (nc === nt) score = Math.max(score, 90);
      else if (nc.indexOf(nt) !== -1 || nt.indexOf(nc) !== -1) score = Math.max(score, 70);
    }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  if (!best) return results.length ? results[0] : null;
  return best;
}

// The page hides every playable source inside the inline `scx` object.
function parseSources(html, host) {
  var text = String(html || "").replace(/\\\//g, "/");
  var at = text.indexOf("scx");
  if (at < 0) return [];
  var start = text.indexOf("{", at);
  if (start < 0) return [];
  var depth = 0, inString = false, escaped = false;
  var data = null;
  for (var i = start; i < text.length; i++) {
    var ch = text.charAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { depth++; continue; }
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { data = JSON.parse(text.slice(start, i + 1)); } catch (_) { data = null; }
        break;
      }
    }
  }
  if (!data || typeof data !== "object") return [];
  var out = [];
  for (var key in data) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    var entry = data[key];
    if (!entry || !entry.sx) continue;
    var label = decodeBase64ToText(entry.tt || "");
    var lists = [];
    if (entry.sx.t) lists = lists.concat(entry.sx.t);
    if (entry.sx.p) lists = lists.concat(entry.sx.p);
    for (var k = 0; k < lists.length; k++) {
      var url = decodeSource(lists[k], host);
      if (url && /^https?:\/\//i.test(url)) out.push({ url: url, source: label || "Kaynak" });
    }
  }
  return out;
}

// "v2." values are reversed + base64url + XOR masked; plain values are ROT13 + base64.
function decodeSource(value, host) {
  var text = String(value || "");
  if (!text) return "";
  if (text.indexOf("v2.") !== 0) return decodeBase64ToText(rot13(text));
  try {
    var s = text.slice(3).split("").reverse().join("").replace(/-/g, "+").replace(/_/g, "/");
    s += "===".slice((s.length + 3) % 4);
    var bytes = b64Decode(s);
    var key = String(host || "").replace(/^www\./, "") + "|fmx";
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      out += String.fromCharCode(bytes.charCodeAt(i) ^ key.charCodeAt((i * 7 + bytes.length) % key.length) ^ ((i * 13 + 31) & 255));
    }
    return out;
  } catch (_) {
    return "";
  }
}

// The player page hides the manifest with a rotated base64 chain.
function decodeManifest(value) {
  try {
    var reversed = String(value || "").split("").reverse().join("");
    var t = b64Decode(reversed);
    var out = "";
    for (var i = 0; i < t.length; i++) {
      var r = "K9L".charAt(i % 3);
      out += String.fromCharCode(t.charCodeAt(i) - (r.charCodeAt(0) % 5 + 1));
    }
    return b64Decode(out);
  } catch (_) {
    return "";
  }
}

function extractManifest(playerHtml) {
  var text = String(playerHtml || "");
  var out = [];
  var re = /\bav\(\s*["']([^"']{20,})["']\s*\)/g;
  var m;
  while ((m = re.exec(text))) {
    var url = decodeManifest(m[1]);
    if (url && /^https?:\/\//i.test(url)) {
      out.push(url);
      if (out.length >= 3) break;
    }
  }
  if (!out.length) {
    var direct = text.match(/https?:\/\/[^\s"'<>\\]+?\.m3u8[^\s"'<>\\]*/i);
    if (direct) out.push(direct[0]);
  }
  return out;
}

function extractSubtitles(playerHtml, baseUrl) {
  var text = String(playerHtml || "");
  var out = [];
  var re = /tracks\s*[:=]\s*\[([\s\S]{0,6000}?)\]/g;
  var m = re.exec(text);
  if (!m) return out;
  var objRe = /\{[^{}]{0,800}\}/g;
  var obj;
  while ((obj = objRe.exec(m[1]))) {
    var fileM = /["']?file["']?\s*:\s*["']([^"']+)["']/i.exec(obj[0]);
    if (!fileM) continue;
    var labelM = /["']?label["']?\s*:\s*["']([^"']*)["']/i.exec(obj[0]);
    var url = fileM[1].replace(/\\\//g, "/").replace(/\\u0026/g, "&");
    if (url.indexOf("//") === 0) url = "https:" + url;
    else if (url.charAt(0) === "/") url = originOf(baseUrl) + url;
    if (!/^https?:\/\//i.test(url)) continue;
    var label = labelM ? labelM[1] : "Altyazı";
    var lang = /turk/i.test(label) ? "tr" : (/ingl/i.test(label) ? "en" : "und");
    out.push({ label: label, lang: lang, url: url });
    if (out.length >= 8) break;
  }
  return out;
}

// --- main -------------------------------------------------------------------
function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  // The site publishes movies only.
  if (mediaType === "tv" || mediaType === "series" || mediaType === "show") return Promise.resolve([]);

  return getMediaInfo(tmdbId).then(function (info) {
    var titles = collectTitles(info);
    if (!titles.length) titles.push(String(tmdbId));
    var imdbId = info && (info.imdb_id || (info.external_ids && info.external_ids.imdb_id)) ? (info.imdb_id || info.external_ids.imdb_id) : "";
    var queries = [];
    if (imdbId) queries.push(imdbId);
    for (var i = 0; i < titles.length && queries.length < 3; i++) queries.push(titles[i]);

    var hostIndex = 0;
    var queryIndex = 0;

    function trySearch() {
      if (hostIndex >= HOSTS.length) return Promise.resolve(null);
      var host = HOSTS[hostIndex];
      if (queryIndex >= queries.length) { hostIndex++; queryIndex = 0; return trySearch(); }
      var query = queries[queryIndex++];
      return searchSite(host, query).then(function (results) {
        if (!results || !results.length) return trySearch();
        var picked = pickResult(results, titles, imdbId);
        if (!picked) return trySearch();
        return { host: host, item: picked, title: titles[0] };
      }).catch(function () { return trySearch(); });
    }

    return trySearch();
  }).then(function (ctx) {
    if (!ctx || !ctx.item) return [];
    var host = ctx.host;
    return getText(ctx.item.url, { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": host + "/" })
      .then(function (html) {
        if (!html) return [];
        var sources = parseSources(html, host);
        if (!sources.length) return [];
        var seen = {};
        var tasks = [];
        for (var i = 0; i < sources.length; i++) {
          (function (source) {
            if (!source || !source.url || seen[source.url]) return;
            seen[source.url] = true;
            tasks.push(getText(source.url, { "User-Agent": UA_CLIENT, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": ctx.item.url })
              .then(function (playerHtml) {
                if (!playerHtml) return [];
                var manifests = extractManifest(playerHtml);
                if (!manifests.length) return [];
                var subtitles = extractSubtitles(playerHtml, source.url);
                var headers = { "User-Agent": UA_CLIENT, "Referer": source.url, "Origin": originOf(source.url) };
                var out = [];
                for (var k = 0; k < manifests.length; k++) {
                  out.push({
                    name: "CastSinema • FullHDFilmizlesene",
                    title: "FullHDFilmizlesene • " + (ctx.title || "Film") + " • " + (source.source || "Kaynak") + " • HLS",
                    url: manifests[k],
                    quality: 1080,
                    provider: "castsinema-fullhdfilmizlesene",
                    format: "m3u8",
                    headers: headers,
                    behaviorHints: { notWebReady: true, proxyHeaders: { request: headers } },
                    subtitles: subtitles
                  });
                }
                return out;
              }));
          })(sources[i]);
        }
        return Promise.all(tasks).then(function (lists) {
          var flat = [], dedupe = {};
          for (var a = 0; a < lists.length; a++) {
            var list = lists[a] || [];
            for (var b = 0; b < list.length; b++) {
              if (!list[b] || dedupe[list[b].url]) continue;
              dedupe[list[b].url] = true;
              flat.push(list[b]);
            }
          }
          return flat;
        });
      });
  }).catch(function (error) {
    console.error("[CastSinema FullHDFilmizlesene] " + (error && error.message ? error.message : String(error)));
    return [];
  });
}

module.exports = { getStreams: getStreams };
