/* SPDX-License-Identifier: MIT
 * CastSinema DiziMom provider.
 * Turkish TV series scraper for DiziMom / Pilavyer.
 * Logic learned from Wiojelt/Nuvio-Addons and rewritten for CastSinema.
 */
"use strict";

var HOST = "https://ddizimom.net";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function profileHeaders(ua) {
  return { "User-Agent": ua, "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7" };
}
function requestProfiles() {
  var chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
  var firefox = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";
  var edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0";
  var safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15";
  return [
    profileHeaders("Dalvik/2.1.0 (Linux; U; Android 13; SM-G998B Build/TP1A.220624.014)"),
    profileHeaders("okhttp/4.9.2"),
    profileHeaders("ExoPlayerLib/2.19.1"),
    profileHeaders("stagefright/1.2 (Linux;Android 11)"),
    profileHeaders("VLC/3.0.21 LibVLC/3.0.21"),
    profileHeaders(chrome), profileHeaders(firefox), profileHeaders(edge), profileHeaders(safari), {}
  ];
}
var KEEP_HEADERS = ["accept", "referer", "origin", "range", "cookie", "content-type", "x-requested-with"];
function mergeHeaders(base, profile) {
  var headers = {}, key;
  for (key in base) { if (Object.prototype.hasOwnProperty.call(base, key) && KEEP_HEADERS.indexOf(String(key).toLowerCase()) !== -1) headers[key] = base[key]; }
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

function getTvInfo(tmdbId) {
  return getJson(TMDB_API + "/tv/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_KEY + "&language=tr-TR");
}

function searchDiziMom(title) {
  return getText(HOST + "/ara?q=" + encodeURIComponent(title), HOST + "/");
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null || mediaType === "movie") return Promise.resolve([]);
  var sNum = season != null ? Number(season) : 1;
  var eNum = episode != null ? Number(episode) : 1;

  return getTvInfo(tmdbId).then(function (info) {
    var title = info && (info.name || info.original_name) ? (info.name || info.original_name) : "";
    var alt = info && info.original_name && info.original_name !== title ? info.original_name : "";
    if (!title && !alt) return [];

    function trySearch(q) {
      if (!q) return Promise.resolve("");
      return searchDiziMom(q);
    }

    return trySearch(title).then(function (html) {
      if (html || !alt) return { html: html || "", title: title || alt };
      return trySearch(alt).then(function (h2) { return { html: h2 || "", title: title || alt }; });
    }).then(function (ctx) {
      if (!ctx || !ctx.html) return [];
      var seriesMatch = /href=["'](https?:\/\/ddizimom\.net\/dizi\/[^"'/]+)["']/i.exec(ctx.html);
      if (!seriesMatch) return [];
      var seriesUrl = seriesMatch[1];
      var epUrl = seriesUrl + "/sezon-" + sNum + "/bolum-" + eNum;

      return getText(epUrl, seriesUrl).then(function (epHtml) {
        if (!epHtml) return [];
        var pvMatch = /data-pv=["']([^"']+)["']/i.exec(epHtml);
        if (!pvMatch) return [];
        var slug = pvMatch[1];
        var bridgeUrl = "https://play2.pilavyerplay.top/assets/js/s.php?s=" + encodeURIComponent(slug);

        return getText(bridgeUrl, HOST + "/").then(function (bridgeHtml) {
          if (!bridgeHtml) return [];
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
    });
  }).catch(function (error) {
    console.error("[CastSinema DiziMom] " + (error && error.message ? error.message : String(error)));
    return [];
  });
}

module.exports = { getStreams: getStreams };
