/* SPDX-License-Identifier: MIT
 * CastSinema FilmModu provider.
 * Turkish dubbed movie scraper for FilmModu (filmmodu.news).
 *
 * Verified flow (live site, 2026-11):
 *   Cinemeta title -> /ara?q= -> card match -> film page -> data-pv slug
 *   -> pilavyerplay s.php -> window.__PLAYER__ {stream, audios, subs}
 *   -> HLS master + VTT subtitles.
 *
 * Flow logic adapted from the working BigBull CS Nuvio addon (MIT).
 */
"use strict";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
var BASE = "https://filmmodu.news";
var PLAYER_FALLBACK = "https://play2.pilavyerplay.top";

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
  if (String(href).charAt(0) === "/") return origin ? origin[1] + href : href;
  return base.replace(/[^/]*$/, "") + href;
}

function norm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u0131]/g, "i")
    .replace(/[\u015f]/g, "s")
    .replace(/[\u011f]/g, "g")
    .replace(/[\u00fc]/g, "u")
    .replace(/[\u00f6]/g, "o")
    .replace(/[\u00e7]/g, "c")
    .replace(/[^a-z0-9]/g, "");
}

function spaced(value) {
  return String(value || "")
    .replace(/\s*\([^)]*\)/g, " ")
    .replace(/\b(?:izle|film|full|hd|turkce|türkçe|dublaj|altyazili|altyazılı)\b/gi, " ")
    .split(/[\s:\-]+/)
    .map(norm)
    .filter(Boolean)
    .join(" ")
    .replace(/^(?:the|an|a) /, "");
}

function pick(cards, wanted, year) {
  var w = spaced(wanted);
  if (!w) return null;
  var exact = null;
  var prefix = null;
  for (var i = 0; i < cards.length; i++) {
    var n = spaced(cards[i].title);
    if (!n) continue;
    if (n === w) {
      if (year && cards[i].year === year) return cards[i];
      if (!exact) exact = cards[i];
    } else if (n.indexOf(w + " ") === 0) {
      if (year && cards[i].year === year && !prefix) prefix = cards[i];
      else if (!prefix) prefix = cards[i];
    }
  }
  return exact || prefix;
}

function metaOf(id, mediaType) {
  if (/^__alt__:/.test(String(id))) return Promise.resolve({ name: decodeURIComponent(String(id).slice(8)), year: "" });
  var path = mediaType === "tv" ? "/tv/" : "/movie/";
  return text("https://api.themoviedb.org/3" + path + encodeURIComponent(String(id)) + "?api_key=4e44d9029b1270a757cddc766a1bcb63&language=tr-TR")
    .then(function (body) {
      var meta = JSON.parse(body) || {};
      return { name: String(meta.title || meta.name || meta.original_title || meta.original_name || "").trim(), year: String(meta.release_date || meta.first_air_date || "").slice(0, 4) };
    })
    .catch(function () {
      return { name: "", year: "" };
    });
}

function qualityOf(masterUrl, referer) {
  return text(masterUrl, { referer: referer })
    .then(function (playlist) {
      var re = /RESOLUTION=\d+x(\d+)/g;
      var m;
      var best = 0;
      while ((m = re.exec(playlist)) !== null) best = Math.max(best, parseInt(m[1], 10) || 0);
      return best > 0 ? best + "p" : "auto";
    })
    .catch(function () {
      return "auto";
    });
}

