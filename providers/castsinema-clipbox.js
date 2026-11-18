/* SPDX-License-Identifier: MIT
 * CastSinema ClipBox provider.
 * Turkish movie/series scraper for VixSrc (vixsrc.to).
 *
 * Verified flow (live site, 2026-11):
 *   TMDB id -> GET /api/movie/<id> (or /api/tv/<id>/<season>/<episode>)
 *   -> {"src":"/embed/<id>?token=..."}
 *   -> embed page -> window.masterPlaylist {url, token, expires}
 *   -> GET /playlist/<id>?token=..&expires=..&asn=&h=1&lang=..
 *   -> HLS master playlist (multi audio + subtitle renditions)
 */
"use strict";

var HOST = "https://vixsrc.to";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function requestProfiles() {
  return [
    { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7" },
    { "User-Agent": "okhttp/4.9.2" },
    { "User-Agent": "ExoPlayerLib/2.19.1" },
    { "User-Agent": "stagefright/1.2 (Linux;Android 11)" },
    { "User-Agent": "VLC/3.0.21 LibVLC/3.0.21" },
    { "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 13; SM-G998B Build/TP1A.220624.014)" },
    {}
  ];
}
var KEEP_HEADERS = ["accept", "referer", "origin", "range", "cookie", "content-type"];
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

function originOf(u) { var m = String(u || "").match(/^(https?:\/\/[^\/]+)/i); return m ? m[1] : ""; }
function absolute(u, base) {
  if (!u) return "";
  var v = String(u).trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.indexOf("//") === 0) return "https:" + v;
  var b = String(base || HOST).replace(/\/+$/, "");
  if (v.charAt(0) === "/") return b + v;
  return b + "/" + v;
}

function getMediaInfo(tmdbId, isTv) {
  var path = isTv ? "/tv/" : "/movie/";
  return getJson(TMDB_API + path + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_KEY + "&language=tr-TR&append_to_response=external_ids");
}

// The site resolves a TMDB id directly, no search needed.
function getEmbedSrc(tmdbId, isTv, season, episode) {
  var url;
  if (isTv) {
    url = HOST + "/api/tv/" + encodeURIComponent(String(tmdbId)) + "/" + encodeURIComponent(String(season)) + "/" + encodeURIComponent(String(episode));
  } else {
    url = HOST + "/api/movie/" + encodeURIComponent(String(tmdbId));
  }
  return getJson(url, { "User-Agent": UA, "Accept": "application/json", "Referer": HOST + "/" })
    .then(function (data) {
        if (!data || !data.src) return null;
      return { src: String(data.src), url: url };
    });
}

// window.masterPlaylist = { params: { token, expires, asn }, url: '...' }
function extractBalancedObject(text, marker) {
  var src = String(text || "");
  var at = src.indexOf(marker);
  if (at < 0) return null;
  var start = src.indexOf("{", at);
  if (start < 0) return null;
  var depth = 0, inString = false, escaped = false;
  for (var i = start; i < src.length; i++) {
    var ch = src.charAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "'" || ch === '"') inString = false;
      continue;
    }
    if (ch === "'" || ch === '"') { inString = true; continue; }
    if (ch === "{") { depth++; continue; }
    if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

function parseMasterPlaylist(html) {
  var block = extractBalancedObject(html, "window.masterPlaylist");
  if (!block) return null;
  var url = /url\s*:\s*'([^']+)'/.exec(block);
  var token = /'token'\s*:\s*'([^']*)'/.exec(block);
  var expires = /'expires'\s*:\s*'([^']*)'/.exec(block);
  var asn = /'asn'\s*:\s*'([^']*)'/.exec(block);
  if (!url || !token) return null;
  return {
    url: url[1],
    token: token[1],
    expires: expires ? expires[1] : "",
    asn: asn ? asn[1] : ""
  };
}

function buildPlaylistUrl(master, lang) {
  return master.url +
    "?token=" + encodeURIComponent(master.token) +
    "&expires=" + encodeURIComponent(master.expires) +
    "&asn=" + encodeURIComponent(master.asn || "") +
    "&h=1" +
    "&lang=" + encodeURIComponent(lang || "en");
}

function parseSubtitles(masterText) {
  var out = [];
  var text = String(masterText || "");
  var re = /#EXT-X-MEDIA:TYPE=SUBTITLES[^\n]*URI="([^"]+)"/gi;
  var m;
  while ((m = re.exec(text))) {
    var url = m[1].replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(url)) continue;
    var label = "Altyazı";
    var lm = /NAME="([^"]*)"[^>]*URI=/.exec(m[0]);
    if (lm) label = lm[1];
    var lang = /LANGUAGE="([^"]*)"/.exec(m[0]);
    out.push({ label: label, lang: lang ? lang[1] : "und", url: url });
    if (out.length >= 8) break;
  }
  return out;
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  var isTv = mediaType === "tv" || mediaType === "series" || mediaType === "show";
  var sNum = season != null ? Number(season) : 1;
  var eNum = episode != null ? Number(episode) : 1;

  return getMediaInfo(tmdbId, isTv).then(function (info) {
    var title = info ? (isTv ? (info.name || info.original_name) : (info.title || info.original_title)) : "";
    console.log("[DBG] info=" + (info ? "ok" : "null") + " title=" + title);
    return getEmbedSrc(tmdbId, isTv, sNum, eNum).then(function (found) {
      console.log("[DBG] found=" + (found ? found.src : "null"));
      if (!found) return [];
      var embedUrl = absolute(found.src, HOST);
      return getText(embedUrl, { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": HOST + "/" })
        .then(function (html) {
          if (!html) return [];
          var master = parseMasterPlaylist(html);
          if (!master) return [];
          var langMatch = /[?&]lang=([^&"']+)/.exec(found.src);
          var lang = langMatch ? decodeURIComponent(langMatch[1]) : "en";
          var playlistUrl = buildPlaylistUrl(master, lang);
          return netFetch(playlistUrl, {
            headers: { "User-Agent": UA, "Accept": "application/vnd.apple.mpegurl,application/x-mpegURL,*/*", "Referer": embedUrl }
          }).then(function (r) {
            if (!r || !r.ok) return [];
            return r.text().then(function (masterText) {
              if (!masterText || masterText.indexOf("#EXTM3U") !== 0) return [];
              var label = title || (isTv ? "Bölüm" : "Film");
              if (isTv) label += " • S" + sNum + "E" + eNum;
              var headers = { "User-Agent": UA, "Referer": embedUrl };
              return [{
                name: "CastSinema • ClipBox",
                title: "ClipBox • " + label + " • HLS",
                url: playlistUrl,
                quality: 1080,
                provider: "castsinema-clipbox",
                format: "m3u8",
                headers: headers,
                behaviorHints: { notWebReady: true, proxyHeaders: { request: headers } },
                subtitles: parseSubtitles(masterText)
              }];
            });
          });
        });
    });
  }).catch(function (error) {
    console.error("[CastSinema ClipBox] " + (error && error.message ? error.message : String(error)));
    return [];
  });
}

module.exports = { getStreams: getStreams };
