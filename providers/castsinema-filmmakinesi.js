/* SPDX-License-Identifier: MIT
 * CastSinema FilmMakinesi provider.
 * Turkish movie/series scraper for FilmMakinesi.
 * Logic learned from Wiojelt/Nuvio-Addons and rewritten for CastSinema.
 */
"use strict";

var HOSTS = ["https://filmmakinesi.co", "https://filmmakinesi.to", "https://filmmakinesi.film", "https://filmmakinesi.tv"];
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
          if (!pageHtml) return tryHosts(termIndex, hostIndex + 1);
          var embedUrl = findPlayer(pageHtml);
          if (!embedUrl) return tryHosts(termIndex, hostIndex + 1);
          return resolvePlayable(embedUrl, targetUrl, 0).then(function (mediaUrls) {
            if (!mediaUrls || !mediaUrls.length) return tryHosts(termIndex, hostIndex + 1);
            var label = title || "İçerik";
            if (isTv) label += " • S" + season + "E" + episode;
            var streams = [];
            for (var i = 0; i < mediaUrls.length && streams.length < 4; i++) {
              var murl = mediaUrls[i];
              var fmt = guessFormat(murl);
              streams.push({
                name: "CastSinema • FilmMakinesi",
                title: "FilmMakinesi • " + label + (fmt === "m3u8" ? " • HLS" : " • MP4"),
                url: murl,
                quality: 1080,
                provider: "castsinema-filmmakinesi",
                format: fmt,
                headers: { "User-Agent": UA, "Referer": embedUrl, "Origin": originOf(embedUrl) },
                behaviorHints: { notWebReady: true, proxyHeaders: { request: { "User-Agent": UA, "Referer": embedUrl, "Origin": originOf(embedUrl) } } }
              });
            }
            return streams.length ? streams : tryHosts(termIndex, hostIndex + 1);
          });
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
