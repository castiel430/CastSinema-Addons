/* SPDX-License-Identifier: MIT
 * CastSinema DiziPod provider.
 * Turkish series scraper for DiziPod (dizipod.com).
 *
 * Verified flow (live site, 2026-11): admin-ajax get_episode_player -> Dean Edwards
 * unpack -> m3u8. Flow logic adapted from the working BigBull CS Nuvio addon (MIT).
 */
"use strict";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
var BASE = "https://dizipod.com";
var ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
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
  if (String(href).indexOf("//") === 0) return "https:" + href;
  var origin = /^(https?:\/\/[^/]+)/.exec(base);
  if (String(href).charAt(0) === "/") return origin ? origin[1] + href : href;
  return base.replace(/[^/]*$/, "") + href;
}

function norm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u0131]/g, "i").replace(/[\u015f]/g, "s").replace(/[\u011f]/g, "g")
    .replace(/[\u00fc]/g, "u").replace(/[\u00f6]/g, "o").replace(/[\u00e7]/g, "c")
    .replace(/[^a-z0-9]/g, "");
}

function spaced(value) {
  return String(value || "")
    .replace(/\s*\([^)]*\)/g, " ")
    .replace(/\b(?:izle|dizi|film)\b/gi, " ")
    .split(/[\s:\-]+/)
    .map(norm)
    .filter(Boolean)
    .join(" ")
    .replace(/^(?:the|an|a) /, "");
}

function pick(cards, wanted) {
  var w = spaced(wanted);
  if (!w) return null;
  var subset = null;
  for (var i = 0; i < cards.length; i++) {
    var n = spaced(cards[i].title);
    if (!n) continue;
    if (n === w) return cards[i];
    if (!subset && n.indexOf(w + " ") === 0) subset = cards[i];
  }
  return subset;
}

function titleOf(id) {
  return text(TMDB_API + "/tv/" + encodeURIComponent(String(id)) + "?api_key=" + TMDB_KEY + "&language=tr-TR")
    .then(function (body) {
      var meta = JSON.parse(body) || {};
      return String(meta.name || meta.original_name || "").trim();
    })
    .catch(function () { return ""; });
}

function searchCards(html, isTv) {
  var cards = [];
  var marker = isTv ? "/diziler/" : "/film/";
  var re = /<li\b[^>]*>([\s\S]*?)<\/li>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var href = first(/<a\b[^>]*href="([^"]+)"/, m[1]);
    if (!href || href.indexOf(marker) === -1) continue;
    var title = first(/<div class="title"[^>]*>([\s\S]*?)<\/div>/, m[1]) ||
      first(/<a\b[^>]*title="([^"]+)"/, m[1]);
    if (!title) continue;
    cards.push({ url: abs(BASE, href), title: title.replace(/<[^>]+>/g, "").trim() });
  }
  return cards;
}

function encodeBase(value, base) {
  if (value === 0) return "0";
  var out = "";
  while (value > 0) {
    out = ALPHABET.charAt(value % base) + out;
    value = Math.floor(value / base);
  }
  return out;
}

