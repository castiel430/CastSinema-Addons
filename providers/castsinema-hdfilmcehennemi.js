/* SPDX-License-Identifier: MIT
 * CastSinema HDFilmCehennemi provider.
 * Turkish movie/series scraper for HDFilmCehennemi.
 * Logic learned from Wiojelt/Nuvio-Addons and rewritten for CastSinema.
 */
"use strict";

var HOSTS = ["https://www.hdfilmcehennemi.nl", "https://hdfilmcehennemi.nl", "https://www.hdfilmcehennemi.la", "https://hdfilmcehennemi.la", "https://hdfilmcehennemi.com", "https://www.hdfilmcehennemi.com"];
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function profileHeaders(ua) {
  return { "User-Agent": ua, "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7" };
}
function requestProfiles() {
  return [
    profileHeaders("Dalvik/2.1.0 (Linux; U; Android 13; SM-G998B Build/TP1A.220624.014)"),
    profileHeaders("okhttp/4.9.2"),
    profileHeaders("ExoPlayerLib/2.19.1"),
    profileHeaders("stagefright/1.2 (Linux;Android 11)"),
    profileHeaders("VLC/3.0.21 LibVLC/3.0.21"),
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
function getText(url, referer, extraHeaders) {
  var headers = { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*" };
  if (referer) headers.Referer = referer;
  if (extraHeaders) {
    for (var k in extraHeaders) { if (Object.prototype.hasOwnProperty.call(extraHeaders, k)) headers[k] = extraHeaders[k]; }
  }
  return netFetch(url, { headers: headers })
    .then(function (r) { return r.ok ? r.text() : ""; })
    .catch(function () { return ""; });
}
function parseJson(str) { try { return JSON.parse(str); } catch (_) { return null; } }

function getMediaInfo(tmdbId, isTv) {
  var path = isTv ? "/tv/" : "/movie/";
  return getJson(TMDB_API + path + "/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_KEY + "&language=tr-TR&append_to_response=external_ids");
}

function searchHdf(host, query) {
  return getText(host + "/search/?q=" + encodeURIComponent(query), host + "/", { "X-Requested-With": "fetch", "Accept": "application/json, text/plain, */*" })
    .then(function (raw) {
      if (raw) return raw;
      return getText(host + "/search?q=" + encodeURIComponent(query), host + "/", { "X-Requested-With": "fetch", "Accept": "application/json, text/plain, */*" });
    });
}

function extractFirstLink(jsonText, host) {
  if (!jsonText) return null;
  var data = parseJson(jsonText);
  if (data && Array.isArray(data.results) && data.results.length > 0) {
    for (var i = 0; i < data.results.length; i++) {
      var html = String(data.results[i] || "");
      var m = /href=["']([^"']+)["']/i.exec(html);
      if (m) {
        var u = m[1];
        if (/^\/\//.test(u)) u = "https:" + u;
        if (u.charAt(0) === "/") u = host + u;
        return u;
      }
    }
  }
  var fallback = /href=["']((?:https?:\/\/[^"']+)?\/[^"']+)["']/i.exec(String(jsonText));
  if (fallback) {
    var fu = fallback[1];
    if (/^\/\//.test(fu)) fu = "https:" + fu;
    if (fu.charAt(0) === "/") fu = host + fu;
    if (/hdfilmcehennemi/i.test(fu)) return fu;
  }
  return null;
}

var TRAILER_HOST = /youtube\.com|youtu\.be|dailymotion\.com|vimeo\.com/i;

function findPlayer(html) {
  var tags = String(html || "").match(/<iframe\b[^>]*>/gi) || [];
  var fallback = "";
  for (var i = 0; i < tags.length; i++) {
    var tag = tags[i];
    var src = /data-src=["']([^"']+)["']/i.exec(tag) || /\ssrc=["']([^"']+)["']/i.exec(tag);
    if (!src) continue;
    var url = src[1];
    if (/^\/\//.test(url)) url = "https:" + url;
    if (!/^https?:\/\//i.test(url)) continue;
    if (TRAILER_HOST.test(url)) continue;
    if (/\/video\/embed\/|player|embed|oynat|close/i.test(url)) return url;
    if (!fallback) fallback = url;
  }
  return fallback;
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  var isTv = mediaType === "tv" && season != null && episode != null;

  return getMediaInfo(tmdbId, isTv).then(function (info) {
    var imdbId = info && (info.imdb_id || (info.external_ids && info.external_ids.imdb_id)) ? (info.imdb_id || info.external_ids.imdb_id) : null;
    var title = info ? (info.title || info.name || info.original_title || info.original_name) : "";
    var terms = [];
    if (imdbId) terms.push(imdbId);
    if (title) terms.push(title);
    if (info && info.original_title && info.original_title !== title) terms.push(info.original_title);
    if (!terms.length) terms.push(String(tmdbId));

    function trySearch(termIndex, hostIndex) {
      if (termIndex >= terms.length) return Promise.resolve([]);
      if (hostIndex >= HOSTS.length) return trySearch(termIndex + 1, 0);
      var host = HOSTS[hostIndex];
      var term = terms[termIndex];
      return searchHdf(host, term).then(function (raw) {
        if (!raw) return trySearch(termIndex, hostIndex + 1);
        var itemUrl = extractFirstLink(raw, host);
        if (!itemUrl) return trySearch(termIndex, hostIndex + 1);
        var targetUrl = itemUrl;
        if (isTv) {
          targetUrl = itemUrl.replace(/\/$/, "") + "/sezon-" + season + "-bolum-" + episode + "/";
        }
        return getText(targetUrl, host + "/").then(function (pageHtml) {
          if (!pageHtml) return trySearch(termIndex, hostIndex + 1);
          var embedUrl = findPlayer(pageHtml);
          if (!embedUrl) return trySearch(termIndex, hostIndex + 1);
          var label = title || "İçerik";
          if (isTv) label += " • S" + season + "E" + episode;
          return [{
            name: "CastSinema • HDFilmCehennemi",
            title: "HDFilmCehennemi • " + label + " • 1080p",
            url: embedUrl,
            quality: 1080,
            provider: "castsinema-hdfilmcehennemi",
            format: "video",
            headers: { "User-Agent": UA, "Referer": host + "/" }
          }];
        });
      }).catch(function () { return trySearch(termIndex, hostIndex + 1); });
    }

    return trySearch(0, 0);
  }).catch(function (error) {
    console.error("[CastSinema HDFilmCehennemi] " + (error && error.message ? error.message : String(error)));
    return [];
  });
}

module.exports = { getStreams: getStreams };
