/* SPDX-License-Identifier: MIT
 * CastSinema DiziBal provider.
 * Turkish series/movie scraper for DiziBal (dizibal.org).
 *
 * Verified flow (live site, 2026-11): pilavyer HLS akisi + altyazilar.
 * Flow logic adapted from the working BigBull CS Nuvio addon (MIT).
 */
"use strict";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
var BASE = "https://dizibal.org";
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
  if (!origin) return href;
  if (href.indexOf("//") === 0) return "https:" + href;
  if (href.charAt(0) === "/") return origin[1] + href;
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

function playerConfig(frame) {
  var m = /window\.__PLAYER__\s*=\s*(\{[\s\S]*?\});/.exec(String(frame || ""));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

function qualityOf(master, fallback) {
  var re = /RESOLUTION=\d+x(\d+)/g;
  var best = 0;
  var m;
  while ((m = re.exec(String(master || ""))) !== null) {
    var h = parseInt(m[1], 10);
    if (h > best) best = h;
  }
  return best ? best + "p" : (fallback || "auto");
}

function resolvePlayer(pageUrl) {
  return text(pageUrl).then(function (page) {
    var pv = first(/data-pv="([^"]+)"/, page);
    if (!pv) return null;
    var core = first(/<script[^>]+src="([^"]*core\.js[^"]*)"/, page);
    var playerBase = core ? abs(pageUrl, core).replace(/\/assets\/js\/core\.js.*$/, "") : "https://pilavyerplay.top";
    return text(playerBase + "/assets/js/s.php?s=" + encodeURIComponent(pv), { referer: pageUrl }).then(function (frame) {
      var cfg = playerConfig(frame);
      return cfg && cfg.stream ? { cfg: cfg, playerBase: playerBase } : null;
    });
  });
}

function rowsOf(found) {
  return text(found.cfg.stream, { referer: found.playerBase + "/" })
    .catch(function () { return ""; })
    .then(function (master) {
      var quality = qualityOf(master, "1080p");
      var subs = [];
      var list = found.cfg.subs || [];
      for (var i = 0; i < list.length && subs.length < 4; i++) {
        var sub = list[i] || {};
        if (!sub.src) continue;
        var lang = String(sub.lang || "tr").toLowerCase();
        subs.push({ url: sub.src, language: lang, name: String(sub.label || lang.toUpperCase()) + " [DiziBal]" });
      }
      return [{
        name: "CastSinema • DiziBal",
        title: "DiziBal • " + quality + " • HLS",
        url: found.cfg.stream,
        quality: quality,
        provider: "castsinema-dizibal",
        format: "m3u8",
        headers: { "User-Agent": UA, "Referer": found.playerBase + "/", "Accept": "*/*" },
        behaviorHints: { notWebReady: true, proxyHeaders: { request: { "User-Agent": UA, "Referer": found.playerBase + "/" } } },
        subtitles: subs
      }];
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var want = parseInt(season, 10) || 1;
  var wantEp = parseInt(episode, 10) || 1;
  var isMovie = mediaType !== "tv" && mediaType !== "series" && mediaType !== "show";
  var contentUrl = null;

  return titleOf(tmdbId, mediaType).then(function (title) {
    if (!title) return null;
    return text(BASE + "/ara?q=" + encodeURIComponent(title)).then(function (search) {
      if (!search) return null;
      var pattern = isMovie ? /href="([^"]*\/movie\/[^"?#]+)"/ : /href="([^"]*\/series\/[^"?#]+)"/;
      var link = null;
      var cardRe = new RegExp(pattern.source + "[^>]*>[\\s\\S]{0,900}?alt=\"([^\"]*)\"", "g");
      var card;
      while ((card = cardRe.exec(search)) !== null) {
        if (sameTitle(card[2].replace(/\s+(?:Dizi|Film)\s+izle\s*$/i, ""), title)) {
          link = card[1];
          break;
        }
      }
      if (!link) return null;
      contentUrl = abs(BASE, link).replace(/\/+$/, "");
      return text(contentUrl);
    });
  }).then(function (page) {
    if (!page) return [];
    var slug = contentUrl.split("/").pop();
    var playerUrl = isMovie
      ? contentUrl + "/izle"
      : BASE + "/series/" + slug + "/season/" + want + "/episode/" + wantEp;
    var re = /href="([^"]*\/season\/(\d+)\/episode\/(\d+))"/g;
    var m;
    while ((m = re.exec(page)) !== null) {
      if (parseInt(m[2], 10) === want && parseInt(m[3], 10) === wantEp) return abs(contentUrl, m[1]);
    }
    return playerUrl;
  }).then(resolvePlayer).then(function (found) {
    return found ? rowsOf(found) : [];
  }).catch(function (e) {
    console.error("[CastSinema DiziBal] " + (e && e.message ? e.message : String(e)));
    return [];
  });
}

module.exports = { getStreams: getStreams };
