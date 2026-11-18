/* SPDX-License-Identifier: MIT
 * CastSinema FullFilmIzle provider.
 * Turkish film scraper for fullfilmizle.fit.
 *
 * Flow: TMDB title -> /?s= -> /<slug>-izle/ -> videopark oplayer (VIDEO_DATA)
 *   or videoseyred.in embed -> /playlist/<num>.json (m3u8 + subtitles).
 */
"use strict";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
var HOST = "https://fullfilmizle.fit";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";

function text(url, referer) {
  var headers = { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9", "Accept": "text/html,application/xhtml+xml,*/*" };
  if (referer) headers.Referer = referer;
  return fetch(url, { headers: headers }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
    return r.text();
  });
}

function normalize(v) {
  return String(v || "").toLowerCase()
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function titleOf(id) {
  return text(TMDB_API + "/movie/" + encodeURIComponent(String(id)) + "?api_key=" + TMDB_KEY + "&language=tr-TR")
    .then(function (body) {
      var meta = JSON.parse(body) || {};
      return String(meta.title || meta.original_title || "").trim();
    })
    .catch(function () { return ""; });
}

function titleFromCinemeta(id, mediaType) {
  var kind = mediaType === "movie" ? "movie" : "series";
  return text("https://v3-cinemeta.strem.io/meta/" + kind + "/" + id + ".json")
    .then(function (body) {
      var meta = JSON.parse(body).meta || {};
      return String(meta.name || "").trim();
    })
    .catch(function () { return ""; });
}

function resolveTitle(id, mediaType) {
  var raw = String(id || "");
  if (/^tt\d+$/.test(raw)) return titleFromCinemeta(raw, mediaType);
  if (/^\d+$/.test(raw)) return titleOf(raw);
  return Promise.resolve(raw);
}

function searchSite(title) {
  return text(HOST + "/?s=" + encodeURIComponent(title), HOST + "/")
    .then(function (html) {
      var out = [];
      var re = /href=["'](https?:\/\/fullfilmizle\.fit\/[^"']+?-izle\/?)["']/g;
      var m;
      while ((m = re.exec(String(html || ""))) !== null) {
        if (out.indexOf(m[1]) === -1) out.push(m[1]);
      }
      return out;
    })
    .catch(function () { return []; });
}

function pickUrl(urls, title) {
  if (!urls || !urls.length) return null;
  var want = normalize(title);
  var best = null, bestScore = 0;
  for (var i = 0; i < urls.length; i++) {
    var slug = urls[i].split("/").filter(Boolean).pop() || "";
    var name = normalize(slug.replace(/-izle$/i, "").replace(/-/g, " "));
    var score = 0;
    if (name === want) score = 100;
    else if (name.indexOf(want) === 0 || want.indexOf(name) === 0) score = 80;
    else if (name.indexOf(want) !== -1 || want.indexOf(name) !== -1) score = 60;
    if (score > bestScore) { bestScore = score; best = urls[i]; }
  }
  return best || urls[0];
}

function extractIframes(html) {
  var out = [];
  var tags = String(html || "").match(/<iframe\b[^>]*>/gi) || [];
  for (var i = 0; i < tags.length; i++) {
    var src = /src=["']([^"']+)["']/i.exec(tags[i]);
    if (!src) continue;
    var url = src[1];
    if (/^https?:\/\//i.test(url) && /videopark|videoseyred/i.test(url)) out.push(url);
  }
  return out;
}

function resolveVideopark(embedUrl) {
  return text(embedUrl, HOST + "/").then(function (html) {
    var m = html.match(/VIDEO_DATA\s*=\s*(\{[\s\S]*?\});/);
    if (!m) return [];
    var data;
    try { data = JSON.parse(m[1]); } catch (e) { return []; }
    var out = [];
    var hls = data.hlsSource && data.hlsSource.file;
    if (hls) out.push({ url: hls, label: "HLS" });
    var mp4s = data.mp4Sources || [];
    for (var i = 0; i < mp4s.length && out.length < 5; i++) {
      if (mp4s[i] && mp4s[i].file) out.push({ url: mp4s[i].file, label: String(mp4s[i].label || "MP4") });
    }
    return out;
  }).catch(function () { return []; });
}

function resolveVideoseyred(embedUrl) {
  // The embed page declares playlistUrl='/playlist/<num>.json'
  return text(embedUrl, HOST + "/").then(function (html) {
    var m = html.match(/playlistUrl=['"]([^'"]+)['"]/);
    if (!m) return [];
    var plUrl = m[1];
    if (/^https?:/i.test(plUrl) === false) plUrl = "https://videoseyred.in" + (plUrl.charAt(0) === "/" ? plUrl : "/" + plUrl);
    return text(plUrl, embedUrl).then(function (body) {
      var list;
      try { list = JSON.parse(body); } catch (e) { return []; }
      var item = (list && list[0]) || {};
      var sources = item.sources || [];
      var subs = [];
      var tracks = item.tracks || [];
      for (var t = 0; t < tracks.length; t++) {
        var tr = tracks[t] || {};
        if (tr.kind !== "captions" || !tr.file) continue;
        var lang = String(tr.language || "").toLowerCase();
        if (lang !== "tur" && !/t[üu]rk/i.test(tr.label || "")) lang = "en";
        subs.push({ url: tr.file, language: lang, name: String(tr.label || lang).trim() + " [FullFilmIzle]" });
      }
      var out = [];
      for (var i = 0; i < sources.length && i < 3; i++) {
        if (sources[i] && sources[i].file) out.push({ url: sources[i].file, label: "HLS", subs: subs });
      }
      return out;
    }).catch(function () { return []; });
  }).catch(function () { return []; });
}

function resolveEmbed(embedUrl) {
  if (/videopark/i.test(embedUrl)) return resolveVideopark(embedUrl);
  if (/videoseyred/i.test(embedUrl)) return resolveVideoseyred(embedUrl);
  return Promise.resolve([]);
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "movie") return Promise.resolve([]);
  return resolveTitle(tmdbId, mediaType).then(function (title) {
    if (!title) return [];
    return searchSite(title).then(function (urls) {
      var pageUrl = pickUrl(urls, title);
      if (!pageUrl) return [];
      return text(pageUrl, HOST + "/").then(function (html) {
        var embeds = extractIframes(html);
        if (!embeds.length) return [];
        var chain = Promise.resolve([]);
        embeds.forEach(function (embedUrl) {
          chain = chain.then(function (out) {
            if (out.length >= 3) return out;
            return resolveEmbed(embedUrl).then(function (rows) {
              for (var i = 0; i < rows.length && out.length < 3; i++) {
                out.push({
                  name: "CastSinema • FullFilmIzle",
                  title: "FullFilmIzle • " + title + " • TR Dublaj - HD",
                  url: rows[i].url,
                  quality: 1080,
                  provider: "castsinema-fullfilmizle",
                  format: /\.mp4(\?|$)/i.test(rows[i].url) ? "mp4" : "m3u8",
                  headers: { "User-Agent": UA, "Referer": embedUrl },
                  subtitles: rows[i].subs || []
                });
              }
              return out;
            });
          });
        });
        return chain;
      });
    });
  }).catch(function (e) {
    console.error("[CastSinema FullFilmIzle] " + (e && e.message ? e.message : String(e)));
    return [];
  });
}

module.exports = { getStreams: getStreams };


// NuvioMobile always calls getStreams with args.tmdbId (JsBindings.kt); the
// value is a numeric TMDB id after TmdbService.ensureTmdbId. Resolve it to
// IMDb so the existing Cinemeta/title flow keeps working.
var __origGetStreams = module.exports.getStreams;
module.exports.getStreams = function (id, mediaType, season, episode) {
  var raw = String(id || "");
  if (!/^\d+$/.test(raw)) return __origGetStreams(raw, mediaType, season, episode);
  var tv = mediaType !== "movie";
  var headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "Accept": "application/json" };
  var key = typeof TMDB_API_KEY !== "undefined" ? TMDB_API_KEY : "";
  var api = "https://www.wikidata.org/w/api.php?format=json";
  var prop = tv ? "P4983" : "P4947";
  function fromTmdb() {
    if (!key) return Promise.resolve("");
    return fetch("https://api.themoviedb.org/3/" + (tv ? "tv" : "movie") + "/" + raw + "/external_ids?api_key=" + encodeURIComponent(key), { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) { return String((json && json.imdb_id) || ""); })
      .catch(function () { return ""; });
  }
  function fromWikidata() {
    return fetch(api + "&action=query&list=search&srlimit=1&srsearch=" + encodeURIComponent("haswbstatement:" + prop + "=" + raw), { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        var hits = (json && json.query && json.query.search) || [];
        if (!hits.length) return "";
        return fetch(api + "&action=wbgetentities&props=claims&ids=" + hits[0].title, { headers: headers });
      })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (json) {
        var entities = (json && json.entities) || {};
        for (var entity in entities) {
          var rows = ((entities[entity] || {}).claims || {}).P345 || [];
          for (var i = 0; i < rows.length; i++) {
            var value = rows[i] && rows[i].mainsnak && rows[i].mainsnak.datavalue && rows[i].mainsnak.datavalue.value;
            if (/^tt\d+$/.test(String(value || ""))) return value;
          }
        }
        return "";
      })
      .catch(function () { return ""; });
  }
  return fromTmdb().then(function (imdb) { return imdb || fromWikidata(); }).then(function (imdb) {
    return __origGetStreams(imdb || raw, mediaType, season, episode);
  }).catch(function () { return []; });
};

/* Cinemeta basligi yerellestirir ("Inception" -> "Baslangic"); sonuc bossa Wikidata TR/EN basliklariyla yeniden dene. */
function __altTitles(raw, mediaType) {
  var h = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "Accept": "application/json" };
  var api = "https://www.wikidata.org/w/api.php?format=json";
  var stmt = /^tt\d+$/.test(raw) ? "P345=" + raw : (mediaType === "movie" ? "P4947=" : "P4983=") + raw;
  return fetch(api + "&action=query&list=search&srlimit=1&srsearch=" + encodeURIComponent("haswbstatement:" + stmt), { headers: h })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      var hits = (j && j.query && j.query.search) || [];
      if (!hits.length) return null;
      return fetch(api + "&action=wbgetentities&props=labels|aliases&languages=tr|en&ids=" + hits[0].title, { headers: h }).then(function (r) { return r.ok ? r.json() : null; });
    })
    .then(function (j) {
      var out = [], seen = {}, ents = (j && j.entities) || {}, k, l, a, i;
      function add(v) {
        v = String(v || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
        if (v && !seen[v.toLowerCase()]) { seen[v.toLowerCase()] = 1; out.push(v); }
      }
      for (k in ents) {
        l = ents[k].labels || {}; a = ents[k].aliases || {};
        add((l.tr || {}).value); add((l.en || {}).value);
        for (i = 0; i < (a.tr || []).length && i < 2; i++) add(a.tr[i].value);
      }
      return out;
    })
    .catch(function () { return []; });
}
var __cinemetaGetStreams = module.exports.getStreams;
module.exports.getStreams = function (id, mediaType, season, episode) {
  var raw = String(id || "");
  return __cinemetaGetStreams(raw, mediaType, season, episode).then(function (streams) {
    if ((streams && streams.length) || /^__alt__:/.test(raw)) return streams || [];
    return __altTitles(raw, mediaType).then(function (titles) {
      var chain = Promise.resolve([]);
      titles.forEach(function (t) {
        chain = chain.then(function (out) {
          return out.length ? out : __cinemetaGetStreams("__alt__:" + encodeURIComponent(t), mediaType, season, episode);
        });
      });
      return chain;
    });
  }).catch(function () { return []; });
};

