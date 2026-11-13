/* SPDX-License-Identifier: MIT
 * CastSinema DiziBox provider.
 * Turkish series scraper for DiziBox (dizibox.live).
 *
 * Verified flow (live site, 2026-11):
 *   TMDB id -> title
 *   -> GET /search/<title>/  -> series page (detailed-article cards)
 *   -> season-episode links -> episode page
 *   -> video-area iframe -> king.php?wmode=opaque&v=... -> Player iframe
 *   -> /embed/sheila/... (answers only with a Referer) -> HLS master
 *
 * Flow logic follows the working reference implementation published in the
 * BigBull CS Nuvio addon (MIT); rewritten for the CastSinema runtime.
 */
"use strict";

var HOST = "https://www.dizibox.live";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function requestProfiles() {
  return [
    { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9" },
    { "User-Agent": "okhttp/4.9.2" },
    { "User-Agent": "ExoPlayerLib/2.19.1" },
    { "User-Agent": "stagefright/1.2 (Linux;Android 11)" },
    { "User-Agent": "VLC/3.0.21 LibVLC/3.0.21" },
    { "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 13; SM-G998B Build/TP1A.220624.014)" },
    {}
  ];
}
var KEEP_HEADERS = ["accept", "referer", "origin", "range", "cookie", "content-type"];
function mergeHeaders(base, profile) {
  var headers = {}, key;
  for (key in base) {
    if (!Object.prototype.hasOwnProperty.call(base, key)) continue;
    if (KEEP_HEADERS.indexOf(String(key).toLowerCase()) === -1) continue;
    headers[key] = base[key];
  }
  for (key in profile) { if (Object.prototype.hasOwnProperty.call(profile, key)) headers[key] = profile[key]; }
  return headers;
}
function isRefused(response) {
  if (!response) return true;
  if (typeof response.status !== "number") return false;
  return response.status === 403 || response.status === 404 || response.status === 429 || response.status === 503;
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
function getText(url, headers) {
  return netFetch(url, { headers: headers || { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*" } })
    .then(function (r) { return r && r.ok ? r.text() : ""; })
    .catch(function () { return ""; });
}
function getJson(url, headers) {
  return netFetch(url, { headers: headers || { "User-Agent": UA, "Accept": "application/json" } })
    .then(function (r) { return r && r.ok ? r.json() : null; })
    .catch(function () { return null; });
}

function abs(base, href) {
  if (!href) return "";
  var v = String(href).trim();
  if (/^https?:/i.test(v)) return v;
  var origin = /^(https?:\/\/[^/]+)/.exec(base);
  if (v.charAt(0) === "/") return origin ? origin[1] + v : v;
  return String(base).replace(/[^/]*$/, "") + v;
}
function norm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[ıI]/g, "i").replace(/[şS]/g, "s").replace(/[ğG]/g, "g")
    .replace(/[üÜ]/g, "u").replace(/[öÖ]/g, "o").replace(/[çÇ]/g, "c")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
function sameTitle(have, want) {
  var a = norm(have), b = norm(want);
  if (!b) return false;
  return a === b || a.indexOf(b + " ") === 0 || b.indexOf(a + " ") === 0;
}
function first(pattern, body) {
  var m = pattern.exec(String(body || ""));
  return m ? m[1] : null;
}

function getMediaInfo(tmdbId) {
  return getJson(TMDB_API + "/tv/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_KEY + "&language=tr-TR&append_to_response=external_ids,translations");
}

function collectTitles(info) {
  var titles = [];
  function add(v) {
    var s = String(v || "").trim();
    if (!s) return;
    for (var i = 0; i < titles.length; i++) if (norm(titles[i]) === norm(s)) return;
    titles.push(s);
  }
  if (!info) return titles;
  add(info.name);
  add(info.original_name);
  var tr = (info.translations && info.translations.translations) || [];
  for (var i = 0; i < tr.length; i++) {
    if (!tr[i] || tr[i].iso_639_1 !== "tr") continue;
    add(tr[i].data && tr[i].data.name);
  }
  return titles;
}

function episodeLinks(html) {
  var out = [];
  var re = /href=["']([^"']+)["'][^>]*class=["'][^"']*season-episode[^"']*["']/g;
  var m;
  while ((m = re.exec(String(html || ""))) !== null) {
    var url = abs(HOST, m[1]);
    if (out.indexOf(url) === -1) out.push(url);
  }
  return out;
}

function findEpisode(list, season, episode) {
  var exact = new RegExp("-" + season + "-sezon-" + episode + "-bolum");
  for (var i = 0; i < list.length; i++) if (exact.test(list[i])) return list[i];
  return "";
}

function seasonTab(html, season) {
  var re = new RegExp('href="([^"]*/' + season + '-sezon-[^/" ]+/)"');
  var m = re.exec(String(html || ""));
  return m ? abs(HOST, m[1]) : "";
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  var isTv = mediaType === "tv" || mediaType === "series" || mediaType === "show";
  if (!isTv) return Promise.resolve([]);
  var want = season != null ? Number(season) : 1;
  var wantEp = episode != null ? Number(episode) : 1;

  var candidates = [];
  var episodeUrl = "";

  return getMediaInfo(tmdbId).then(function (info) {
    var titles = collectTitles(info);
    if (!titles.length) return null;
    var chain = Promise.resolve(null);
    for (var i = 0; i < titles.length && i < 2; i++) {
      (function (title) {
        chain = chain.then(function (found) {
          if (found) return found;
          return getText(HOST + "/search/" + encodeURIComponent(title).replace(/%20/g, "+") + "/", { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": HOST + "/" })
            .then(function (html) {
              if (!html) return null;
              var re = /<article class="detailed-article"[\s\S]*?<h3[^>]*><a href="([^"]+)"[^>]*>([^<]*)/g;
              var m;
              while ((m = re.exec(html)) !== null && candidates.length < 3) {
                if (sameTitle(m[2], title)) candidates.push(abs(HOST, m[1]));
              }
              return null;
            });
        });
      })(titles[i]);
    }
    return chain.then(function () { return titles[0]; });
  }).then(function (title) {
    if (!title) return null;

    function fromSeries(i) {
      if (i >= candidates.length) return Promise.resolve(null);
      return getText(candidates[i], { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": HOST + "/" }).then(function (detail) {
        if (!detail) return fromSeries(i + 1);
        var hit = findEpisode(episodeLinks(detail), want, wantEp);
        if (hit) return hit;
        var tab = seasonTab(detail, want);
        if (!tab) return fromSeries(i + 1);
        return getText(tab, { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": candidates[i] }).then(function (seasonHtml) {
          return findEpisode(episodeLinks(seasonHtml), want, wantEp) || fromSeries(i + 1);
        }).catch(function () { return fromSeries(i + 1); });
      }).catch(function () { return fromSeries(i + 1); });
    }

    return fromSeries(0);
  }).then(function (ep) {
    if (!ep) return [];
    episodeUrl = ep;
    return getText(ep, { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": HOST + "/" });
  }).then(function (page) {
    if (!page) return [];
    var src = first(/id="video-area"[\s\S]*?<iframe[^>]+src="([^"]+)"/, page);
    if (!src) return [];
    var player = abs(episodeUrl, src);
    if (player.indexOf("king.php") === -1) return [];
    return getText(player.replace("king.php?v=", "king.php?wmode=opaque&v="), { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": episodeUrl });
  }).then(function (king) {
    if (!king) return [];
    var src = first(/id="Player"[\s\S]*?<iframe[^>]+src="([^"]+)"/, king);
    if (!src) return [];
    var embedUrl = abs(episodeUrl, src);
    var stream = embedUrl.replace("/embed/", "/embed/sheila/");
    if (stream === embedUrl) return [];
    var headers = { "User-Agent": UA, "Referer": embedUrl, "Accept": "*/*" };
    return netFetch(stream, { headers: headers }).then(function (r) {
      if (!r || !r.ok) return [];
      return r.text().then(function (playlist) {
        if (playlist.indexOf("#EXTM3U") === -1) return [];
        var height = first(/RESOLUTION=\d+x(\d+)/, playlist);
        var quality = height ? height + "p" : "auto";
        return [{
          name: "CastSinema • DiziBox",
          title: "DiziBox • " + quality + " • HLS",
          url: stream,
          quality: 1080,
          provider: "castsinema-dizibox",
          format: "m3u8",
          headers: headers,
          behaviorHints: { notWebReady: true, proxyHeaders: { request: headers } },
          subtitles: []
        }];
      });
    });
  }).catch(function (error) {
    console.error("[CastSinema DiziBox] " + (error && error.message ? error.message : String(error)));
    return [];
  });
}

module.exports = { getStreams: getStreams };