function findFilm(title, year) {
  return text(BASE + "/ara?q=" + encodeURIComponent(title))
    .then(function (page) {
      var cards = [];
      var re = /<a\b[^>]*href="([^"]*\/film\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      var m;
      while ((m = re.exec(page)) !== null) {
        var h3 = first(/<h3[^>]*>([\s\S]*?)<\/h3>/, m[2]);
        if (!h3) {
          var alt = /alt="([^"]+)"/.exec(m[2]);
          if (alt) h3 = String(alt[1]).replace(/\s*Film izle\s*/i, "").trim();
        }
        if (!h3) continue;
        var cardYear = first(/<p[^>]*>\s*(\d{4})\s*<\/p>/, m[2]) || first(/(\d{4})/, m[2]) || "";
        cards.push({ url: abs(BASE, m[1]), title: h3.replace(/<[^>]+>/g, "").trim(), year: cardYear });
      }
      var hit = pick(cards, title, year);
      return hit ? hit.url : null;
    })
    .catch(function () {
      return null;
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType === "tv") return Promise.resolve([]);

  return metaOf(tmdbId, mediaType)
    .then(function (meta) {
      if (!meta.name) return null;
      return findFilm(meta.name, meta.year);
    })
    .then(function (url) {
      if (!url) return [];
      var pageUrl = url;
      return text(url).then(function (page) {
        if (!page) return [];
        var core = first(/<script[^>]+src="([^"]*\/assets\/js\/core\.js[^"]*)"/, page);
        var playerBase = core && /^https?:/i.test(core) ? core.replace(/\/assets\/js\/core\.js.*$/, "") : PLAYER_FALLBACK;

        var slugs = [];
        var re = /data-pv="([^"]+)"/g;
        var m;
        while ((m = re.exec(page)) !== null) {
          if (m[1] && slugs.indexOf(m[1]) < 0) slugs.push(m[1].trim());
        }
        if (!slugs.length) return [];

        return Promise.all(slugs.map(function (slug) {
          var shell = playerBase + "/assets/js/s.php?s=" + encodeURIComponent(slug);
          return text(shell, { referer: pageUrl })
            .then(function (html) {
              var json = first(/window\.__PLAYER__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/, html);
              if (!json) return [];
              var player = JSON.parse(json);
              var stream = String(player.stream || "").trim();
              if (!/^https?:/i.test(stream)) return [];
              var audios = [];
              (player.audios || []).forEach(function (a) {
                var lbl = String((a && a.label) || "").trim();
                if (lbl) audios.push(lbl);
              });
              var subs = [];
              (player.subs || []).forEach(function (sub) {
                if (!sub || !/^https?:/i.test(String(sub.src || ""))) return;
                var lang = String(sub.lang || "tr").toLowerCase();
                subs.push({ url: sub.src, language: lang, name: String(sub.label || lang).trim() + " [FilmModu]" });
              });
              return text(stream, { referer: shell }).then(function (playlist) {
                var re2 = /RESOLUTION=\d+x(\d+)/g;
                var m2;
                var best = 0;
                while ((m2 = re2.exec(playlist)) !== null) best = Math.max(best, parseInt(m2[1], 10) || 0);
                var q = best > 0 ? best + "p" : "auto";
                return [{
                  name: "CastSinema • FilmModu",
                  title: "FilmModu • " + (audios.length ? audios.join(" / ") : "HLS"),
                  url: stream,
                  quality: q,
                  provider: "castsinema-filmmodu",
                  format: "m3u8",
                  headers: { "User-Agent": UA, "Referer": shell, "Accept": "*/*" },
                  behaviorHints: { notWebReady: true, proxyHeaders: { request: { "User-Agent": UA, "Referer": shell } } },
                  subtitles: subs.slice(0, 6)
                }];
              }).catch(function () {
                return [{
                  name: "CastSinema • FilmModu",
                  title: "FilmModu • " + (audios.length ? audios.join(" / ") : "HLS"),
                  url: stream,
                  quality: "auto",
                  provider: "castsinema-filmmodu",
                  format: "m3u8",
                  headers: { "User-Agent": UA, "Referer": shell, "Accept": "*/*" },
                  behaviorHints: { notWebReady: true, proxyHeaders: { request: { "User-Agent": UA, "Referer": shell } } },
                  subtitles: subs.slice(0, 6)
                }];
              });
            })
            .catch(function () {
              return [];
            });
        }));
      });
    })
    .then(function (lists) {
      var out = [];
      var seen = {};
      (lists || []).forEach(function (list) {
        (list || []).forEach(function (item) {
          if (!item || !item.url || seen[item.url]) return;
          seen[item.url] = 1;
          out.push(item);
        });
      });
      return out;
    })
    .catch(function (e) {
      console.error("[CastSinema FilmModu] " + (e && e.message ? e.message : String(e)));
      return [];
    });
}

module.exports = { getStreams: getStreams };
