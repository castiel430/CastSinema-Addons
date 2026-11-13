/* SPDX-License-Identifier: GPL-3.0-only
 * CastSinema FilmMakinesi native HTML/JS scraper for CastSinema.
 * Scrapes Turkish dubbed movies and series from FilmMakinesi.
 *
 * The site exposes an IMDb id lookup at /arama/?s=<imdb>, which returns the
 * exact match as a single result. Episode URLs are read from the series page
 * because the slug of an episode differs from the slug of the series.
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


var HOSTS = ["https://filmmakinesi.to", "https://filmmakinesi.tv", "https://filmmakinesi.co"];
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function getMediaInfo(tmdbId, isTv) {
  var path = isTv ? "/tv/" : "/movie/";
  var url = TMDB_API + path + encodeURIComponent(String(tmdbId)) +
    "?api_key=" + encodeURIComponent(TMDB_KEY) + "&language=tr-TR&append_to_response=external_ids";
  return netFetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (info) {
      if (!info) return null;
      var external = info.external_ids || {};
      return {
        title: info.title || info.name || info.original_title || info.original_name || "",
        imdbId: info.imdb_id || external.imdb_id || null
      };
    })
    .catch(function () { return null; });
}

function searchFilmMakinesi(host, query) {
  return netFetch(host + "/arama/?s=" + encodeURIComponent(query), {
    headers: { "User-Agent": UA, "Referer": host + "/", "Accept": "text/html,application/xhtml+xml" }
  })
    .then(function (r) { return r.ok ? r.text() : ""; })
    .catch(function () { return ""; });
}

function absolute(host, href) {
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  if (href.charAt(0) === "/") return host + href;
  return host + "/" + href;
}

// Result tiles look like <a class="item" href="..." data-title="...">.
function findResult(html, host, imdbId, title) {
  var tags = String(html || "").match(/<a\b[^>]*class="[^"]*\bitem\b[^"]*"[^>]*>/gi) || [];
  var normalized = String(title || "").toLowerCase().trim();
  var first = null;
  for (var i = 0; i < tags.length; i++) {
    var tag = tags[i];
    var href = /href="([^"]+)"/i.exec(tag);
    if (!href) continue;
    var link = absolute(host, href[1]);
    if (!first) first = link;
    var dataTitle = /data-title="([^"]*)"/i.exec(tag);
    if (normalized && dataTitle && dataTitle[1].toLowerCase().trim() === normalized) return link;
  }
  return first;
}

// Trailer hosts are not episode sources; they must never be returned.
var TRAILER_HOST = /youtube\.com|youtube-nocookie\.com|youtu\.be|dailymotion\.com|vimeo\.com/i;

// The player iframe is served on a dedicated subdomain.
function findPlayer(html) {
  var tags = String(html || "").match(/<iframe\b[^>]*>/gi) || [];
  var fallback = "";
  for (var i = 0; i < tags.length; i++) {
    var tag = tags[i];
    var src = /data-src="([^"]+)"/i.exec(tag) || /\ssrc="([^"]+)"/i.exec(tag);
    if (!src) continue;
    var url = src[1];
    if (/^\/\//.test(url)) url = "https:" + url;
    if (!/^https?:\/\//i.test(url)) continue;
    if (/\/video\/embed\//i.test(url)) return url;
    if (TRAILER_HOST.test(url)) continue;
    if (!fallback && /(?:embed|player|oynat)/i.test(url)) fallback = url;
  }
  return fallback;
}

// Episode links are listed on the series page; their slug is not the series slug.
function findEpisode(html, host, season, episode) {
  var pattern = new RegExp('href="([^"]*sezon-' + season + '[\\\\/]bolum-' + episode + '[^"]*)"', "i");
  var match = pattern.exec(String(html || ""));
  return match ? absolute(host, match[1]) : "";
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  var isTv = mediaType === "tv" && season != null && episode != null;

  return getMediaInfo(tmdbId, isTv).then(function (info) {
    var title = info && info.title ? info.title : "";
    var imdbId = info && info.imdbId ? info.imdbId : null;
    var terms = imdbId ? [imdbId, title] : [title || String(tmdbId)];
    return { title: title, imdbId: imdbId, terms: terms, index: 0 };
  }).then(function (ctx) {
    if (!ctx || !ctx.terms.length) return [];

    function attempt() {
      if (ctx.index >= ctx.terms.length) return Promise.resolve(null);
      var term = ctx.terms[ctx.index++];
      if (!term) return attempt();
      return tryHosts(term, ctx).then(function (result) {
        return result || attempt();
      });
    }
    return attempt();
  }).then(function (ctx) {
    if (!ctx || !ctx.html) return [];

    var itemUrl = findResult(ctx.html, ctx.host, ctx.imdbId, ctx.title);
    if (!itemUrl) return [];

    var isSeries = /\/dizi\//i.test(itemUrl);
    if (isTv && !isSeries) return [];

    return netFetch(itemUrl, {
      headers: { "User-Agent": UA, "Referer": ctx.host + "/", "Accept": "text/html,application/xhtml+xml" }
    })
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (pageHtml) {
        if (!pageHtml) return [];
        var target = itemUrl;

        if (isTv) {
          var episodeUrl = findEpisode(pageHtml, ctx.host, season, episode);
          if (!episodeUrl) return [];
          target = episodeUrl;
          return netFetch(target, {
            headers: { "User-Agent": UA, "Referer": ctx.host + "/", "Accept": "text/html,application/xhtml+xml" }
          })
            .then(function (r) { return r.ok ? r.text() : ""; })
            .then(function (episodeHtml) { return buildStreams(episodeHtml, ctx, season, episode); });
        }
        return buildStreams(pageHtml, ctx, null, null);
      });
  })
    .catch(function (error) {
      console.error("[CastSinema FilmMakinesi] " + (error && error.message ? error.message : String(error)));
      return [];
    });

  function buildStreams(pageHtml, ctx, season, episode) {
    var embedUrl = findPlayer(pageHtml);
    if (!embedUrl) return [];
    var label = ctx.title || "Film";
    if (season != null) label = label + " • S" + season + "E" + episode;
    return [{
      name: "CastSinema • FilmMakinesi",
      title: "FilmMakinesi • " + label + " • 1080p",
      url: embedUrl,
      quality: 1080,
      provider: "castsinema-filmmakinesi",
      format: "video",
      headers: { "User-Agent": UA, "Referer": ctx.host + "/" }
    }];
  }

  function tryHosts(term, ctx) {
    var index = 0;
    function next() {
      if (index >= HOSTS.length) return Promise.resolve(null);
      var host = HOSTS[index++];
      return searchFilmMakinesi(host, term).then(function (html) {
        if (!html) return next();
        ctx.host = host;
        return { html: html, host: host, title: ctx.title, imdbId: ctx.imdbId };
      }).catch(function () { return next(); });
    }
    return next();
  }
}

module.exports = { getStreams: getStreams };
