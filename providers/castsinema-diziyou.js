/* SPDX-License-Identifier: MIT
 * CastSinema DiziYou provider.
 * Turkish series/movie scraper for DiziYou (diziyou.one).
 *
 * Verified flow (live site, 2026-11): player iframe -> direct m3u8 + VTT tracks.
 * Flow logic adapted from the working BigBull CS Nuvio addon (MIT).
 */
"use strict";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
var BASE = "https://www.diziyou.one";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";

function text(url, opts) {
  var o = opts || {};
  var headers = { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9" };
  if (o.referer) headers.Referer = o.referer;
  if (o.headers) for (var k in o.headers) headers[k] = o.headers[k];
  return fetch(url, { method: o.method || "GET", headers: headers, body: o.body })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
      return r.text();
    });
}

function first(pattern, body) {
  var m = pattern.exec(String(body || ""));
  return m ? m[1] : null;
}

function abs(base, href) {
  if (!href) return null;
  if (/^https?:/i.test(href)) return href;
  var origin = /^(https?:\/\/[^/]+)/.exec(base);
  if (href.charAt(0) === "/") return origin ? origin[1] + href : href;
  return base.replace(/[^/]*$/, "") + href;
}

function titleOf(id, mediaType) {
  var path = mediaType === "tv" ? "/tv/" : "/movie/";
  return text(TMDB_API + path + encodeURIComponent(String(id)) + "?api_key=" + TMDB_KEY + "&language=tr-TR")
    .then(function (body) {
      var meta = JSON.parse(body) || {};
      return String(meta.title || meta.name || meta.original_title || meta.original_name || "").trim();
    })
    .catch(function () { return ""; });
}

function sameTitle(have, want) {
  function f(v) {
    return String(v || "").replace(/[ıİI]/g, "i").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g")
      .replace(/[çÇ]/g, "c").replace(/[öÖ]/g, "o").replace(/[üÜ]/g, "u")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  have = f(have);
  want = f(want);
  return !!want && (have === want || have.indexOf(want + " ") === 0);
}

function getStreams(tmdbId, mediaType, season, episode) {
  var want = parseInt(season, 10) || 1;
  var wantEp = parseInt(episode, 10) || 1;
  var isMovie = mediaType !== "tv" && mediaType !== "series" && mediaType !== "show";
  var episodeUrl = null;

  return titleOf(tmdbId, mediaType).then(function (title) {
    if (!title) return null;
    return text(BASE + "/?s=" + encodeURIComponent(title)).then(function (search) {
      if (!search) return null;
      var link = null;
      var cardRe = /<div class="cat-img"><a href="([^"]+)">[\s\S]*?<div id="categorytitle"><a href="[^"]*">([^<]*)<\/a>/g;
      var card;
      while ((card = cardRe.exec(search)) !== null) {
        if (sameTitle(card[2], title)) { link = card[1]; break; }
      }
      if (!link) return null;
      return abs(BASE, link);
    });
  }).then(function (series) {
    if (!series) return [];
    return text(series).then(function (detail) {
      if (!detail) return [];
      var links = [];
      var re = /href="([^"]*-sezon-[^"]*-bolum\/)"/g;
      var m;
      while ((m = re.exec(detail)) !== null) links.push(m[1]);
      if (!links.length) return [];
      var exact = "-" + want + "-sezon-" + wantEp + "-bolum/";
      episodeUrl = null;
      for (var i = 0; i < links.length; i++) {
        if (links[i].indexOf(exact) !== -1) { episodeUrl = links[i]; break; }
      }
      if (!episodeUrl) return [];
      return text(episodeUrl);
    });
  }).then(function (page) {
    if (!page) return [];
    var iframe = first(/id="diziyouPlayer"[^>]+src="([^"]+)"/, page);
    if (!iframe) iframe = first(/<iframe[^>]+src="([^"]+)"/, page);
    if (!iframe) return [];
    var playerUrl = abs(episodeUrl, iframe);
    return text(playerUrl, { referer: episodeUrl }).then(function (player) {
      if (!player) return [];
      var src = first(/<source[^>]+src="([^"]+\.m3u8[^"]*)"/, player);
      if (!src) return [];
      var url = abs(playerUrl, src);
      var subs = [];
      var re = /<track[^>]+src="([^"]+)"[^>]*(?:label="([^"]*)")?/g;
      var m;
      while ((m = re.exec(player)) !== null) {
        var lang = (first(/([a-z]{2})\.vtt/i, m[1]) || "tr").toLowerCase();
        subs.push({ url: abs(playerUrl, m[1]), language: lang, name: (m[2] || lang.toUpperCase()) + " [diziyou]" });
      }
      return [{
        name: "CastSinema • DiziYou",
        title: "DiziYou • 1080p • HLS",
        url: url,
        quality: 1080,
        provider: "castsinema-diziyou",
        format: "m3u8",
        headers: { "User-Agent": UA, "Referer": episodeUrl, "Accept": "*/*" },
        behaviorHints: { notWebReady: true, proxyHeaders: { request: { "User-Agent": UA, "Referer": episodeUrl } } },
        subtitles: subs.slice(0, 4)
      }];
    });
  }).catch(function (e) {
    console.error("[CastSinema DiziYou] " + (e && e.message ? e.message : String(e)));
    return [];
  });
}

module.exports = { getStreams: getStreams };
