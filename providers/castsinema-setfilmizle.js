/* SPDX-License-Identifier: MIT
 * CastSinema SetFilmIzle provider.
 * Turkish movie/series scraper for SetFilmIzle.
 * Logic learned from Wiojelt/Nuvio-Addons and rewritten for CastSinema.
 */
"use strict";

var HOST = "https://www.setfilmizle.ltd";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function profileHeaders(ua) {
  return { "User-Agent": ua, "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7" };
}
function requestProfiles() {
  return [
    profileHeaders("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"),
    profileHeaders("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"),
    profileHeaders("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0"),
    profileHeaders("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15"),
    {}
  ];
}
var KEEP_HEADERS = ["accept", "referer", "origin", "range", "cookie", "content-type", "x-requested-with"];
function mergeHeaders(base, profile) {
  var headers = {}, key;
  for (key in base) { if (Object.prototype.hasOwnProperty.call(base, key) && KEEP_HEADERS.indexOf(key) !== -1) headers[key] = base[key]; }
  for (key in profile) { if (Object.prototype.hasOwnProperty.call(profile, key)) headers[key] = profile[key]; }
  return headers;
}
function isRefused(response) {
  if (!response) return true;
  if (typeof response.status !== "number") return false;
  return response.status === 403 || response.status === 503;
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

function getJson(url) {
  return netFetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });
}
function getText(url, referer) {
  var headers = { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*" };
  if (referer) headers.Referer = referer;
  return netFetch(url, { headers: headers })
    .then(function (r) { return r.ok ? r.text() : ""; })
    .catch(function () { return ""; });
}
function parseJson(str) { try { return JSON.parse(str); } catch (_) { return null; } }

function getMediaInfo(tmdbId, isTv) {
  var path = isTv ? "/tv/" : "/movie/";
  return getJson(TMDB_API + path + "/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_KEY + "&language=tr-TR");
}

function searchSetFilm(query) {
  return getText(HOST + "/?s=" + encodeURIComponent(query), HOST + "/");
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  var isTv = mediaType === "tv" && season != null && episode != null;

  return getMediaInfo(tmdbId, isTv).then(function (info) {
    var title = info ? (info.title || info.name || info.original_title || info.original_name) : "";
    var query = title || String(tmdbId);
    return searchSetFilm(query).then(function (html) {
      if (!html && info && info.original_title && info.original_title !== title) {
        return searchSetFilm(info.original_title).then(function (h2) { return { html: h2 || "", title: title || "Media" }; });
      }
      return { html: html || "", title: title || "Media" };
    });
  }).then(function (ctx) {
    if (!ctx || !ctx.html) return [];
    var cardMatch = /href=["'](https?:\/\/www\.setfilmizle\.ltd\/(?:film|dizi)\/[^"']+)["']/i.exec(ctx.html);
    if (!cardMatch) {
      cardMatch = /href=["'](\/(?:film|dizi)\/[^"']+)["']/i.exec(ctx.html);
    }
    if (!cardMatch) return [];
    var itemUrl = cardMatch[1];
    if (itemUrl.charAt(0) === "/") itemUrl = HOST + itemUrl;
    if (isTv) {
      itemUrl = itemUrl.replace(/\/$/, "") + "/sezon-" + season + "-bolum-" + episode + "/";
    }

    return getText(itemUrl, HOST + "/").then(function (pageHtml) {
      if (!pageHtml) return [];
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
      }).then(function (r) { return r.ok ? r.text() : ""; })
        .then(function (ajaxText) {
          var payload = parseJson(ajaxText);
          if (!payload || !payload.success || !payload.data || !payload.data.stream || !payload.data.stream.url) return [];
          var stream = payload.data.stream;
          return [{
            name: "CastSinema • SetFilmIzle",
            title: "SetFilmIzle • " + ctx.title + " • " + (stream.provider || playerName || "SetPlay"),
            url: stream.url,
            quality: 1080,
            provider: "castsinema-setfilmizle",
            format: /m3u8/i.test(String(stream.url || "")) ? "m3u8" : "video",
            headers: { "User-Agent": UA, "Referer": itemUrl }
          }];
        });
    });
  }).catch(function (error) {
    console.error("[CastSinema SetFilmIzle] " + (error && error.message ? error.message : String(error)));
    return [];
  });
}

module.exports = { getStreams: getStreams };
