/* SPDX-License-Identifier: GPL-3.0-only
 * CastSinema Webteizle provider.
 * Scrapes Turkish-dubbed films from Webteizle.
 *
 * The site uses a search form (?q=) and lists results with IMDb ids in poster URLs.
 * Player code is extracted from a data-player-code attribute, base64-reversed,
 * and points at a jwplayer page carrying the HLS manifest.
 *
 * See NOTICE for required attribution.
 */

"use strict";

var HOST = "https://webteizle.info";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function getJson(url, referer) {
  var headers = { "User-Agent": UA, "Accept": "application/json" };
  if (referer) headers.Referer = referer;
  return fetch(url, { headers: headers })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });
}

function getText(url, referer) {
  var headers = { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*" };
  if (referer) headers.Referer = referer;
  return fetch(url, { headers: headers })
    .then(function (r) { return r.ok ? r.text() : ""; })
    .catch(function () { return ""; });
}

// Undoes the JavaScript string escapes in one left-to-right pass.
function unescapeLiteral(body) {
  return String(body || "").replace(/\\\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g,
    function (_, ch) {
      if (ch.charAt(0) === "u") return String.fromCharCode(parseInt(ch.slice(1), 16));
      if (ch.charAt(0) === "x") return String.fromCharCode(parseInt(ch.slice(1), 16));
      if (ch === "n") return "\n";
      if (ch === "t") return "\t";
      if (ch === "r") return "\r";
      if (ch === "b") return "\b";
      if (ch === "f") return "\f";
      if (ch === "0") return "\0";
      return ch;
    });
}

// The player configuration is a JSON string literal handed to JSON.parse.
// Undoing the JavaScript level escapes first leaves valid JSON behind, so
// JSON.parse does the rest.
function extractManifest(html) {
  var text = String(html || "");
  var match = /JSON\.parse\('([\s\S]*?)'\)/.exec(text);
  if (match) {
    try {
      var config = JSON.parse(unescapeLiteral(match[1]));
      if (config && config.file && /\.(m3u8|mp4)/i.test(config.file)) return config.file;
    } catch (_) {}
  }
  // Fallback: the manifest is the only .m3u8 on the page.
  var index = text.indexOf("_master.m3u8");
  if (index < 0) return "";
  var start = text.lastIndexOf("https", index);
  if (start < 0) return "";
  var raw = unescapeLiteral(text.slice(start, index + 13));
  var url = raw.replace(/\\/g, "");
  return /^https?:\/\//i.test(url) ? url : "";
}

// Decode the player code (base64 with reversed character order).
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

// Get TMDB metadata for a movie.
function getMediaInfo(tmdbId) {
  var url = TMDB_API + "/movie/" + encodeURIComponent(String(tmdbId)) +
    "?api_key=" + encodeURIComponent(TMDB_KEY) + "&language=tr-TR&append_to_response=external_ids";
  return fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });
}

// Search the site for a title.
function searchSite(query) {
  return getJson(HOST + "/filtre?q=" + encodeURIComponent(query), HOST + "/")
    .then(function (items) { return Array.isArray(items) ? items : []; })
    .catch(function () { return []; });
}

// Every result carries the IMDb id in its poster path.
function imdbOf(item) {
  var poster = String((item && item.poster_url) || "");
  var match = /(tt\d{7,8})/.exec(poster);
  return match ? match[1] : null;
}

// Pick the best item matching the given IMDb id and titles.
function pickItem(items, imdbId, titles) {
  if (imdbId) {
    for (var i = 0; i < items.length; i++) {
      if (imdbOf(items[i]) === imdbId) return items[i];
    }
  }
  for (var i = 0; i < items.length; i++) {
    var title = String(items[i].title || "").toLowerCase().trim();
    for (var j = 0; j < titles.length; j++) {
      if (title === titles[j].toLowerCase().trim()) return items[i];
    }
  }
  return items.length ? items[0] : null;
}

// Resolve a selected item into playable streams.
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
      var manifest = extractManifest(playerHtml);
      if (!manifest) return [];
      return [{
        name: "CastSinema • Webteizle",
        title: "Webteizle • " + (title || item.title || "Film") + " • HLS 1080p",
        url: manifest,
        quality: 1080,
        provider: "castsinema-webteizle",
        format: "m3u8",
        headers: { "User-Agent": UA, "Referer": pageUrl }
      }];
    });
  });
}

// Main entry point: given a TMDB id, find streams.
function getStreams(tmdbId, mediaType) {
  if (tmdbId == null || mediaType === "tv") return Promise.resolve([]);

  return getMediaInfo(tmdbId).then(function (info) {
    var title = info && info.title ? info.title : "";
    var queries = [title];
    var titles = queries.map(function (t) { return t.toLowerCase().trim(); });

    return searchSite(title).then(function (items) {
      if (!items.length) return [];
      var item = pickItem(items, info && info.imdbId, titles);
      return resolveItem(item, title || "");
    });
  }).catch(function (error) {
    console.error("[CastSinema Webteizle] " + (error && error.message ? error.message : String(error)));
    return [];
  });
}

module.exports = { getStreams: getStreams };