function unpack(html) {
  var m = /eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]*?\}\('((?:[^'\\]+|\\.)*)',(\d+),(\d+),'((?:[^'\\]+|\\.)*)'\.split\('\|'\)/.exec(String(html || ""));
  if (!m) return String(html || "");
  var words = m[4].split("|");
  var base = parseInt(m[2], 10);
  if (!(base >= 2 && base <= ALPHABET.length)) return String(html || "");
  var dict = {};
  for (var i = 0; i < words.length; i++) {
    var key = encodeBase(i, base);
    dict[key] = words[i] || key;
  }
  return m[1].replace(/\\'/g, "'").replace(/\b\w+\b/g, function (token) {
    return Object.prototype.hasOwnProperty.call(dict, token) ? dict[token] : token;
  });
}

function sourcesOf(html) {
  var script = unpack(html);
  var out = [];
  var seen = {};
  var re = /"file"\s*:\s*"([^"]+)"\s*,\s*"label"\s*:\s*"([^"]*)"/g;
  var m;
  while ((m = re.exec(script)) !== null) {
    var url = m[1].replace(/\\/g, "");
    if (!/^https?:/.test(url) || seen[url]) continue;
    seen[url] = 1;
    out.push({ url: url, label: String(m[2] || "").trim() });
  }
  if (out.length) return out;
  var any = /https?:(?:\\?\/){2}[^\s"']+?\.m3u8/g;
  while ((m = any.exec(script)) !== null) {
    var plain = m[0].replace(/\\/g, "");
    if (seen[plain]) continue;
    seen[plain] = 1;
    out.push({ url: plain, label: "" });
  }
  return out;
}

function episodeLink(html, season, episode) {
  var re = /href="([^"]*-(\d+)-sezon-(\d+)-bolum\/)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (parseInt(m[2], 10) === season && parseInt(m[3], 10) === episode) {
      return Promise.resolve(abs(BASE, m[1]));
    }
  }
  return Promise.resolve(null);
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType === "movie") return Promise.resolve([]);
  var want = parseInt(season, 10) || 1;
  var wantEp = parseInt(episode, 10) || 1;
  var pageUrl = null;
  var playerUrl = null;

  return titleOf(tmdbId).then(function (title) {
    if (!title) return null;
    return text(BASE + "/?s=" + encodeURIComponent(title)).then(function (searchHtml) {
      var hit = pick(searchCards(searchHtml, true), title);
      return hit ? hit.url : null;
    });
  }).then(function (targetUrl) {
    if (!targetUrl) return null;
    return text(targetUrl).then(function (seriesHtml) {
      return episodeLink(seriesHtml, want, wantEp);
    });
  }).then(function (resolvedPage) {
    if (!resolvedPage) return [];
    pageUrl = resolvedPage;
    return text(pageUrl);
  }).then(function (page) {
    if (!page) return [];
    var postId = first(/data-post-id="(\d+)"/, page);
    if (!postId) return [];
    return text(BASE + "/wp/wp-admin/admin-ajax.php?action=get_episode_player&post_id=" + postId, { referer: pageUrl });
  }).then(function (payload) {
    if (!payload) return [];
    var raw = first(/<iframe[^>]+src=\\?"((?:[^"\\]|\\\/)*)/, payload) ||
      first(/"(https?:[^"]+?(?:embed|player|\/e\/)[^"]*)"/, payload);
    if (!raw) return [];
    playerUrl = abs(pageUrl, raw.replace(/\\\//g, "/"));
    return text(playerUrl, { referer: pageUrl });
  }).then(function (player) {
    if (!player) return [];
    var list = sourcesOf(player);
    return list.map(function (item, index) {
      var qMatch = /(\d{3,4}p)/i.exec(item.label || "") || /-(1080|720|480|360)\.mp4/i.exec(item.url || "");
      var q = qMatch ? (qMatch[1].toLowerCase().indexOf("p") > -1 ? qMatch[1].toLowerCase() : qMatch[1] + "p") : "auto";
      return {
        name: "CastSinema • DiziPod",
        title: "DiziPod • " + (item.label || "Kaynak " + (index + 1)) + " • HLS",
        url: item.url,
        quality: q,
        provider: "castsinema-dizipod",
        format: "m3u8",
        headers: { "User-Agent": UA, "Referer": playerUrl, "Accept": "*/*" },
        behaviorHints: { notWebReady: true, proxyHeaders: { request: { "User-Agent": UA, "Referer": playerUrl } } },
        subtitles: []
      };
    });
  }).catch(function (e) {
    console.error("[CastSinema DiziPod] " + (e && e.message ? e.message : String(e)));
    return [];
  });
}

module.exports = { getStreams: getStreams };
