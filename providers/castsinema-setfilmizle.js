/* SPDX-License-Identifier: GPL-3.0-only
 * CastSinema SetFilmIzle native HTML/JS scraper for CastSinema.
 * Direct scraper extracting streams from SetFilmIzle.
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


var HOST = "https://www.setfilmizle.ltd";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function getMediaInfo(tmdbId, isTv) {
  var path = isTv ? "/tv/" : "/movie/";
  var url = TMDB_API + path + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_KEY + "&language=tr-TR";
  return netFetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });
}

function searchSetFilm(query) {
  var url = HOST + "/?s=" + encodeURIComponent(query);
  return netFetch(url, { headers: { "User-Agent": UA, "Referer": HOST + "/" } })
    .then(function (r) { return r.ok ? r.text() : ""; })
    .catch(function () { return ""; });
}

function parseJson(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  var isTv = mediaType === "tv" && season != null && episode != null;

  return getMediaInfo(tmdbId, isTv)
    .then(function (info) {
      var title = info ? (info.title || info.name || info.original_title || info.original_name) : null;
      var query = title || String(tmdbId);
      return searchSetFilm(query).then(function (html) {
        return { html: html, title: title || "Media" };
      });
    })
    .then(function (ctx) {
      if (!ctx || !ctx.html) return [];
      var cardMatch = /href=["'](https?:\/\/www\.setfilmizle\.ltd\/(?:film|dizi)\/[^"']+)["']/i.exec(ctx.html);
      if (!cardMatch) return [];
      var itemUrl = cardMatch[1];
      if (isTv) {
        itemUrl = itemUrl.replace(/\/$/, "") + "/sezon-" + season + "-bolum-" + episode + "/";
      }

      return netFetch(itemUrl, { headers: { "User-Agent": UA, "Referer": HOST + "/" } })
        .then(function (r) { return r.ok ? r.text() : ""; })
        .then(function (pageHtml) {
          var nonceMatch = /nonces:\s*\{[^}]*video:\s*["']([^"']+)["']/i.exec(pageHtml);
          var postIdMatch = /(?:post_id["':\s]+|data-post-id=["']|post-)(\d+)/i.exec(pageHtml);
          var playerMatch = /data-player-name=["']([^"']+)["']/i.exec(pageHtml);

          if (!nonceMatch || !postIdMatch) return [];
          var nonce = nonceMatch[1];
          var postId = postIdMatch[1];
          var playerName = playerMatch ? playerMatch[1] : "SetPlay";

          var body = "action=get_video_url&nonce=" + encodeURIComponent(nonce) +
            "&post_id=" + encodeURIComponent(postId) +
            "&player_name=" + encodeURIComponent(playerName) +
            "&part_key=";

          return netFetch(HOST + "/wp-admin/admin-ajax.php", {
            method: "POST",
            headers: {
              "User-Agent": UA,
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              "Referer": itemUrl,
              "X-Requested-With": "XMLHttpRequest"
            },
            body: body
          })
            .then(function (r) { return r.ok ? r.text() : ""; })
            .then(function (ajaxText) {
              var payload = parseJson(ajaxText);
              if (!payload || !payload.success || !payload.data || !payload.data.stream || !payload.data.stream.url) {
                return [];
              }
              var stream = payload.data.stream;
              return [{
                name: "CastSinema • SetFilmIzle",
                title: "SetFilmIzle • " + ctx.title + " • " + (stream.provider || "SetPlay"),
                url: stream.url,
                quality: 1080,
                provider: "castsinema-setfilmizle",
                format: "video",
                headers: { "User-Agent": UA, "Referer": HOST + "/" }
              }];
            });
        });
    })
    .catch(function (error) {
      console.error("[CastSinema SetFilmIzle] " + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = { getStreams: getStreams };
