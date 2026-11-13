/* SPDX-License-Identifier: MIT
 * CastSinema Anime provider.
 * Scrapes Turkish dubbed anime content from anime APIs.
 * 
 * The site uses a JSON API to search for anime series and films with Turkish dubbing.
 * 
 * This is a completely original implementation for CastSinema-Addons.
 */

"use strict";

var HOST = "https://anime.api";
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

function getMediaInfo(tmdbId) {
  var url = TMDB_API + "/movie/" + encodeURIComponent(String(tmdbId)) +
    "?api_key=" + encodeURIComponent(TMDB_KEY) + "&language=tr-TR&append_to_response=external_ids";
  return fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });
}

function searchSite(query) {
  return getJson(HOST + "/api/search?q=" + encodeURIComponent(query), HOST + "/")
    .then(function (items) { return Array.isArray(items) ? items : []; })
    .catch(function () { return []; });
}

function imdbOf(item) {
  var poster = String((item && item.poster_url) || "");
  var match = /(tt\d{7,8})/.exec(poster);
  return match ? match[1] : null;
}

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

function resolveItem(item, title) {
  var slug = item && item.slug ? item.slug : null;
  if (!slug) return Promise.resolve([]);
  var pageUrl = HOST + "/anime/" + slug;
  return getText(pageUrl, HOST + "/").then(function (html) {
    if (!html) return [];
    var code = /data-player-code="([^"]+)"/i.exec(html);
    if (!code) return [];
    var reversed = code[1].split("").reverse().join("");
    var playerUrl = "";
    try {
      if (typeof atob === "function") playerUrl = atob(reversed);
      else if (typeof Buffer !== "undefined") playerUrl = Buffer.from(reversed, "base64").toString("utf8");
    } catch (_) {}
    if (!playerUrl) return [];
    return getText(playerUrl, pageUrl).then(function (playerHtml) {
      var match = /JSON\.parse\('([\s\S]*?)'\)/.exec(playerHtml);
      if (!match) return [];
      try {
        var config = JSON.parse(match[1].replace(/\\u([0-9a-fA-F]{4})/g, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); }));
        if (config && config.file) {
          return [{ name: "CastSinema • Anime", title: "Anime • " + (title || item.title || "Anime") + " • Türkçe Dublaj", url: config.file, quality: 1080, provider: "castsinema-anime", format: "m3u8", headers: { "User-Agent": UA, "Referer": pageUrl } }];
        }
      } catch (_) {}
      return [];
    });
  });
}

function getStreams(tmdbId, mediaType) {
  if (tmdbId == null || mediaType === "movie") return Promise.resolve([]);

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
    console.error("[CastSinema Anime] " + (error && error.message ? error.message : String(error)));
    return [];
  });
}

module.exports = { getStreams: getStreams };