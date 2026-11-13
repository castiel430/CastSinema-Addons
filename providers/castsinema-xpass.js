/* SPDX-License-Identifier: GPL-3.0-only
 * CastSinema provider for the CineStream xpass source.
 */
"use strict";
// --- request layer ---------------------------------------------------------
// Most of these sites sit behind Cloudflare, which refuses requests whose
// client looks like a bot. The plugin runtime bridges fetch to a native HTTP
// client, and the profile that client sends by default is turned away by
// several of these sites with 403 Forbidden. Sending a browser profile
// usually gets through; when it does not, the next profile is tried.
var UA_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
var UA_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";
var UA_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0";
var UA_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15";
var UA_MEDIA = "VLC/3.0.21 LibVLC/3.0.21";
var ACCEPT_HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
var ACCEPT_LANG = "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7";

// Headers that describe the request itself and must survive a profile swap.
var KEEP_HEADERS = ["Referer", "Origin", "Cookie", "X-Requested-With", "X-CSRF-TOKEN", "X-CSRF-Token", "X-Api-Key", "X-Cap-Token", "X-Fingerprint-Lite", "Content-Type", "Authorization"];

function requestProfiles() {
  return [
    { "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 13; SM-G998B Build/TP1A.220624.014)", "Accept": "*/*" },
    { "User-Agent": "okhttp/4.9.2", "Accept": "*/*" },
    { "User-Agent": "ExoPlayerLib/2.19.1", "Accept": "*/*" },
    { "User-Agent": "stagefright/1.2 (Linux;Android 11)", "Accept": "*/*" },
    { "User-Agent": "VLC/3.0.21 LibVLC/3.0.21", "Accept": "*/*" },
    { "User-Agent": UA_CHROME, "Accept": ACCEPT_HTML, "Accept-Language": ACCEPT_LANG, "Upgrade-Insecure-Requests": "1", "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none", "Sec-Fetch-User": "?1" },
    { "User-Agent": UA_FIREFOX, "Accept": ACCEPT_HTML, "Accept-Language": ACCEPT_LANG, "Upgrade-Insecure-Requests": "1" },
    { "User-Agent": UA_EDGE, "Accept": ACCEPT_HTML, "Accept-Language": ACCEPT_LANG, "Upgrade-Insecure-Requests": "1", "Sec-Ch-Ua": "\"Chromium\";v=\"139\", \"Not;A=Brand\";v=\"24\"", "Sec-Ch-Ua-Mobile": "?0", "Sec-Ch-Ua-Platform": "\"Windows\"" },
    { "User-Agent": UA_SAFARI, "Accept": ACCEPT_HTML, "Accept-Language": ACCEPT_LANG },
    { "User-Agent": UA_MEDIA, "Accept": "*/*" },
    { "Accept": "*/*" }
  ];
}

function mergeHeaders(base, profile) {
  var headers = {};
  var key;
  for (key in base) {
    if (!Object.prototype.hasOwnProperty.call(base, key)) continue;
    if (KEEP_HEADERS.indexOf(key) !== -1) headers[key] = base[key];
  }
  for (key in profile) {
    if (!Object.prototype.hasOwnProperty.call(profile, key)) continue;
    headers[key] = profile[key];
  }
  return headers;
}

function isRefused(response) {
  if (!response) return true;
  if (typeof response.status !== "number") return false;
  return response.status === 403 || response.status === 503;
}

// fetch with a browser profile, retrying with another profile when the site
// answers with a bot refusal.
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
    return fetch(url, {
      method: options.method || "GET",
      headers: mergeHeaders(base, profile),
      body: options.body
    }).then(function (response) {
      if (!isRefused(response)) return response;
      return next();
    }).catch(function (error) {
      if (attempt >= profiles.length) throw error;
      return next();
    });
  }

  return next();
}
// --- end request layer -----------------------------------------------------


var XPASS = "https://play.xpass.top";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function parse(text) { try { return JSON.parse(text); } catch (_) { return null; } }
function backups(html) {
  var m = /var\s+backups\s*=\s*(\[[\s\S]*?\]);/.exec(html || ""); if (!m) return [];
  var arr = parse(m[1]); if (!Array.isArray(arr)) return [];
  return arr.filter(function (x) { return x && x.name && x.url; });
}
function full(url) { if (/^https?:\/\//i.test(url)) return url; return XPASS.replace(/\/$/, "") + (url.charAt(0) === "/" ? url : "/" + url); }

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  var isTv = mediaType === "tv" && season != null && episode != null;
  var embed = isTv
    ? XPASS + "/e/tv/" + encodeURIComponent(String(tmdbId)) + "/" + encodeURIComponent(String(season)) + "/" + encodeURIComponent(String(episode))
    : XPASS + "/e/movie/" + encodeURIComponent(String(tmdbId));
  return netFetch(embed, { headers: { "User-Agent": UA, "Referer": XPASS + "/" } })
    .then(function (r) { return r.ok ? r.text() : ""; })
    .then(function (html) {
      if (!html) return [];
      var list = backups(html);
      if (!list || !list.length) {
        var tm = /<title>([^<]+)<\/title>/i.exec(html);
        return [{
          name: "CastSinema • Xpass",
          title: "Xpass • " + (tm && tm[1] ? tm[1].trim() : "Player") + " • 1080p",
          url: embed,
          quality: 1080,
          provider: "castsinema-xpass",
          format: "video",
          headers: { "User-Agent": UA, "Referer": XPASS + "/" }
        }];
      }
      return Promise.all(list.map(function (server) {
        return netFetch(full(server.url), { headers: { "User-Agent": UA, "Referer": embed } })
          .then(function (r) { return r.ok ? r.text() : ""; })
          .then(function (body) {
            var root = parse(body); var sources = root && root.playlist && root.playlist[0] && root.playlist[0].sources;
            if (!Array.isArray(sources)) return [];
            return sources.filter(function (s) { return s && /^https?:\/\//i.test(s.file || ""); }).map(function (s) {
              var url = s.file;
              return {
                name: "CastSinema • Xpass",
                title: "Xpass • " + server.name,
                url: url,
                quality: 1080,
                provider: "castsinema-xpass",
                format: /hls/i.test(s.type || "") || url.indexOf(".m3u8") >= 0 ? "m3u8" : "video",
                headers: { "User-Agent": UA, "Referer": XPASS + "/" }
              };
            });
          }).catch(function () { return []; });
      })).then(function (groups) {
        var out = [], seen = {};
        groups.forEach(function (g) { g.forEach(function (x) { if (x.url && !seen[x.url]) { seen[x.url] = true; out.push(x); } }); });
        return out;
      });
    })
    .catch(function (e) { console.error("[CastSinema Xpass] " + (e && e.message ? e.message : String(e))); return []; });
}

module.exports = { getStreams: getStreams };
