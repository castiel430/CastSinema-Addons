/* SPDX-License-Identifier: MIT
 * CastSinema DiziBox provider.
 * Turkish series scraper for DiziBox.
 * Logic learned from Wiojelt/Nuvio-Addons and rewritten for CastSinema.
 */
"use strict";

var HOST = "https://www.dizibox.live";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "4e44d9029b1270a757cddc766a1bcb63";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function profileHeaders(ua) {
  return { "User-Agent": ua, "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7" };
}
function requestProfiles() {
  return [
    profileHeaders("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"),
    profileHeaders("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"),
    profileHeaders("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0"),
    profileHeaders("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15"),
    {}
  ];
}
var KEEP_HEADERS = ["accept", "referer", "origin", "range", "cookie", "content-type", "x-requested-with"];
function mergeHeaders(base, profile) {
  var headers = {}, key;
  for (key in base) { if (Object.prototype.hasOwnProperty.call(base, key) && KEEP_HEADERS.indexOf(key) !== -1) headers[key] = base[key]; }
  for (key in profile) { if (Object.prototype.hasOwnProperty.call(profile, key)) headers[key] = profile[key]; }
  return headers;
}
function isRefused(response) {
  if (!response) return true;
  if (typeof response.status !== "number") return false;
  return response.status === 403 || response.status === 503;
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
  return netFetch(url, { headers: headers || { "User-Agent": UA, "Accept": "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });
}
function getText(url, referer, extraHeaders) {
  var headers = { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*" };
  if (referer) headers.Referer = referer;
  if (extraHeaders) {
    for (var k in extraHeaders) { if (Object.prototype.hasOwnProperty.call(extraHeaders, k)) headers[k] = extraHeaders[k]; }
  }
  return netFetch(url, { headers: headers })
    .then(function (r) { return r.ok ? r.text() : ""; })
    .catch(function () { return ""; });
}

function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9\u00C0-\u024F]+/gi, " ").trim(); }
function slugify(s) {
  return String(s || "").toLowerCase()
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function abs(url, base) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  if (url.charAt(0) === "/") return (base ? base.replace(/^(https?:\/\/[^/]+).*$/i, "$1") : HOST) + url;
  return (base ? base.replace(/\/[^/]*$/, "/") : HOST + "/") + url;
}

function getTvInfo(tmdbId) {
  return getJson(TMDB_API + "/tv/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_KEY + "&language=tr-TR&append_to_response=external_ids", { "User-Agent": UA, "Accept": "application/json" });
}

function parseDirectory(html) {
  var text = String(html || "");
  var items = [];
  var re = /<a[^>]+href=["'](https?:\/\/www\.dizibox\.live\/diziler\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  var seen = {};
  while ((m = re.exec(text)) !== null) {
    var href = m[1];
    if (seen[href]) continue;
    seen[href] = true;
    var inner = m[2];
    var title = inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (!title) continue;
    var slug = href.replace(/^.*\/diziler\/([^\/?#]+).*$/i, "$1");
    items.push({ url: href, title: title, slug: slug });
  }
  return items;
}

function scoreMatch(item, meta) {
  var it = norm(item.title);
  var names = [];
  if (meta.name) names.push(norm(meta.name));
  if (meta.original_name) names.push(norm(meta.original_name));
  var score = 0;
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    if (!n) continue;
    if (it === n) score = Math.max(score, 100);
    else if (it.indexOf(n) !== -1 || n.indexOf(it) !== -1) score = Math.max(score, 70);
    else {
      var nt = n.split(" ").filter(Boolean);
      var hit = 0;
      for (var j = 0; j < nt.length; j++) if (it.indexOf(nt[j]) !== -1) hit++;
      if (nt.length && hit >= Math.max(1, Math.ceil(nt.length * 0.6))) score = Math.max(score, 40 + hit);
    }
  }
  var slug = norm(item.slug.replace(/-izle.*$/i, "").replace(/-/g, " "));
  for (var k = 0; k < names.length; k++) {
    if (names[k] && slug && (slug === names[k] || slug.indexOf(names[k]) !== -1 || names[k].indexOf(slug) !== -1)) score = Math.max(score, 60);
  }
  return score;
}

function findSeriesUrl(meta) {
  var queries = [];
  if (meta && meta.name) queries.push(meta.name);
  if (meta && meta.original_name && meta.original_name !== meta.name) queries.push(meta.original_name);

  function trySearchApi(i) {
    if (i >= queries.length) return Promise.resolve(null);
    var q = queries[i];
    return getJson(HOST + "/ara?q=" + encodeURIComponent(q), { "User-Agent": UA, "Accept": "application/json", "X-Requested-With": "XMLHttpRequest", "Referer": HOST + "/" })
      .then(function (data) {
        if (Array.isArray(data) && data.length) {
          var imdb = meta && meta.external_ids ? meta.external_ids.imdb_id : null;
          if (imdb) {
            for (var j = 0; j < data.length; j++) {
              var poster = String((data[j] && data[j].poster_url) || "");
              if (poster.indexOf(imdb) !== -1 && data[j].slug) return HOST + "/diziler/" + data[j].slug + "/";
            }
          }
          for (var k = 0; k < data.length; k++) {
            if (data[k] && data[k].slug) return HOST + "/diziler/" + data[k].slug + "/";
          }
        }
        return trySearchApi(i + 1);
      }).catch(function () { return trySearchApi(i + 1); });
  }

  return trySearchApi(0).then(function (found) {
    if (found) return found;
    return getText(HOST + "/", HOST + "/").then(function (html) {
      var items = parseDirectory(html);
      if (!items.length) return null;
      var best = null, bestScore = -1;
      for (var i = 0; i < items.length; i++) {
        var sc = scoreMatch(items[i], meta || {});
        if (sc > bestScore) { bestScore = sc; best = items[i]; }
      }
      if (best && bestScore >= 40) return best.url;
      // last resort: guess slug
      var slug = slugify((meta && (meta.name || meta.original_name)) || "");
      return slug ? (HOST + "/diziler/" + slug + "/") : null;
    });
  });
}

function findEpisodeUrl(seriesHtml, seriesUrl, season, episode) {
  var html = String(seriesHtml || "");
  var seriesSlug = seriesUrl.replace(/^.*\/diziler\/([^\/?#]+).*$/i, "$1");
  var s = String(season), e = String(episode);
  // direct episode link pattern: /slug-S-sezon-E-bolum-...
  var re1 = new RegExp('href=["\']([^"\']*' + seriesSlug.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + '-' + s + '-sezon-' + e + '-bolum[^"\']*)["\']', 'i');
  var m = re1.exec(html);
  if (m) return abs(m[1], seriesUrl);
  // generic pattern
  var re2 = new RegExp('href=["\']([^"\']*-' + s + '-sezon-' + e + '-bolum[^"\']*)["\']', 'i');
  m = re2.exec(html);
  if (m) return abs(m[1], seriesUrl);
  // season page link
  var reSeason = new RegExp('href=["\']([^"\']*' + seriesSlug.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + '-sezon-' + s + '[^"\']*|/sezon/' + s + '[^"\']*)["\']', 'i');
  m = reSeason.exec(html);
  if (m) return { seasonUrl: abs(m[1], seriesUrl) };
  return null;
}

function extractPlayerCandidates(html, pageUrl) {
  var text = String(html || "");
  var out = [];
  var seen = {};
  function add(u) {
    if (!u) return;
    u = abs(u, pageUrl);
    if (!/^https?:\/\//i.test(u)) return;
    if (seen[u]) return;
    seen[u] = true;
    out.push(u);
  }
  var reIframe = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/gi;
  var m;
  while ((m = reIframe.exec(text)) !== null) add(m[1]);
  // select options (woca-linkpages etc.)
  var reOpt = /<(?:option|a)[^>]+(?:value|href|data-src|data-url)=["']([^"']+)["'][^>]*>/gi;
  while ((m = reOpt.exec(text)) !== null) {
    var v = m[1];
    if (/king\.php|moly|haydi\.php|player\.php|\/player\/|\/embed\/|molystream/i.test(v)) add(v);
  }
  // script sources
  var reUrl = /https?:\/\/[^\s"'\\<>]+(?:king\.php|moly\.php|haydi\.php|player\.php|\/embed\/|molystream)[^\s"'\\<>]*/gi;
  while ((m = reUrl.exec(text)) !== null) add(m[0]);
  return out;
}

function extractM3u8(text) {
  var s = String(text || "");
  var urls = [];
  var re = /https?:\/\/[^\s"'\\<>]+\.m3u8[^\s"'\\<>]*/gi;
  var m;
  while ((m = re.exec(s)) !== null) urls.push(m[0].replace(/\\\//g, "/"));
  return urls;
}

function resolvePlayer(url, referer, depth, visited) {
  if (!url || depth > 4) return Promise.resolve([]);
  if (visited[url]) return Promise.resolve([]);
  visited[url] = true;
  var headers = { "User-Agent": UA, "Referer": referer || HOST + "/", "Accept": "*/*" };
  try {
    var uo = new URL(url);
    headers.Origin = uo.origin;
  } catch (_) {}
  return netFetch(url, { headers: headers }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (body) {
    if (!body) return [];
    var trimmed = body.trim();
    if (/^#EXTM3U/.test(trimmed)) return [{ url: url, referer: referer }];
    var m3u8s = extractM3u8(body);
    if (m3u8s.length) {
      // if body is m3u8 content fetched from non-m3u8 url, treat as playlist; else direct urls
      return m3u8s.map(function (u) { return { url: u, referer: url }; });
    }
    // follow iframes/chain
    var candidates = extractPlayerCandidates(body, url);
    // also try to find sources in scripts (file:"...")
    var reFile = /(?:file|source|src)\s*[:=]\s*["'](https?:[^"']+)["']/gi;
    var m;
    while ((m = reFile.exec(body)) !== null) {
      var f = m[1].replace(/\\\//g, "/");
      if (/\.m3u8/i.test(f)) return [{ url: f, referer: url }];
      candidates.push(f);
    }
    var chain = Promise.resolve([]);
    var filtered = [];
    for (var i = 0; i < candidates.length && filtered.length < 4; i++) {
      if (!visited[candidates[i]]) filtered.push(candidates[i]);
    }
    function tryNext(i) {
      if (i >= filtered.length) return Promise.resolve([]);
      return resolvePlayer(filtered[i], url, depth + 1, visited).then(function (res) {
        if (res && res.length) return res;
        return tryNext(i + 1);
      });
    }
    return tryNext(0);
  }).catch(function () { return []; });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null || (mediaType !== "tv" && mediaType !== "series" && mediaType !== "show")) return Promise.resolve([]);
  var sNum = season != null ? Number(season) : 1;
  var eNum = episode != null ? Number(episode) : 1;
  if (!isFinite(sNum) || !isFinite(eNum)) return Promise.resolve([]);

  return getTvInfo(tmdbId).then(function (info) {
    if (!info) info = {};
    return findSeriesUrl(info).then(function (seriesUrl) {
      if (!seriesUrl) return [];
      return getText(seriesUrl, HOST + "/").then(function (seriesHtml) {
        if (!seriesHtml) return [];
        var ep = findEpisodeUrl(seriesHtml, seriesUrl, sNum, eNum);
        function fetchEpisodePage(targetUrl, referer) {
          return getText(targetUrl, referer).then(function (epHtml) {
            if (!epHtml) return [];
            var candidates = extractPlayerCandidates(epHtml, targetUrl);
            if (!candidates.length) return [];
            var visited = {};
            function tryCandidate(i) {
              if (i >= candidates.length || i >= 5) return Promise.resolve([]);
              return resolvePlayer(candidates[i], targetUrl, 0, visited).then(function (found) {
                if (found && found.length) {
                  var title = (info.name || info.original_name || "Dizi") + " • S" + sNum + "E" + eNum;
                  var streams = [];
                  var seenUrl = {};
                  for (var j = 0; j < found.length && streams.length < 3; j++) {
                    var u = found[j].url;
                    if (!u || seenUrl[u]) continue;
                    seenUrl[u] = true;
                    streams.push({
                      name: "CastSinema • DiziBox",
                      title: "DiziBox • " + title + " • 1080p",
                      url: u,
                      quality: 1080,
                      provider: "castsinema-dizibox",
                      format: "m3u8",
                      headers: { "User-Agent": UA, "Referer": found[j].referer || targetUrl }
                    });
                  }
                  return streams;
                }
                return tryCandidate(i + 1);
              });
            }
            return tryCandidate(0);
          });
        }

        if (ep && typeof ep === "string") {
          return fetchEpisodePage(ep, seriesUrl);
        }
        if (ep && ep.seasonUrl) {
          return getText(ep.seasonUrl, seriesUrl).then(function (seasonHtml) {
            var ep2 = findEpisodeUrl(seasonHtml || "", seriesUrl, sNum, eNum);
            if (ep2 && typeof ep2 === "string") return fetchEpisodePage(ep2, ep.seasonUrl);
            return [];
          });
        }
        // fallback: try common episode URL formats
        var slug = seriesUrl.replace(/^.*\/diziler\/([^\/?#]+).*$/i, "$1");
        var guess = HOST + "/" + slug + "-" + sNum + "-sezon-" + eNum + "-bolum-izle/";
        return fetchEpisodePage(guess, seriesUrl);
      });
    });
  }).catch(function (error) {
    console.error("[CastSinema DiziBox] " + (error && error.message ? error.message : String(error)));
    return [];
  });
}

module.exports = { getStreams: getStreams };
