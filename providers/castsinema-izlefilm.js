/* SPDX-License-Identifier: MIT
 * CastSinema IzleFilm provider.
 * Turkish film scraper for izlefilm.net.
 *
 * Flow: TMDB title -> /arama?q= -> /film/<slug> -> ok.ru videoembed
 *   -> data-options flashvars.metadata.ondemandHls (HLS master).
 */
"use strict";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
var HOST = "https://izlefilm.net";
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

function searchSite(title) {
  return text(HOST + "/arama?q=" + encodeURIComponent(title), HOST + "/")
    .then(function (html) {
      var out = [];
      var re = /href=["'](\/film\/[^"']+)["']/g;
      var m;
      while ((m = re.exec(String(html || ""))) !== null) {
        var slug = m[1];
        if (out.indexOf(slug) === -1) out.push(slug);
      }
      return out;
    })
    .catch(function () { return []; });
}

function pickSlug(slugs, title) {
  if (!slugs || !slugs.length) return null;
  var want = normalize(title);
  var best = null, bestScore = 0;
  for (var i = 0; i < slugs.length; i++) {
    var slug = slugs[i].split("/").pop() || "";
    var name = normalize(slug.replace(/-/g, " "));
    var score = 0;
    if (name === want) score = 100;
    else if (name.indexOf(want) === 0 || want.indexOf(name) === 0) score = 80;
    else if (name.indexOf(want) !== -1 || want.indexOf(name) !== -1) score = 60;
    if (score > bestScore) { bestScore = score; best = slugs[i]; }
  }
  return best || slugs[0];
}

function extractOkruEmbed(html) {
  var m = html.match(/data-player-url=["']([^"']+)["']/);
  if (m) return m[1];
  m = html.match(/<iframe[^>]+src=["']([^"']*ok\.ru[^"']*)["']/);
  if (m) return m[1];
  return null;
}

function resolveOkru(embedUrl) {
  return text(embedUrl, HOST + "/").then(function (html) {
    var m = html.match(/data-options="([^"]+)"/);
    if (!m) return null;
    var opts;
    try { opts = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")); } catch (e) { return null; }
    var fv = (opts && opts.flashvars) || {};
    var meta = (fv.metadata) || {};
    var hls = meta.ondemandHls || (meta.movie && meta.movie.ondemandHls) || null;
    if (!hls) return null;
    return { url: hls, title: (meta.movie && meta.movie.title) || "" };
  }).catch(function () { return null; });
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

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "movie") return Promise.resolve([]);
  return resolveTitle(tmdbId, mediaType).then(function (title) {
    if (!title) return [];
    return searchSite(title).then(function (slugs) {
      var slug = pickSlug(slugs, title);
      if (!slug) return [];
      var pageUrl = HOST + slug;
      return text(pageUrl, HOST + "/").then(function (html) {
        var embedUrl = extractOkruEmbed(html);
        if (!embedUrl) return [];
        return resolveOkru(embedUrl).then(function (hit) {
          if (!hit || !hit.url) return [];
          return [{
            name: "CastSinema • IzleFilm",
            title: "IzleFilm • " + title + " • TR Dublaj - HD",
            url: hit.url,
            quality: 1080,
            provider: "castsinema-izlefilm",
            format: "m3u8",
            headers: { "User-Agent": UA, "Referer": embedUrl }
          }];
        });
      });
    });
  }).catch(function (e) {
    console.error("[CastSinema IzleFilm] " + (e && e.message ? e.message : String(e)));
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
        s.headers = s.headers;
      }
      if (s.headers && !s.behaviorHints) {
        s.behaviorHints = { notWebReady: true, proxyHeaders: { request: s.headers } };
      }
      return s;
    });
  });
};