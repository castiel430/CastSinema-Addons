/* SPDX-License-Identifier: MIT
 * CastSinema FilmMakinesi provider.
 * Turkish movie/series scraper for FilmMakinesi.
 * Logic learned from Wiojelt/Nuvio-Addons and rewritten for CastSinema.
 */
"use strict";

var HOSTS = ["https://filmmakinesi.tv", "https://filmmakinesi.co", "https://filmmakinesi.to"];
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

function getMediaInfo(tmdbId, isTv) {
  var path = isTv ? "/tv/" : "/movie/";
  return getJson(TMDB_API + path + "/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_KEY + "&language=tr-TR&append_to_response=external_ids");
}

function searchFilmMakinesi(host, query) {
  return getText(host + "/?s=" + encodeURIComponent(query), host + "/");
}

function absolute(host, href) {
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  if (href.charAt(0) === "/") return host + href;
  return host + "/" + href;
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
    if (/\/video\/embed\/|player|embed|oynat/i.test(url)) return url;
    if (!fallback) fallback = url;
  }
  return fallback;
}

function findResult(html, host) {
  var text = String(html || "");
  var m = /<a[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*\bmini-poster\b[^"']*["']/i.exec(text) ||
          /<a[^>]*class=["'][^"']*\bmini-poster\b[^"']*["'][^>]*href=["']([^"']+)["']/i.exec(text);
  if (m) return absolute(host, m[1]);
  m = /<a[^>]*class=["'][^"']*\bitem\b[^"']*["'][^>]*href=["']([^"']+)["']/i.exec(text) ||
      /<a[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*\bitem\b[^"']*["']/i.exec(text);
  if (m) return absolute(host, m[1]);
  m = /href=["']((?:https?:\/\/[^"']+)?\/[^"']*(?:film|dizi)\/[^"']+)["']/i.exec(text);
  return m ? absolute(host, m[1]) : "";
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  var isTv = mediaType === "tv" && season != null && episode != null;

  return getMediaInfo(tmdbId, isTv).then(function (info) {
    var title = info ? (info.title || info.name || info.original_title || info.original_name) : "";
    var imdbId = info && info.external_ids && info.external_ids.imdb_id ? info.external_ids.imdb_id : (info && info.imdb_id ? info.imdb_id : "");
    var terms = [];
    if (imdbId) terms.push(imdbId);
    if (title) terms.push(title);
    if (info && info.original_title && info.original_title !== title) terms.push(info.original_title);
    if (!terms.length) terms.push(String(tmdbId));

    function tryHosts(termIndex, hostIndex) {
      if (termIndex >= terms.length) return Promise.resolve([]);
      if (hostIndex >= HOSTS.length) return tryHosts(termIndex + 1, 0);
      var host = HOSTS[hostIndex];
      var term = terms[termIndex];
      return searchFilmMakinesi(host, term).then(function (html) {
        if (!html) return tryHosts(termIndex, hostIndex + 1);
        var itemUrl = findResult(html, host);
        if (!itemUrl) return tryHosts(termIndex, hostIndex + 1);
        var isSeries = /\/dizi\//i.test(itemUrl);
        if (isTv && !isSeries) return tryHosts(termIndex, hostIndex + 1);
        if (!isTv && isSeries) {
          // allow but prefer movies
        }
        var targetUrl = itemUrl;
        if (isTv) {
          targetUrl = itemUrl.replace(/\/$/, "") + "/sezon-" + season + "-bolum-" + episode + "/";
        }
        return getText(targetUrl, host + "/").then(function (pageHtml) {
          if (!pageHtml && isTv) return tryHosts(termIndex, hostIndex + 1);
          if (!pageHtml) return tryHosts(termIndex, hostIndex + 1);
          var embedUrl = findPlayer(pageHtml);
          if (!embedUrl) return tryHosts(termIndex, hostIndex + 1);
          var label = title || "İçerik";
          if (isTv) label += " • S" + season + "E" + episode;
          return [{
            name: "CastSinema • FilmMakinesi",
            title: "FilmMakinesi • " + label + " • 1080p",
            url: embedUrl,
            quality: 1080,
            provider: "castsinema-filmmakinesi",
            format: "video",
            headers: { "User-Agent": UA, "Referer": host + "/" }
          }];
        });
      }).catch(function () { return tryHosts(termIndex, hostIndex + 1); });
    }

    return tryHosts(0, 0);
  }).catch(function (error) {
    console.error("[CastSinema FilmMakinesi] " + (error && error.message ? error.message : String(error)));
    return [];
  });
}

module.exports = { getStreams: getStreams };
