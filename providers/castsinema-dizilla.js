/* SPDX-License-Identifier: MIT
 * CastSinema Dizilla provider.
 * Turkish movie/series scraper for Dizilla (pichive/NP_CONFIG player).
 * Logic learned from nuviotr.github.io ecosystem (jasoelys provider patterns) and rewritten for CastSinema.
 */
"use strict";

var BASE = "https://dizilla.la";
var PICHIVE_ORIGIN = "https://four.pichive.online";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA_SITE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
var UA_PLAYER = "okhttp/4.9.2";

function profileHeaders(ua) {
  return { "User-Agent": ua, "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7" };
}
function requestProfiles() {
  return [
    profileHeaders("Dalvik/2.1.0 (Linux; U; Android 13; SM-G998B Build/TP1A.220624.014)"),
    profileHeaders("okhttp/4.9.2"),
    profileHeaders("ExoPlayerLib/2.19.1"),
    profileHeaders("stagefright/1.2 (Linux;Android 11)"),
    profileHeaders("VLC/3.0.21 LibVLC/3.0.21"),
    profileHeaders(UA_SITE),
    profileHeaders("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"),
    profileHeaders("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0"),
    profileHeaders("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15"),
    {}
  ];
}
var KEEP_HEADERS = ["accept", "referer", "origin", "range", "cookie", "content-type", "x-requested-with"];
function mergeHeaders(base, profile) {
  var headers = {}, key;
  for (key in base) { if (Object.prototype.hasOwnProperty.call(base, key) && KEEP_HEADERS.indexOf(String(key).toLowerCase()) !== -1) headers[key] = base[key]; }
  for (key in profile) { if (Object.prototype.hasOwnProperty.call(profile, key)) headers[key] = profile[key]; }
  return headers;
}
function isRefused(response) {
  if (!response) return true;
  if (typeof response.status !== "number") return false;
  return response.status === 403 || response.status === 503 || response.status === 429 || response.status >= 500;
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

function getJson(url, headers) {
  return netFetch(url, { headers: headers || { "User-Agent": UA_SITE, "Accept": "application/json" } })
    .then(function (r) { return r && r.ok ? r.json() : null; })
    .catch(function () { return null; });
}
function getText(url, headers) {
  return netFetch(url, { headers: headers || { "User-Agent": UA_SITE, "Accept": "text/html,application/xhtml+xml,*/*" } })
    .then(function (r) { return r && r.ok ? r.text() : ""; })
    .catch(function () { return ""; });
}

var TR_MAP = { "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g", "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c" };
function fold(s) {
  var out = String(s || "").replace(/[ıİşŞğĞüÜöÖçÇ]/g, function (c) { return TR_MAP[c] || c; }).toLowerCase();
  try { out = out.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return out;
}
function slugify(s) {
  return fold(s).replace(/['’‘`]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function normTitle(s) { return fold(s).replace(/[^a-z0-9]+/g, ""); }
function absUrl(u, base) {
  if (!u) return "";
  var v = String(u).trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.indexOf("//") === 0) return "https:" + v;
  var b = base || BASE;
  if (v.charAt(0) === "/") {
    try { return new URL(b).origin + v; } catch (_) { return BASE + v; }
  }
  try { return new URL(v, b.endsWith("/") ? b : b + "/").href; } catch (_) { return b.replace(/\/[^/]*$/, "/") + v; }
}
function cleanUrl(u) {
  return String(u || "").replace(/\\\//g, "/").replace(/&amp;/g, "&").trim();
}

function getTmdb(type, tmdbId) {
  var path = type === "movie" ? "/movie/" : "/tv/";
  return getJson(TMDB_API + path + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_KEY + "&language=tr-TR&append_to_response=alternative_titles,translations", { "User-Agent": UA_SITE, "Accept": "application/json" });
}

function collectTitles(info, isMovie) {
  var titles = [];
  function add(v) {
    var s = String(v || "").trim();
    if (!s) return;
    var n = normTitle(s);
    for (var i = 0; i < titles.length; i++) if (normTitle(titles[i]) === n) return;
    titles.push(s);
    if (s.indexOf(":") !== -1) {
      var short = s.split(":")[0].trim();
      if (short.length > 2) add(short);
    }
  }
  if (!info) return titles;
  add(isMovie ? info.title : info.name);
  add(isMovie ? info.original_title : info.original_name);
  var trans = (info.translations && info.translations.translations) || [];
  for (var i = 0; i < trans.length; i++) {
    var tr = trans[i];
    if (!tr || !tr.iso_639_1) continue;
    if (tr.iso_639_1 !== "tr" && tr.iso_639_1 !== "en") continue;
    var data = tr.data || {};
    add(isMovie ? data.title : data.name);
  }
  return titles;
}

function extractJsonObject(text, start) {
  var s = String(text || "");
  var depth = 0, inStr = false, esc = false, i;
  for (i = start; i < s.length; i++) {
    var ch = s.charAt(i);
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function parseNpConfig(html) {
  var text = String(html || "");
  var idx = text.indexOf("NP_CONFIG");
  if (idx === -1) return null;
  var brace = text.indexOf("{", idx);
  if (brace === -1) return null;
  var json = extractJsonObject(text, brace);
  if (!json) return null;
  try { return JSON.parse(json); } catch (_) { return null; }
}

function findIframeFromPage(html) {
  var text = cleanUrl(String(html || ""));
  var m = /(https?:\/\/(?:[a-z0-9-]+\.)*pichive\.online\/iframe\.php\?v=[A-Za-z0-9_-]+)/i.exec(text);
  if (m) return m[1];
  var rel = /iframe\.php\?v=([A-Za-z0-9_-]+)/i.exec(text);
  if (rel) return PICHIVE_ORIGIN + "/iframe.php?v=" + rel[1];
  var tag = /<iframe[^>]+src=["']([^"']+)["']/i.exec(text);
  if (tag) {
    var u = cleanUrl(tag[1]);
    if (/iframe\.php|pichive|embed|player/i.test(u)) return absUrl(u, BASE);
  }
  return null;
}

function fetchIframeConfig(iframeUrl, pageUrl) {
  var headers = {
    "User-Agent": UA_PLAYER,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
    "Referer": pageUrl || (BASE + "/")
  };
  return netFetch(iframeUrl, { headers: headers }).then(function (r) {
    return r && r.ok ? r.text() : "";
  }).then(function (body) {
    if (!body) return null;
    var cfg = parseNpConfig(body);
    if (!cfg) return null;
    return { cfg: cfg, iframeUrl: iframeUrl };
  }).catch(function () { return null; });
}

function buildStreamHeaders(iframeUrl) {
  var origin = PICHIVE_ORIGIN;
  try { origin = new URL(iframeUrl).origin; } catch (_) {}
  return { "User-Agent": UA_PLAYER, "Referer": iframeUrl, "Origin": origin };
}

function titleScore(candidate, titles) {
  var nc = normTitle(candidate);
  if (!nc) return 0;
  var best = 0;
  for (var i = 0; i < titles.length; i++) {
    var nt = normTitle(titles[i]);
    if (!nt) continue;
    if (nc === nt) best = Math.max(best, 100);
    else if (nc.indexOf(nt) !== -1 || nt.indexOf(nc) !== -1) best = Math.max(best, 80);
  }
  return best;
}

function searchContent(titles) {
  var chain = Promise.resolve(null);
  var qs = titles.filter(function (t) { return /[a-z]/i.test(fold(t)); }).slice(0, 3);
  function tryOne(q) {
    return getText(BASE + "/ara?q=" + encodeURIComponent(q), { "User-Agent": UA_SITE, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": BASE + "/" })
      .then(function (html) {
        if (!html) return null;
        var re = /href=["'](\/dizi\/[^"']+|\/film\/[^"']+)["'][^>]*>/gi;
        var m;
        for (var i = 0; i < 200; i++) {
          m = re.exec(html);
          if (!m) break;
          var href = m[1];
          var score = titleScore(href.replace(/\/(dizi|film)\//, "").replace(/-/g, " "), titles);
          if (score >= 70) return absUrl(href, BASE);
        }
        // fallback: first dizi/film link
        re.lastIndex = 0;
        m = re.exec(html);
        return m ? absUrl(m[1], BASE) : null;
      }).catch(function () { return null; });
  }
  for (var i = 0; i < qs.length; i++) {
    (function (q) {
      chain = chain.then(function (found) { return found ? found : tryOne(q); });
    })(qs[i]);
  }
  return chain;
}

function trySlugPage(titles, isMovie) {
  var slugs = [];
  for (var i = 0; i < titles.length && slugs.length < 6; i++) {
    var slug = slugify(titles[i]);
    if (slug && slugs.indexOf(slug) === -1) slugs.push(slug);
  }
  function attempt(idx) {
    if (idx >= slugs.length) return Promise.resolve(null);
    var url = BASE + (isMovie ? "/film/" : "/dizi/") + slugs[idx];
    return getText(url, { "User-Agent": UA_SITE, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": BASE + "/" })
      .then(function (html) {
        if (html && html.length > 1500 && html.indexOf("404") === -1) return { url: url, html: html };
        return attempt(idx + 1);
      }).catch(function () { return attempt(idx + 1); });
  }
  return attempt(0);
}

function findContent(titles, isMovie) {
  return searchContent(titles).then(function (url) {
    if (url) {
      return getText(url, { "User-Agent": UA_SITE, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": BASE + "/" })
        .then(function (html) {
          if (html) return { url: url, html: html };
          return trySlugPage(titles, isMovie);
        });
    }
    return trySlugPage(titles, isMovie);
  });
}

function findEpisodePage(content, season, episode) {
  var url = content.url || "";
  var html = String(content.html || "");
  var s = String(season), e = String(episode);
  if (new RegExp("-" + s + "-sezon-" + e + "-bolum", "i").test(url)) return Promise.resolve({ url: url, html: html });
  var re0 = new RegExp("https?://[^\"'\\\\s]*?-" + s + "-sezon-" + e + "-bolum[^\"'\\\\s]*", "i");
  var m0 = re0.exec(html);
  if (m0) {
    var epUrl0 = m0[0].replace(/\\/g, "").replace(/[,;)]+$/, "");
    return getText(epUrl0, { "User-Agent": UA_SITE, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": url })
      .then(function (epHtml) { return epHtml ? { url: epUrl0, html: epHtml } : null; });
  }
  var re = new RegExp("href=[\"']([^\"']*-" + s + "-sezon-" + e + "-bolum[^\"']*)[\"']", "i");
  var m = re.exec(html);
  if (m) {
    var epUrl = absUrl(m[1], url);
    return getText(epUrl, { "User-Agent": UA_SITE, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": url })
      .then(function (epHtml) { return epHtml ? { url: epUrl, html: epHtml } : null; });
  }
  // guess from slug
  var slugM = /\/dizi\/([^/?#]+)/i.exec(url);
  if (slugM) {
    var guess = BASE + "/" + slugM[1] + "-" + s + "-sezon-" + e + "-bolum";
    return getText(guess, { "User-Agent": UA_SITE, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": url })
      .then(function (epHtml) {
        if (epHtml && epHtml.length > 1000 && !/sayfa bulunamad|404/i.test(epHtml)) return { url: guess, html: epHtml };
        return null;
      });
  }
  return Promise.resolve(null);
}

function streamsFromConfig(cfg, iframeUrl, isMovie, season, episode, title) {
  var sources = (cfg && Array.isArray(cfg.sources)) ? cfg.sources : [];
  if (!sources.length) return [];
  var src = sources[0];
  var master = cleanUrl(absUrl(src.master || src.file || src.url || "", iframeUrl));
  if (!master) return [];
  var kind = String(src.kind || "").toLowerCase();
  var isDub = kind === "dub" || /dublaj|dubbed/i.test(String(src.title || ""));
  var label = (isMovie ? title : (title + " • S" + season + "E" + episode)) + (isDub ? " • Dublaj" : " • Altyazı");
  var headers = buildStreamHeaders(iframeUrl);
  var subtitles = [];
  var subs = (cfg && Array.isArray(cfg.subtitles)) ? cfg.subtitles : [];
  for (var i = 0; i < subs.length && i < 12; i++) {
    var sub = subs[i];
    if (!sub) continue;
    var surl = cleanUrl(absUrl(sub.url || sub.file || "", iframeUrl));
    if (!surl) continue;
    subtitles.push({ label: sub.label || sub.name || "Altyazı", lang: sub.lang || sub.language || "tr", url: surl });
  }
  return [{
    name: "CastSinema • Dizilla",
    title: "Dizilla • " + label + " • 1080p",
    url: master,
    quality: 1080,
    provider: "castsinema-dizilla",
    format: "m3u8",
    headers: headers,
    behaviorHints: { notWebReady: true, proxyHeaders: { request: headers } },
    subtitles: subtitles
  }];
}

function resolveFromPage(page, isMovie, season, episode, title) {
  var iframeUrl = findIframeFromPage(page.html);
  if (!iframeUrl) return Promise.resolve([]);
  return fetchIframeConfig(iframeUrl, page.url).then(function (found) {
    if (!found || !found.cfg) return [];
    return streamsFromConfig(found.cfg, found.iframeUrl, isMovie, season, episode, title);
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  var isMovie = !(mediaType === "tv" || mediaType === "series" || mediaType === "show");
  var sNum = season != null ? Number(season) : 1;
  var eNum = episode != null ? Number(episode) : 1;

  return getTmdb(isMovie ? "movie" : "tv", tmdbId).then(function (info) {
    var titles = collectTitles(info, isMovie);
    var title = titles.length ? titles[0] : String(tmdbId);
    if (!titles.length) titles.push(String(tmdbId));

    return findContent(titles, isMovie).then(function (content) {
      if (!content) return [];
      if (isMovie) {
        return resolveFromPage(content, true, sNum, eNum, title);
      }
      return findEpisodePage(content, sNum, eNum).then(function (page) {
        if (!page) return [];
        return resolveFromPage(page, false, sNum, eNum, title);
      });
    });
  }).catch(function (error) {
    console.error("[CastSinema Dizilla] " + (error && error.message ? error.message : String(error)));
    return [];
  });
}

module.exports = { getStreams: getStreams };
