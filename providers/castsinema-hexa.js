/* SPDX-License-Identifier: GPL-3.0-only
 * CastSinema Hexa provider.
 * Hexa protects its API with a captcha handshake: a challenge is fetched,
 * handed to the public decrypt service, and the result is redeemed for a
 * short lived cap token. All of it is plain HTTP, no page script is executed.
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


var HEXA_API = "https://theemoviedb.hexa.su";
var DECRYPT_API = "https://enc-dec.app/api";
var HEXA_REFERER = "https://hexa.su/";
var HEXA_ORIGIN = "https://hexa.su";
var CAP_API = "https://cap.hexa.su/15d2cf0395";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 OPR/129.0.0.0 (Edition std-2)";

function randomHex(bytes) {
  var out = "";
  for (var i = 0; i < bytes; i++) {
    var n = Math.floor(Math.random() * 256).toString(16);
    out += n.length === 1 ? "0" + n : n;
  }
  return out;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

function getText(url, headers) {
  return netFetch(url, { headers: headers || {} }).then(function (r) { return r.ok ? r.text() : ""; });
}

// Posts a JSON payload; an empty payload sends no body at all.
function postJson(url, payload, extraHeaders) {
  var headers = Object.assign({}, extraHeaders || {});
  var body;
  if (payload != null) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(payload);
  }
  return netFetch(url, { method: "POST", headers: headers, body: body })
    .then(function (r) { return r.ok ? r.text() : ""; });
}

// challenge -> decrypt service -> redeem -> short lived cap token
function getCapToken() {
  var challengeHeaders = {
    "Accept-Language": "en-US,en;q=0.9,ru;q=0.8,fr;q=0.7,bg;q=0.6,pl;q=0.5,id;q=0.4,zh-CN;q=0.3,zh;q=0.2,ja;q=0.1,es;q=0.1",
    "Origin": HEXA_ORIGIN,
    "Referer": HEXA_REFERER,
    "User-Agent": UA
  };
  return postJson(CAP_API + "/challenge", null, challengeHeaders)
    .then(function (challengeText) {
      var challenge = parseJson(challengeText);
      if (!challenge) return null;
      return postJson(DECRYPT_API + "/enc-hexa", { challenge_data: challenge })
        .then(function (encText) {
          var enc = parseJson(encText);
          var result = enc && enc.result;
          if (!result) return null;
          // The redeem endpoint expects the result object, not the envelope.
          return postJson(CAP_API + "/redeem", result)
            .then(function (redeemText) {
              var redeem = parseJson(redeemText);
              return redeem && redeem.token ? redeem.token : null;
            });
        });
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  var isTv = mediaType === "tv" && season != null && episode != null;
  var url = isTv
    ? HEXA_API + "/api/tmdb/tv/" + encodeURIComponent(String(tmdbId)) + "/season/" + encodeURIComponent(String(season)) + "/episode/" + encodeURIComponent(String(episode)) + "/images"
    : HEXA_API + "/api/tmdb/movie/" + encodeURIComponent(String(tmdbId)) + "/images";

  var key = randomHex(32);

  return getCapToken()
    .then(function (capToken) {
      if (!capToken) return null;
      var headers = {
        "User-Agent": UA,
        "Accept": "text/plain",
        "X-Api-Key": key,
        "X-Fingerprint-Lite": "e9136c41504646444",
        "Referer": HEXA_REFERER,
        "Origin": HEXA_ORIGIN,
        "X-Cap-Token": capToken
      };
      return getText(url, headers);
    })
    .then(function (encrypted) {
      if (!encrypted) return null;
      return postJson(DECRYPT_API + "/dec-hexa", { text: encrypted, key: key });
    })
    .then(function (decodedText) {
      if (!decodedText) return [];
      var decoded = parseJson(decodedText);
      var sources = decoded && decoded.result && decoded.result.sources;
      if (!Array.isArray(sources)) return [];
      var seen = {};
      var out = [];
      sources.forEach(function (source) {
        if (!source || !source.url || seen[source.url]) return;
        seen[source.url] = true;
        var server = source.server || "Server";
        out.push({
          name: "CastSinema • Hexa",
          title: "Hexa • " + server,
          url: source.url,
          quality: 1080,
          provider: "castsinema-hexa",
          format: String(source.url).indexOf(".m3u8") >= 0 ? "m3u8" : "video",
          headers: { "User-Agent": UA, "Referer": HEXA_REFERER }
        });
      });
      return out;
    })
    .catch(function (error) {
      console.error("[CastSinema Hexa] " + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = { getStreams: getStreams };
