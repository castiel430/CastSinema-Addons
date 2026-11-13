/* SPDX-License-Identifier: MIT
 * CastSinema HDFilmCehennemi provider.
 * Turkish movie/series scraper for HDFilmCehennemi.
 *
 * Verified flow (live site, 2026-11):
 *   TMDB id -> IMDb id
 *   -> GET /search/?q=<imdb id>  (JSON endpoint, needs `X-Requested-With: fetch`)
 *   -> result item page (/slug-izle-N/ for movies, /dizi/<slug>/ for series)
 *   -> series page -> episode page (/sezon-N/bolum-M-.../)
 *   -> page iframe -> https://hdfilmcehennemi.mobi/video/embed/<id>/
 *   -> player page (only served to player clients such as okhttp/ExoPlayer)
 *   -> encrypted manifest payload -> HLS master playlist + subtitle tracks
 *
 * The player page hides the manifest behind a keyed shuffle/XOR routine. The
 * payload is decoded here with a pure JavaScript port of that routine (no eval,
 * no `atob`/`Buffer` dependency) so the addon runtime can execute it safely.
 */
"use strict";

var HOSTS = ["https://www.hdfilmcehennemi.nl", "https://hdfilmcehennemi.nl"];
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
// The embed host only answers player clients; desktop browsers get a 404.
var UA_CLIENT = "okhttp/4.9.2";
var UA_CLIENT_2 = "ExoPlayerLib/2.19.1";

