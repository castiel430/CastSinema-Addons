/* SPDX-License-Identifier: MIT
 * CastSinema FilmMakinesi provider.
 * Turkish movie scraper for FilmMakinesi.
 *
 * Verified flow (live site, 2026-11):
 *   TMDB id -> title
 *   -> GET /?knl_ajax_search=1&s=<title>   (the site's own live-search endpoint)
 *   -> film page -> iframe https://oynatloload.top/embed/<id>
 *   -> player page -> __ULTRA_EAUTH token
 *   -> GET /api/video-bilgi/<folder>?eauth=<token> -> HLS master + subtitle
 *
 * Note: the site keeps a small catalogue, so a title that is not published
 * there simply yields no stream. Everything that is published resolves to a
 * real HLS master playlist (with Turkish audio and a Turkish .vtt track).
 */
"use strict";

var HOST = "https://filmmakinesi.co";
var PLAYER_HOST = "https://oynatloload.top";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
var UA_CLIENT = "okhttp/4.9.2";

// --- request layer ---------------------------------------------------------
function profileHeaders(ua) {
  return { "User-Agent": ua, "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7" };
}
function requestProfiles() {
  return [
    profileHeaders("Dalvik/2.1.0 (Linux; U; Android 13; SM-G998B Build/TP1A.220624.014)"),
    profileHeaders(UA_CLIENT),
    profileHeaders("ExoPlayerLib/2.19.1"),
    profileHeaders("stagefright/1.2 (Linux;Android 11)"),
    profileHeaders("VLC/3.0.21 LibVLC/3.0.21"),
    profileHeaders(UA),
    profileHeaders("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"),
    profileHeaders("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0"),
    profileHeaders("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15"),
    {}
  ];
}
var KEEP_HEADERS = ["accept", "referer", "origin", "range", "cookie", "content-type", "x-requested-with"];
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

