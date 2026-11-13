/* SPDX-License-Identifier: GPL-3.0-only
 * CastSinema provider for the CineStream vidup source.
 * Uses the same public HTTP decrypt service as the upstream provider, avoiding Node-only crypto.
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


var VIDUP = "https://vidup.to";
var DECRYPT = "https://enc-dec.app/api";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function baseHeaders() {
  return {
    "User-Agent": UA,
    "Referer": VIDUP + "/",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "*/*"
  };
}

function jsonPost(url, payload, headers) {
  var h = Object.assign({ "Content-Type": "application/json" }, headers || {});
  return netFetch(url, { method: "POST", headers: h, body: JSON.stringify(payload) })
    .then(function (r) { return r.ok ? r.text() : ""; });
}

function emptyPost(url, headers) {
  return netFetch(url, { method: "POST", headers: headers || {} })
    .then(function (r) { return r.ok ? r.text() : ""; });
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

function extractEncryptedToken(text) {
  var escaped = /\\\"(?:en|token)\\\":\\\"(.*?)\\\"/.exec(text || "");
  if (escaped) return escaped[1];
  var normal = /[\"](?:en|token)[\"]\s*:\s*[\"]([^\"]+)[\"]/.exec(text || "");
  return normal ? normal[1] : null;
}

function decrypt(text) {
  return jsonPost(DECRYPT + "/dec-vidup", { text: text }, null)
    .then(parseJson);
}

function resolveServer(server, streamBase, postHeaders) {
  if (!server || !server.data) return Promise.resolve([]);
  var name = server.name || "Vidup";
  var streamUrl = streamBase.replace(/\/$/, "") + "/" + server.data;
  return emptyPost(streamUrl, postHeaders)
    .then(function (encrypted) { return encrypted ? decrypt(encrypted) : null; })
    .then(function (decoded) {
      if (!decoded || decoded.status !== 200 || !decoded.result || !decoded.result.url) return [];
      var finalUrl = decoded.result.url;
      return [{
        name: "CastSinema • Vidup",
        title: "Vidup • " + name + " • 1080p",
        url: finalUrl,
        quality: 1080,
        provider: "castsinema-vidup",
        format: finalUrl.indexOf(".m3u8") >= 0 ? "m3u8" : "video",
        headers: { "User-Agent": UA, "Referer": VIDUP + "/" }
      }];
    })
    .catch(function () { return []; });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  var isTv = mediaType === "tv" && season != null && episode != null;
  var pageUrl = isTv
    ? VIDUP + "/tv/" + encodeURIComponent(String(tmdbId)) + "/" + encodeURIComponent(String(season)) + "/" + encodeURIComponent(String(episode))
    : VIDUP + "/movie/" + encodeURIComponent(String(tmdbId));

  return netFetch(pageUrl, { headers: { "User-Agent": UA, "Referer": VIDUP + "/", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" } })
    .then(function (r) { return r.ok ? r.text() : ""; })
    .then(function (page) {
      var enc = extractEncryptedToken(page);
      if (!enc) return null;
      return netFetch(DECRYPT + "/enc-vidup?text=" + encodeURIComponent(enc) + "&stage=1", { headers: baseHeaders() })
        .then(function (r) { return r.ok ? r.text() : ""; });
    })
    .then(function (stage1Text) {
      if (!stage1Text) return [];
      var s1 = parseJson(stage1Text);
      if (!s1 || s1.status !== 200 || !s1.result) return [];

      // Support 2-stage response with stage1 url or legacy direct servers
      if (s1.result.stage1) {
        var h1 = Object.assign({}, baseHeaders(), s1.result.token ? { "X-CSRF-Token": s1.result.token } : {});
        return emptyPost(s1.result.stage1, h1)
          .then(function (p1Text) {
            if (!p1Text) return null;
            return netFetch(DECRYPT + "/enc-vidup?text=" + encodeURIComponent(p1Text) + "&stage=2", { headers: baseHeaders() })
              .then(function (r) { return r.ok ? r.text() : ""; });
          })
          .then(function (s2Text) {
            var s2 = parseJson(s2Text);
            return s2 && s2.status === 200 && s2.result ? s2.result : null;
          });
      }
      return s1.result;
    })
    .then(function (initial) {
      if (!initial || !initial.servers || !initial.stream) return [];
      var serversUrl = initial.servers;
      var streamUrl = initial.stream;
      var token = initial.token;
      var postHeaders = Object.assign({}, baseHeaders(), token ? { "X-CSRF-Token": token } : {});
      return emptyPost(serversUrl, postHeaders)
        .then(function (encryptedServers) { return encryptedServers ? decrypt(encryptedServers) : null; })
        .then(function (serverData) {
          if (!serverData || serverData.status !== 200 || !Array.isArray(serverData.result)) return [];
          return Promise.all(serverData.result.map(function (server) { return resolveServer(server, streamUrl, postHeaders); }))
            .then(function (groups) {
              var out = [];
              groups.forEach(function (group) { group.forEach(function (item) { if (!out.some(function (x) { return x.url === item.url; })) out.push(item); }); });
              return out;
            });
        });
    })
    .catch(function (error) {
      console.error("[CastSinema Vidup] " + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = { getStreams: getStreams };