// --- request layer ---------------------------------------------------------
function profileHeaders(ua) {
  return { "User-Agent": ua, "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7" };
}
function requestProfiles() {
  return [
    profileHeaders("Dalvik/2.1.0 (Linux; U; Android 13; SM-G998B Build/TP1A.220624.014)"),
    profileHeaders(UA_CLIENT_2),
    profileHeaders("VLC/3.0.21 LibVLC/3.0.21"),
    profileHeaders(UA),
    profileHeaders("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"),
    profileHeaders("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0"),
    profileHeaders("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15"),
    profileHeaders(UA_CLIENT),
    profileHeaders("stagefright/1.2 (Linux;Android 11)"),
    {}
  ];
}
// The embed host only answers real player clients.
function clientProfiles() {
  return [
    profileHeaders(UA_CLIENT),
    profileHeaders(UA_CLIENT_2),
    profileHeaders("stagefright/1.2 (Linux;Android 11)"),
    profileHeaders("VLC/3.0.21 LibVLC/3.0.21"),
    profileHeaders("Dalvik/2.1.0 (Linux; U; Android 13; SM-G998B Build/TP1A.220624.014)"),
    profileHeaders(UA),
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
  var profiles = options.client ? clientProfiles() : requestProfiles();
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

// --- helpers ----------------------------------------------------------------
function originOf(u) { var m = String(u || "").match(/^(https?:\/\/[^\/]+)/i); return m ? m[1] : ""; }
function hostOfUrl(u) {
  var t = String(u || "").trim();
  var m = t.match(/^(?:https?:)?\/\/([^/?#:]+)/i);
  if (m) return m[1];
  return "";
}
function absolute(u, base) {
  if (!u) return "";
  var v = String(u).trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.indexOf("//") === 0) return "https:" + v;
  var b = String(base || "").replace(/\/+$/, "");
  if (v.charAt(0) === "/") return b + v;
  return b + "/" + v;
}
function parseJson(str) { try { return JSON.parse(str); } catch (_) { return null; } }
function foldTurkish(s) {
  var out = String(s || "").replace(/[ıİşŞğĞüÜöÖçÇ]/g, function (c) {
    return { "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g", "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c" }[c] || c;
  }).toLowerCase();
  try { out = out.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return out;
}
function normalizeTitle(s) { return foldTurkish(s).replace(/[^a-z0-9]+/g, ""); }
function titleScore(candidate, titles) {
  var nc = normalizeTitle(candidate);
  if (!nc) return 0;
  var best = 0;
  for (var i = 0; i < titles.length; i++) {
    var nt = normalizeTitle(titles[i]);
    if (!nt) continue;
    if (nc === nt) best = Math.max(best, 100);
    else if (nc.indexOf(nt) !== -1 || nt.indexOf(nc) !== -1) best = Math.max(best, 75);
  }
  return best;
}
function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, " ").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim(); }

// --- base64 (no atob/Buffer dependency) ------------------------------------
var B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64Decode(s) {
  var t = String(s || "").replace(/[\r\n\t =]+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  var out = "";
  for (var i = 0; i < t.length; i += 4) {
    var a = B64C.indexOf(t.charAt(i));
    var b = i + 1 < t.length ? B64C.indexOf(t.charAt(i + 1)) : -1;
    var c = i + 2 < t.length ? B64C.indexOf(t.charAt(i + 2)) : -1;
    var d = i + 3 < t.length ? B64C.indexOf(t.charAt(i + 3)) : -1;
    if (a === -1 || b === -1) break;
    out += String.fromCharCode((a << 2) | (b >> 4));
    if (c !== -1) {
      out += String.fromCharCode(((b & 15) << 4) | (c >> 2));
      if (d !== -1) out += String.fromCharCode(((c & 3) << 6) | d);
    }
  }
  return out;
}

// --- manifest decoder -------------------------------------------------------
// The player ships the manifest as fn("<payload>".split("<sep>")). The routine
// below is a direct port of the site's own shuffle + XOR decoder.
function decodePayload(arr, salt) {
  try {
    if (!Array.isArray(arr) || arr.length < 5) return null;
    var a = arr.slice();
    var len2 = a.length - 2;
    var idx1 = len2 % 7;
    var idx2 = 8 + (len2 % 5);
    if (idx2 >= a.length || idx1 >= a.length) return null;

    var keyStr = a.splice(idx2, 1)[0];
    var saltPart = a.splice(idx1, 1)[0] + (salt || "");
    var text = a.join("");

    if (keyStr.length > 2048) text = text.split("").reverse().join("");

    var z = 0, f = 0;
    for (var i = 0; i < saltPart.length; i++) {
      var cc = saltPart.charCodeAt(i);
      z = (z * 37 + cc) % 241;
      f = (f + ((cc << 1) ^ i)) & 255;
    }
    var base = (z * 3 + f) % 256;
    var step = (f % 11) + 5;
    var seed = ((f * 251 + z) % 65519) + 1;

    for (var k = keyStr.length - 1; k >= 0; k--) {
      var ch = keyStr.charAt(k);
      if (ch === "7") {
        text = b64Decode(text);
      } else if (ch === "3") {
        text = text.split("").reverse().join("");
      } else {
        var shift = (26 - ((ch.charCodeAt(0) - 96) % 26)) % 26;
        text = text.replace(/[a-zA-Z]/g, function (m) {
          var c = m.charCodeAt(0);
          var baseChar = c <= 90 ? 65 : 97;
          return String.fromCharCode(((c - baseChar + shift) % 26) + baseChar);
        });
      }
    }
    if (saltPart.length > 4096) text = b64Decode(text);

    var n = text.length;
    var perm = new Array(n);
    for (var p = n - 1; p >= 1; p--) {
      seed = (seed * 97 + 41) % 65519;
      perm[p] = seed % (p + 1);
    }
    var chars = text.split("");
    for (var q = 1; q < n; q++) {
      var j = perm[q];
      var tmp = chars[q];
      chars[q] = chars[j];
      chars[j] = tmp;
    }
    text = chars.join("");

    var state = base;
    var out = "";
    for (var r = 0; r < text.length; r++) {
      var tc = text.charCodeAt(r);
      state = (state * 5 + step) % 256;
      out += String.fromCharCode(tc ^ state);
      state = (state + tc) % 256;
    }
    var m = out.match(/https?:\/\/[^\s"'<>]+/);
    if (!m) return null;
    // /txt/master.txt is the raw manifest; the playlist path is master.m3u8
    return m[0].replace(/\/txt\/master\.txt/i, "/master.m3u8").replace(/\/master\.txt/i, "/master.m3u8");
  } catch (_) {
    return null;
  }
}

// Scans the player page for every encrypted payload and returns the first one
// that decodes into a media URL.
function extractManifest(playerHtml, baseUrl) {
  var text = String(playerHtml || "");
  var re = /(["'])([^"']{20,})\1\s*\.split\(\s*(["'])([^"']{1,3})\3\s*\)/g;
  var match;
  var salts = [hostOfUrl(baseUrl), "", "hdfilmcehennemi.mobi"];
  var found = [];
  while ((match = re.exec(text))) {
    var parts = match[2].split(match[4]);
    if (parts.length < 5) continue;
    for (var i = 0; i < salts.length; i++) {
      var url = decodePayload(parts, salts[i]);
      if (url) { found.push(url); break; }
    }
    if (found.length >= 3) break;
  }
  if (!found.length) {
    // Fallback: some player variants expose the playlist directly.
    var direct = text.match(/https?:\/\/[^\s"'<>\\]+?(?:\.m3u8|\/master\.txt)[^\s"'<>\\]*/i);
    if (direct) found.push(direct[0].replace(/\/txt\/master\.txt/i, "/master.m3u8").replace(/\/master\.txt/i, "/master.m3u8"));
  }
  return found;
}

function extractSubtitles(playerHtml, baseUrl) {
  var text = String(playerHtml || "");
  var out = [];
  var re = /tracks\s*[:=]\s*\[([\s\S]{0,8000}?)\]/g;
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

// --- site helpers -----------------------------------------------------------
function getMediaInfo(tmdbId, isTv) {
  var path = isTv ? "/tv/" : "/movie/";
  return getJson(TMDB_API + path + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_KEY + "&language=tr-TR&append_to_response=external_ids,translations");
}

function collectTitles(info, isMovie) {
  var titles = [];
  function add(v) {
    var s = String(v || "").trim();
    if (!s) return;
    var n = normalizeTitle(s);
    for (var i = 0; i < titles.length; i++) if (normalizeTitle(titles[i]) === n) return;
    titles.push(s);
  }
  if (!info) return titles;
  add(isMovie ? info.title : info.name);
  add(isMovie ? info.original_title : info.original_name);
  var tr = (info.translations && info.translations.translations) || [];
  for (var i = 0; i < tr.length; i++) {
    if (!tr[i] || tr[i].iso_639_1 !== "tr") continue;
    var data = tr[i].data || {};
    add(isMovie ? data.title : data.name);
  }
  return titles;
}

function searchHdf(host, query) {
  var headers = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "tr-TR,tr;q=0.9",
    "Referer": host + "/",
    "X-Requested-With": "fetch"
  };
  return netFetch(host + "/search/?q=" + encodeURIComponent(query), { headers: headers })
    .then(function (r) { return r && r.ok ? r.text() : ""; })
    .catch(function () { return ""; });
}

function parseSearchResults(raw) {
  var data = parseJson(raw);
  if (!data || !Array.isArray(data.results)) return [];
  var out = [];
  for (var i = 0; i < data.results.length; i++) {
    var html = String(data.results[i] || "");
    var href = /href=["']([^"']+)["']/i.exec(html);
    if (!href) continue;
    var title = /class=["']title["'][^>]*>([^<]*)</i.exec(html);
    var type = /class=["']type["'][^>]*>([^<]*)</i.exec(html);
    var year = /class=["']year["'][^>]*>([^<]*)</i.exec(html);
    out.push({
      url: href[1],
      title: title ? stripTags(title[1]) : "",
      type: type ? stripTags(type[1]) : "",
      year: year ? stripTags(year[1]) : ""
    });
  }
  return out;
}

function pickResult(results, titles, isTv) {
  var best = null, bestScore = 0;
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (!r || !r.url) continue;
    var isSeries = /\/dizi\//i.test(r.url) || /dizi/i.test(r.type);
    if (isTv && !isSeries) continue;
    if (!isTv && isSeries) continue;
    var score = titleScore(r.title, titles);
    if (!r.title) score = 30;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  if (!best) {
    // fall back to the first result of the right kind
    for (var j = 0; j < results.length; j++) {
      var rr = results[j];
      var series = /\/dizi\//i.test(rr.url) || /dizi/i.test(rr.type);
      if (isTv === series) return rr;
    }
    return null;
  }
  return best;
}

function findPlayerEmbed(html, baseUrl) {
  var tags = String(html || "").match(/<iframe\b[^>]*>/gi) || [];
  var fallback = "";
  for (var i = 0; i < tags.length; i++) {
    var src = /data-src=["']([^"']+)["']/i.exec(tags[i]) || /\ssrc=["']([^"']+)["']/i.exec(tags[i]);
    if (!src) continue;
    var url = absolute(src[1], baseUrl);
    if (!/^https?:\/\//i.test(url)) continue;
    if (/video\/embed\/|player|embed|oynat/i.test(url)) return url;
    if (!fallback) fallback = url;
  }
  return fallback;
}

function findEpisodeUrl(html, baseUrl, season, episode) {
  var re = new RegExp("href=[\"']([^\"']*sezon-" + season + "[^\"']*bolum-" + episode + "[^\"']*)[\"']", "i");
  var m = re.exec(String(html || ""));
  if (m) return absolute(m[1], baseUrl);
  var re2 = new RegExp("href=[\"']([^\"']*sezon-" + season + "[^\"']*)[\"']", "i");
  var m2 = re2.exec(String(html || ""));
  if (m2) return absolute(m2[1], baseUrl);
  return null;
}

// --- main -------------------------------------------------------------------
function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  var isTv = mediaType === "tv" || mediaType === "series" || mediaType === "show";
  var sNum = season != null ? Number(season) : 1;
  var eNum = episode != null ? Number(episode) : 1;

  return getMediaInfo(tmdbId, isTv).then(function (info) {
    var titles = collectTitles(info, !isTv);
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
      return searchHdf(host, query).then(function (raw) {
        if (!raw) return trySearch();
        var results = parseSearchResults(raw);
        if (!results.length) return trySearch();
        var picked = pickResult(results, titles, isTv);
        if (!picked) return trySearch();
        return { host: host, item: picked, title: titles[0] };
      }).catch(function () { return trySearch(); });
    }

    return trySearch();
  }).then(function (ctx) {
    if (!ctx || !ctx.item) return [];
    var host = ctx.host;
    var itemUrl = ctx.item.url;

    function toPlayerPage(url) {
      return getText(url, { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": host + "/" })
        .then(function (html) { return html ? { url: url, html: html } : null; });
    }

    if (!isTv) {
      return toPlayerPage(itemUrl).then(function (page) {
        if (!page) return [];
        var embedUrl = findPlayerEmbed(page.html, page.url);
        if (!embedUrl) return [];
        return buildStreams(embedUrl, page.url, ctx.title, false, sNum, eNum);
      });
    }

    // series: find the episode page first
    return toPlayerPage(itemUrl).then(function (page) {
      if (!page) return [];
      var epUrl = findEpisodeUrl(page.html, page.url, sNum, eNum);
      if (!epUrl) return [];
      return toPlayerPage(epUrl).then(function (epPage) {
        if (!epPage) return [];
        var embedUrl = findPlayerEmbed(epPage.html, epPage.url);
        if (!embedUrl) return [];
        return buildStreams(embedUrl, epPage.url, ctx.title, true, sNum, eNum);
      });
    });
  }).catch(function (error) {
    console.error("[CastSinema HDFilmCehennemi] " + (error && error.message ? error.message : String(error)));
    return [];
  });
}

function buildStreams(embedUrl, referer, title, isTv, season, episode) {
  // The embed host answers player clients only.
  var headers = {
    "User-Agent": UA_CLIENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "tr-TR,tr;q=0.9",
    "Referer": referer || (originOf(embedUrl) + "/")
  };
  return netFetch(embedUrl, { headers: headers, client: true })
    .then(function (r) { return r && r.ok ? r.text() : ""; })
    .then(function (body) {
      if (!body) return [];
      var manifests = extractManifest(body, embedUrl);
      if (!manifests.length) return [];
      var label = title || "İçerik";
      if (isTv) label += " • S" + season + "E" + episode;
      var subtitles = extractSubtitles(body, embedUrl);
      var streamHeaders = { "User-Agent": UA_CLIENT, "Referer": embedUrl };
      var streams = [];
      for (var i = 0; i < manifests.length; i++) {
        streams.push({
          name: "CastSinema • HDFilmCehennemi",
          title: "HDFilmCehennemi • " + label + " • HLS",
          url: manifests[i],
          quality: 1080,
          provider: "castsinema-hdfilmcehennemi",
          format: "m3u8",
          headers: streamHeaders,
          behaviorHints: { notWebReady: true, proxyHeaders: { request: streamHeaders } },
          subtitles: subtitles
        });
      }
      return streams;
    })
    .catch(function () { return []; });
}

module.exports = { getStreams: getStreams };
