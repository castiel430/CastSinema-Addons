/* SPDX-License-Identifier: GPL-3.0-only
 * CastSinema DiziMom native HTML/JS scraper for CastSinema.
 * Direct scraper extracting HLS master playlist for TV series from DiziMom / Pilavyer.
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


var HOST = "https://ddizimom.net";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function getTvInfo(tmdbId) {
  var url = TMDB_API + "/tv/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_KEY + "&language=tr-TR";
  return netFetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });
}

function searchDiziMom(title) {
  var url = HOST + "/ara?q=" + encodeURIComponent(title);
  return netFetch(url, { headers: { "User-Agent": UA, "Referer": HOST + "/" } })
    .then(function (r) { return r.ok ? r.text() : ""; })
    .catch(function () { return ""; });
}

function parseJson(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null || mediaType === "movie") return Promise.resolve([]);

  var sNum = season != null ? Number(season) : 1;
  var eNum = episode != null ? Number(episode) : 1;

  return getTvInfo(tmdbId)
    .then(function (info) {
      var title = info && (info.name || info.original_name) ? (info.name || info.original_name) : null;
      if (!title) return null;
      return searchDiziMom(title).then(function (html) {
        if (!html && info.original_name && info.original_name !== title) {
          return searchDiziMom(info.original_name).then(function (h2) { return { html: h2, title: title }; });
        }
        return { html: html, title: title };
      });
    })
    .then(function (ctx) {
      if (!ctx || !ctx.html) return [];
      var seriesMatch = /href=["'](https?:\/\/ddizimom\.net\/dizi\/[^"'/]+)["']/i.exec(ctx.html);
      if (!seriesMatch) return [];
      var seriesUrl = seriesMatch[1];
      var epUrl = seriesUrl + "/sezon-" + sNum + "/bolum-" + eNum;

      return netFetch(epUrl, { headers: { "User-Agent": UA, "Referer": seriesUrl } })
        .then(function (r) { return r.ok ? r.text() : ""; })
        .then(function (epHtml) {
          var pvMatch = /data-pv=["']([^"']+)["']/i.exec(epHtml);
          if (!pvMatch) return [];
          var slug = pvMatch[1];
          var bridgeUrl = "https://play2.pilavyerplay.top/assets/js/s.php?s=" + encodeURIComponent(slug);

          return netFetch(bridgeUrl, { headers: { "User-Agent": UA, "Referer": HOST + "/" } })
            .then(function (r) { return r.ok ? r.text() : ""; })
            .then(function (bridgeHtml) {
              var playerMatch = /window\.__PLAYER__\s*=\s*(\{[\s\S]*?\});/i.exec(bridgeHtml);
              if (!playerMatch) return [];
              var playerConfig = parseJson(playerMatch[1]);
              if (!playerConfig || !playerConfig.stream) return [];

              return [{
                name: "CastSinema • DiziMom",
                title: "DiziMom • " + ctx.title + " • S" + sNum + "E" + eNum + " • HLS 1080p",
                url: playerConfig.stream,
                quality: 1080,
                provider: "castsinema-dizimom",
                format: "m3u8",
                headers: { "User-Agent": UA, "Referer": "https://play2.pilavyerplay.top/" }
              }];
            });
        });
    })
    .catch(function (error) {
      console.error("[CastSinema DiziMom] " + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = { getStreams: getStreams };
