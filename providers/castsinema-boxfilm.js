/* SPDX-License-Identifier: GPL-3.0-only
 * CastSinema BoxFilm provider.
 * Scrapes Turkish dubbed movies from BoxFilm.
 *
 * The site exposes a JSON search API. The player address is stored in a
 * data-player-code attribute, base64 encoded with the character order
 * reversed, and points at a page whose jwplayer configuration carries the
 * HLS manifest. Nothing on the page is executed.
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
    { "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 13; SM-G998B Build/TP1A.220624.014)", "Accept": "*/*" },
    { "User-Agent": "okhttp/4.9.2", "Accept": "*/*" },
    { "User-Agent": "ExoPlayerLib/2.19.1", "Accept": "*/*" },
    { "User-Agent": "stagefright/1.2 (Linux;Android 11)", "Accept": "*/*" },
    { "User-Agent": "VLC/3.0.21 LibVLC/3.0.21", "Accept": "*/*" },
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


var HOST = "https://boxfilm.net";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function getJson(url, referer) {
  var headers = { "User-Agent": UA, "Accept": "application/json" };
  if (referer) headers.Referer = referer;
  return netFetch(url, { headers: headers })
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

// Undoes the JavaScript string escapes in one left to right pass, the same way
// the engine reads the literal.
function unescapeLiteral(body) {
  return String(body || "").replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, function (_, ch) {
    if (ch.charAt(0) === "u") return String.fromCharCode(parseInt(ch.slice(1), 16));
    if (ch.charAt(0) === "x") return String.fromCharCode(parseInt(ch.slice(1), 16));
    if (ch === "n") return "\n";
    if (ch === "t") return "\t";
    if (ch === "r") return "\r";
    if (ch === "b") return "\b";
    if (ch === "f") return "\f";
    if (ch === "v") return "\v";
    if (ch === "0") return "\0";
    return ch;
  });
}

// The player configuration is a JSON string literal handed to JSON.parse.
// Undoing the JavaScript level escapes first leaves valid JSON behind, so
// JSON.parse does the rest.
function extractPlayer(html) {
  var text = String(html || "");
  var match = /JSON\.parse\('(\{[\s\S]*?\})'\)/.exec(text);
  if (match) {
    try {
      var config = JSON.parse(unescapeLiteral(match[1]));
      if (config && config.file && /\.m3u8(?:[?#]|$)/i.test(config.file)) {
        return { file: config.file, tracks: Array.isArray(config.tracks) ? config.tracks : [] };
      }
    } catch (_) {}
  }
  // Fallback: the manifest is the only .m3u8 on the page.
  var index = text.indexOf("_master.m3u8");
  if (index < 0) return null;
  var start = text.lastIndexOf("https", index);
  if (start < 0) return null;
  var url = unescapeLiteral(text.slice(start, index + 13)).replace(/\\/g, "");
  return /^https?:\/\//i.test(url) ? { file: url, tracks: [] } : null;
}

function extractManifest(html) {
  var player = extractPlayer(html);
  return player ? player.file : "";
}

function decodePlayerCode(code) {
  var text = String(code || "");
  if (!text) return "";
  var reversed = text.split("").reverse().join("");
  var url = "";
  try {
    if (typeof atob === "function") url = atob(reversed);
    else if (typeof Buffer !== "undefined") url = Buffer.from(reversed, "base64").toString("utf8");
  } catch (_) {}
  return /^https?:\/\//i.test(url) ? url : "";
}

function getMediaInfo(tmdbId) {
  var url = TMDB_API + "/movie/" + encodeURIComponent(String(tmdbId)) +
    "?api_key=" + encodeURIComponent(TMDB_KEY) + "&language=tr-TR&append_to_response=external_ids";
  return getJson(url, null).then(function (info) {
    if (!info) return null;
    var external = info.external_ids || {};
    return {
      title: info.title || "",
      originalTitle: info.original_title || "",
      imdbId: info.imdb_id || external.imdb_id || null
    };
  });
}

function searchSite(query) {
  return getJson(HOST + "/api/search?q=" + encodeURIComponent(query), HOST + "/")
    .then(function (items) { return Array.isArray(items) ? items : []; })
    .catch(function () { return []; });
}

// Every result carries the IMDb id in its poster path, which is the only
// reliable way to line a result up with the requested title.
function imdbOf(item) {
  var poster = String((item && item.poster_url) || "");
  var match = /(tt\d{7,8})/.exec(poster);
  return match ? match[1] : null;
}

function pickItem(items, imdbId, titles) {
  var i;
  if (imdbId) {
    for (i = 0; i < items.length; i++) {
      if (imdbOf(items[i]) === imdbId) return items[i];
    }
  }
  for (i = 0; i < items.length; i++) {
    var title = String(items[i].title || "").toLowerCase().trim();
    for (var j = 0; j < titles.length; j++) {
      if (title && title === titles[j]) return items[i];
    }
  }
  return items.length ? items[0] : null;
}

function resolveItem(item, title) {
  var slug = item && item.slug ? item.slug : null;
  if (!slug) return Promise.resolve([]);
  var pageUrl = HOST + "/film/" + slug;
  return getText(pageUrl, HOST + "/").then(function (html) {
    if (!html) return [];
    var code = /data-player-code="([^"]+)"/i.exec(html);
    if (!code) return [];
    var playerUrl = decodePlayerCode(code[1]);
    if (!playerUrl) return [];
    return getText(playerUrl, pageUrl).then(function (playerHtml) {
      var player = extractPlayer(playerHtml);
      if (!player || !player.file) return [];
      var subs = [];
      for (var i = 0; i < player.tracks.length; i++) {
        var track = player.tracks[i] || {};
        if (!track.file) continue;
        var label = String(track.label || track.language || "Altyazi").trim();
        subs.push({
          url: track.file,
          language: /t[üu]rk/i.test(label) ? "tr" : (/eng/i.test(label) ? "en" : ""),
          name: label + " [BoxFilm]",
          headers: { "User-Agent": UA, Referer: playerUrl }
        });
      }
      // The HLS CDN only answers requests whose Referer is the player host.
      var headers = { "User-Agent": UA, "Referer": playerUrl, "Origin": "https://boxload.xyz" };
      return [{
        name: "CastSinema • BoxFilm",
        title: "BoxFilm • " + (title || item.title || "Film") + " • " + (item.language_label || "DUAL") + " • 1080p",
        url: player.file,
        quality: 1080,
        provider: "castsinema-boxfilm",
        format: "m3u8",
        headers: headers,
        behaviorHints: { notWebReady: true, proxyHeaders: { request: headers } },
        subtitles: subs
      }];
    });
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null || mediaType === "tv") return Promise.resolve([]);

  return getMediaInfo(tmdbId).then(function (info) {
    var title = info && info.title ? info.title : "";
    var original = info && info.originalTitle ? info.originalTitle : "";
    var queries = [];
    if (title) queries.push(title);
    if (original && original !== title) queries.push(original);
    if (!queries.length) queries.push(String(tmdbId));
    var titles = queries.map(function (t) { return t.toLowerCase().trim(); });

    return queries.reduce(function (chain, query) {
      return chain.then(function (acc) {
        if (acc.length) return acc;
        return searchSite(query).then(function (items) {
          if (!items.length) return acc;
          var item = pickItem(items, info && info.imdbId, titles);
          return resolveItem(item, title || original).then(function (streams) {
            return acc.length ? acc : streams;
          });
        });
      });
    }, Promise.resolve([]));
  })
    .catch(function (error) {
      console.error("[CastSinema BoxFilm] " + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = { getStreams: getStreams };