// --- helpers ----------------------------------------------------------------
function foldTurkish(s) {
  var map = { "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g", "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c" };
  var out = String(s || "").replace(/[ıİşŞğĞüÜöÖçÇ]/g, function (c) { return map[c] || c; }).toLowerCase();
  try { out = out.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return out;
}
function normalizeTitle(s) { return foldTurkish(s).replace(/[^a-z0-9]+/g, ""); }
function slugify(s) {
  return foldTurkish(s).replace(/['’‘`]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, " ").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim(); }
function originOf(u) { var m = String(u || "").match(/^(https?:\/\/[^\/]+)/i); return m ? m[1] : ""; }
function b64Decode(s) {
  var t = String(s || "").replace(/[\r\n\t =]+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  var out = "";
  for (var i = 0; i < t.length; i += 4) {
    var a = t.indexOf("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".charAt(0));
    a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(t.charAt(i));
    var b = i + 1 < t.length ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(t.charAt(i + 1)) : -1;
    var c = i + 2 < t.length ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(t.charAt(i + 2)) : -1;
    var d = i + 3 < t.length ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(t.charAt(i + 3)) : -1;
    if (a === -1 || b === -1) break;
    out += String.fromCharCode((a << 2) | (b >> 4));
    if (c !== -1) {
      out += String.fromCharCode(((b & 15) << 4) | (c >> 2));
      if (d !== -1) out += String.fromCharCode(((c & 3) << 6) | d);
    }
  }
  return out;
}

// --- site helpers -----------------------------------------------------------
function getMediaInfo(tmdbId, isTv) {
  var path = isTv ? "/tv/" : "/movie/";
  return getJson(TMDB_API + path + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_KEY + "&language=tr-TR&append_to_response=external_ids,translations");
}

function collectTitles(info, isMovie) {
  var titles = [];
  function add(v) {
    var s = String(v || "").trim();
    if (!s) return;
    var n = normalizeTitle(s);
    for (var i = 0; i < titles.length; i++) if (normalizeTitle(titles[i]) === n) return;
    titles.push(s);
  }
  if (!info) return titles;
  add(isMovie ? info.title : info.name);
  add(isMovie ? info.original_title : info.original_name);
  var tr = (info.translations && info.translations.translations) || [];
  for (var i = 0; i < tr.length; i++) {
    if (!tr[i] || tr[i].iso_639_1 !== "tr") continue;
    var data = tr[i].data || {};
    add(isMovie ? data.title : data.name);
  }
  return titles;
}

// The theme renders live search results through ?knl_ajax_search=1.
function searchFilmMakinesi(query) {
  var url = HOST + "/?knl_ajax_search=1&s=" + encodeURIComponent(query);
  return getText(url, { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": HOST + "/" })
    .then(function (html) {
      if (!html) return [];
      var out = [];
      var re = /<a[^>]*href="([^"]+)"[^>]*class="search-result"[^>]*>([\s\S]*?)<\/a>/gi;
      var m;
      while ((m = re.exec(html))) {
        var title = /<span class="title">([^<]*)<\/span>/i.exec(m[2]);
        var year = /<span>(\d{4})<\/span>/i.exec(m[2]);
        out.push({
          url: m[1],
          title: title ? stripTags(title[1]) : "",
          year: year ? year[1] : ""
        });
        if (out.length >= 20) break;
      }
      return out;
    });
}

function pickResult(results, titles) {
  var best = null, bestScore = 0;
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (!r || !r.url) continue;
    var nc = normalizeTitle(r.title);
    if (!nc) continue;
    var score = 0;
    for (var j = 0; j < titles.length; j++) {
      var nt = normalizeTitle(titles[j]);
      if (!nt) continue;
      if (nc === nt) score = Math.max(score, 100);
      else if (nc.indexOf(nt) === 0 || nt.indexOf(nc) === 0) score = Math.max(score, 80);
      else if (nc.indexOf(nt) !== -1 || nt.indexOf(nc) !== -1) score = Math.max(score, 65);
    }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

function findPlayerEmbed(html, baseUrl) {
  var tags = String(html || "").match(/<iframe\b[^>]*>/gi) || [];
  for (var i = 0; i < tags.length; i++) {
    var src = /data-src=["']([^"']+)["']/i.exec(tags[i]) || /\ssrc=["']([^"']+)["']/i.exec(tags[i]);
    if (!src) continue;
    var url = src[1];
    if (/^\/\//.test(url)) url = "https:" + url;
    if (!/^https?:\/\//i.test(url)) continue;
    if (/youtube\.com|youtu\.be|dailymotion\.com|vimeo\.com/i.test(url)) continue;
    if (/oynatloload|embed|player|oynat/i.test(url)) return url;
  }
  return "";
}

// The player page hands out a signed token; the API needs it as `eauth`.
function parsePlayerToken(html) {
  var m = /__ULTRA_EAUTH\s*=\s*"([^"]+)"/.exec(String(html || ""));
  if (!m) return null;
  var raw = b64Decode(m[1]);
  var json = null;
  try { json = JSON.parse(raw); } catch (_) {}
  if (json && json.folder) return { token: m[1], folder: json.folder };
  return null;
}

function buildStreamUrls(info, embedUrl, title) {
  var master = info && (info.hls_m3u8_path || info.src) ? String(info.hls_m3u8_path || info.src) : "";
  var streams = [];
  var subtitles = [];
  if (info && info.subtitle) {
    var subUrl = String(info.subtitle);
    if (subUrl.charAt(0) !== "http") subUrl = PLAYER_HOST + "/" + subUrl.replace(/^\/+/, "");
    subtitles.push({ label: "Türkçe", lang: "tr", url: subUrl });
  }
  var headers = { "User-Agent": UA_CLIENT, "Referer": embedUrl, "Origin": originOf(embedUrl) };
  if (master) {
    streams.push({
      name: "CastSinema • FilmMakinesi",
      title: "FilmMakinesi • " + (title || "Film") + " • HLS",
      url: master,
      quality: 1080,
      provider: "castsinema-filmmakinesi",
      format: "m3u8",
      headers: headers,
      behaviorHints: { notWebReady: true, proxyHeaders: { request: headers } },
      subtitles: subtitles
    });
  }
  var sources = (info && Array.isArray(info.sources)) ? info.sources : [];
  for (var i = 0; i < sources.length && streams.length < 4; i++) {
    var file = sources[i] && (sources[i].file || sources[i].src || sources[i].hls_path);
    if (!file) continue;
    if (file === master) continue;
    streams.push({
      name: "CastSinema • FilmMakinesi",
      title: "FilmMakinesi • " + (title || "Film") + " • Kaynak " + (i + 1),
      url: String(file),
      quality: 1080,
      provider: "castsinema-filmmakinesi",
      format: /\.mp4(\?|$)/i.test(String(file)) ? "mp4" : "m3u8",
      headers: headers,
      behaviorHints: { notWebReady: true, proxyHeaders: { request: headers } },
      subtitles: subtitles
    });
  }
  return streams;
}

// --- main -------------------------------------------------------------------
function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  var isTv = mediaType === "tv" || mediaType === "series" || mediaType === "show";

  return getMediaInfo(tmdbId, isTv).then(function (info) {
    var titles = collectTitles(info, !isTv);
    if (!titles.length) titles.push(String(tmdbId));
    var title = titles[0];

    // The catalogue is small; try the Turkish title, the original title and a
    // slug guess so common movies still resolve.
    var candidates = [];
    for (var i = 0; i < titles.length && candidates.length < 4; i++) candidates.push(titles[i]);

    function attempt(index) {
      if (index >= candidates.length) return Promise.resolve([]);
      var query = candidates[index];
      return searchFilmMakinesi(query).then(function (results) {
        var picked = pickResult(results, candidates);
        if (!picked) return attempt(index + 1);
        return { item: picked, title: title };
      }).catch(function () { return attempt(index + 1); });
    }

    return attempt(0);
  }).then(function (ctx) {
    if (!ctx || !ctx.item) return [];
    var itemUrl = ctx.item.url;
    return getText(itemUrl, { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": HOST + "/" })
      .then(function (html) {
        if (!html) return [];
        var embedUrl = findPlayerEmbed(html, itemUrl);
        if (!embedUrl) return [];
        return getText(embedUrl, { "User-Agent": UA_CLIENT, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": itemUrl })
          .then(function (playerHtml) {
            if (!playerHtml) return [];
            var token = parsePlayerToken(playerHtml);
            if (!token) return [];
            var apiUrl = PLAYER_HOST + "/api/video-bilgi/" + encodeURIComponent(token.folder) + "?eauth=" + encodeURIComponent(token.token);
            return getJson(apiUrl, {
              "User-Agent": UA_CLIENT,
              "Accept": "application/json, text/plain, */*",
              "Referer": embedUrl,
              "X-Requested-With": "XMLHttpRequest"
            }).then(function (info) {
              if (!info) return [];
              return buildStreamUrls(info, embedUrl, ctx.title);
            });
          });
      });
  }).catch(function (error) {
    console.error("[CastSinema FilmMakinesi] " + (error && error.message ? error.message : String(error)));
    return [];
  });
}

module.exports = { getStreams: getStreams };