/* Dil etiketi (AGENTS.md): Nuvio karti "quality • ..." satirini gosterir; dil etiketi kalitenin yanina yazilir.
   Kanit: baslikta dublaj/altyazi, akisa eklenmis altyazi dosyasi ya da sitenin yalniz altyazili olmasi. Kanit yoksa etiket yok. */
var __subOnly = false;
var __langLabeled = module.exports.getStreams;
module.exports.getStreams = function (id, mediaType, season, episode) {
  return __langLabeled.apply(this, arguments).then(function (streams) {
    return (streams || []).map(function (s) {
      var q = String(s.quality || "").replace(/\s*•.*$/, "") || "auto";
      var hay = String(s.title || "") + " " + String(s.name || "");
      var tags = [];
      if (/dublaj/i.test(hay)) tags.push("TR Dublaj");
      else if (/altyaz/i.test(hay) || (s.subtitles && s.subtitles.length)) tags.push("Altyazılı");
      if (tags.length) {
        if (q.indexOf("•") === -1) s.quality = q + " • " + tags.join(" • ");
      } else if (!s.quality) {
        s.quality = "auto";
      }
      if (s.headers && !s.behaviorHints) {
        s.behaviorHints = { notWebReady: true, proxyHeaders: { request: s.headers } };
      }
      return s;
    });
  });
};