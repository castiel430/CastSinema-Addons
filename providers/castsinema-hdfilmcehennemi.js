/* SPDX-License-Identifier: GPL-3.0-only
 * CastSinema HDFilmCehennemi native HTML/JS scraper for CastSinema.
 * Direct scraper extracting streams from HDFilmCehennemi.
 *
 * The search endpoint is /search?q=<term> and answers with JSON when the
 * X-Requested-With header is present. Episode URLs are read from the series
 * page because an episode slug differs from the series slug.
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


var HOSTS = ["https://hdfilmcehennemi.la", "https://www.hdfilmcehennemi.la", "https://www.hdfilmcehennemi.nl", "https://hdfilmcehennemi.com"];
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

function parseJson(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

function searchHdf(host, query) {
  return netFetch(host + "/search?q=" + encodeURIComponent(query), {
    headers: {
      "User-Agent": UA,
      "Referer": host + "/",
      "X-Requested-With": "fetch",
      "Accept": "application/json"
    }
  })
    .then(function (r) { return r.ok ? r.text() : ""; })
    .catch(function () { return ""; });
}

// The JSON payload carries a list of rendered anchors.
function extractLinks(raw) {
  var links = [];
  var text = String(raw || "");
  var data = parseJson(text);
  if (data && Array.isArray(data.results)) {
    for (var i = 0; i < data.results.length; i++) {
      var match = /href="([^"]+)"/i.exec(data.results[i]);
      if (match) links.push(match[1]);
    }
  }
  if (!links.length) {
    var fallback = /href="(https?:\/\/[^"]*hdfilmcehennemi[^"]+)"/gi;
    var found;
    while ((found = fallback.exec(text)) !== null) links.push(found[1]);
  }
  return links;
}

// Trailer hosts are not episode sources; they must never be returned.
var TRAILER_HOST = /youtube\.com|youtube-nocookie\.com|youtu\.be|dailymotion\.com|vimeo\.com/i;

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

// Episodes render their player lazily: the source id travels in a data-video
// attribute and the markup is served by /video/<id>/.
function findVideoId(html) {
  var match = /data-video="([^"]+)"/i.exec(String(html || ""));
  return match ? match[1] : "";
}

function fetchVideoMarkup(host, id) {
  return netFetch(host + "/video/" + encodeURIComponent(id) + "/", {
    headers: { "User-Agent": UA, "X-Requested-With": "fetch", "Accept": "application/json" }
  })
    .then(function (r) { return r.ok ? r.text() : ""; })
    .then(function (text) {
      var data = parseJson(text);
      return data && data.data && data.data.html ? data.data.html : "";
    })
    .catch(function () { return ""; });
}

// Episode links are listed on the series page; their slug is not the series slug.
function findEpisode(html, host, season, episode) {
  var pattern = new RegExp('href="([^"]*sezon-' + season + '[\\\\/]bolum-' + episode + '[^"]*)"', "i");
  var match = pattern.exec(String(html || ""));
  if (!match) return "";
  var url = match[1];
  if (/^https?:\/\//i.test(url)) return url;
  return host + (url.charAt(0) === "/" ? url : "/" + url);
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
    if (!ctx || !ctx.raw) return [];

    var links = extractLinks(ctx.raw);
    if (!links.length) return [];

    var itemUrl = "";
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (isTv) {
        if (/\/dizi\//i.test(link)) { itemUrl = link; break; }
      } else if (!/\/dizi\//i.test(link)) {
        itemUrl = link;
        break;
      }
    }
    if (!itemUrl && links.length) itemUrl = links[0];
    if (!itemUrl) return [];

    return netFetch(itemUrl, {
      headers: { "User-Agent": UA, "Referer": ctx.host + "/", "Accept": "text/html,application/xhtml+xml" }
    })
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (pageHtml) {
        if (!pageHtml) return [];
        if (!isTv) return buildStreams(pageHtml, ctx, null, null);

        var episodeUrl = findEpisode(pageHtml, ctx.host, season, episode);
        if (!episodeUrl) return [];
        return netFetch(episodeUrl, {
          headers: { "User-Agent": UA, "Referer": ctx.host + "/", "Accept": "text/html,application/xhtml+xml" }
        })
          .then(function (r) { return r.ok ? r.text() : ""; })
          .then(function (episodeHtml) {
            if (!episodeHtml) return [];
            var direct = findPlayer(episodeHtml);
            if (direct) return buildStreams(episodeHtml, ctx, season, episode);
            // The player markup is served separately for episodes.
            var videoId = findVideoId(episodeHtml);
            if (!videoId) return [];
            return fetchVideoMarkup(ctx.host, videoId).then(function (markup) {
              if (!markup) return [];
              var embedUrl = findPlayer(markup);
              if (!embedUrl) return [];
              return [buildStream(embedUrl, ctx, season, episode)];
            });
          });
      });
  })
    .catch(function (error) {
      console.error("[CastSinema HDFilmCehennemi] " + (error && error.message ? error.message : String(error)));
      return [];
    });

  function buildStream(embedUrl, ctx, season, episode) {
    var label = ctx.title || "İçerik";
    if (season != null) label = label + " • S" + season + "E" + episode;
    return {
      name: "CastSinema • HDFilmCehennemi",
      title: "HDFilmCehennemi • " + label + " • 1080p",
      url: embedUrl,
      quality: 1080,
      provider: "castsinema-hdfilmcehennemi",
      format: "video",
      headers: { "User-Agent": UA, "Referer": ctx.host + "/" }
    };
  }

  function buildStreams(pageHtml, ctx, season, episode) {
    var embedUrl = findPlayer(pageHtml);
    if (!embedUrl) return [];
    return [buildStream(embedUrl, ctx, season, episode)];
  }

  function tryHosts(term, ctx) {
    var index = 0;
    function next() {
      if (index >= HOSTS.length) return Promise.resolve(null);
      var host = HOSTS[index++];
      return searchHdf(host, term).then(function (raw) {
        if (!raw) return next();
        ctx.host = host;
        return { raw: raw, host: host, title: ctx.title, imdbId: ctx.imdbId };
      }).catch(function () { return next(); });
    }
    return next();
  }
}

module.exports = { getStreams: getStreams };
