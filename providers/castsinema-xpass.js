/* SPDX-License-Identifier: MIT
 * CastSinema Xpass provider.
 * Movie/series mirror index (xpass.top -> play.xpass.top).
 *
 * Flow: /e/(movie|tv)/<id> -> dataUrl -> encrypted /data response (AES-256-GCM,
 *       key = SHA-256("spv3-data-response|<salt>|<path>|<token>")) -> source list
 *       -> each /mdata|/vip playlist.json -> master.m3u8 mirrors.
 * The per-build salt is read from the player bundle at runtime, with a fallback.
 */
"use strict";

var XPASS = "https://play.xpass.top";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
var DATA_PREFIX = "spv3-data-response|";
var SALT_FALLBACK = "spv3-build-1787821613-50e5fc97c9dce367";

var TIMEOUT_MS = 8000;

/** fetch + text, bounded: a single slow mirror must not stall the whole list. */
function text(url, referer) {
  var headers = { "User-Agent": UA, Accept: "text/html,application/json,*/*" };
  if (referer) headers.Referer = referer;
  var request = fetch(url, { headers: headers }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
    return r.text();
  });
  if (typeof setTimeout !== "function") return request;
  var timer = null;
  var deadline = new Promise(function (_, reject) {
    timer = setTimeout(function () { reject(new Error("timeout " + url)); }, TIMEOUT_MS);
  });
  return Promise.race([request, deadline]).then(
    function (value) { if (timer) clearTimeout(timer); return value; },
    function (err) { if (timer) clearTimeout(timer); throw err; }
  );
}

function first(re, body) {
  var m = re.exec(String(body || ""));
  return m ? m[1] : null;
}

function full(url) {
  if (/^https?:\/\//i.test(url)) return url;
  return XPASS + (String(url).charAt(0) === "/" ? url : "/" + url);
}

var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function b64(value) {
  var raw = String(value || "").replace(/[^A-Za-z0-9+/=]/g, "");
  var out = "";
  var buf = 0;
  var bits = 0;
  for (var i = 0; i < raw.length; i++) {
    var c = raw.charAt(i);
    if (c === "=") break;
    var v = B64.indexOf(c);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buf >> bits) & 0xff);
    }
  }
  return out;
}

function b64urlEncode(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i] & 0xff;
    var b1 = i + 1 < bytes.length ? bytes[i + 1] & 0xff : 0;
    var b2 = i + 2 < bytes.length ? bytes[i + 2] & 0xff : 0;
    out += B64.charAt(b0 >> 2);
    out += B64.charAt(((b0 & 3) << 4) | (b1 >> 4));
    out += i + 1 < bytes.length ? B64.charAt(((b1 & 15) << 2) | (b2 >> 6)) : "";
    out += i + 2 < bytes.length ? B64.charAt(b2 & 63) : "";
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(value) {
  var s = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  return bytes(b64(s));
}

function bytes(value) {
  var s = String(value || "");
  var out = [];
  for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
  return out;
}

function fromUtf8(b) {
  var out = "";
  var i = 0;
  while (i < b.length) {
    var c = b[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else if (c < 0xf0) out += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
    else {
      var cp = ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

function randomBytes(size) {
  var out = [];
  for (var i = 0; i < size; i++) out.push(Math.floor(Math.random() * 256));
  return out;
}

// ---- SHA-256 ----
var K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function ror(x, n) {
  return (x >>> n) | (x << (32 - n));
}

function sha256(inBytes) {
  var msg = inBytes.slice();
  var len = inBytes.length;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  var bits = len * 8;
  for (var hb = 3; hb >= 0; hb--) msg.push((Math.floor(bits / 4294967296) >>> (8 * hb)) & 0xff);
  for (var b = 3; b >= 0; b--) msg.push((bits >>> (8 * b)) & 0xff);
  var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  var w = [];
  for (var off = 0; off < msg.length; off += 64) {
    for (var i = 0; i < 16; i++) {
      w[i] = (msg[off + 4 * i] << 24) | (msg[off + 4 * i + 1] << 16) | (msg[off + 4 * i + 2] << 8) | msg[off + 4 * i + 3];
    }
    for (var t = 16; t < 64; t++) {
      var s0 = ror(w[t - 15], 7) ^ ror(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      var s1 = ror(w[t - 2], 17) ^ ror(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    var a = h0, bb = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (var r = 0; r < 64; r++) {
      var S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + K256[r] + w[r]) | 0;
      var S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
      var maj = (a & bb) ^ (a & c) ^ (bb & c);
      var t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = bb;
      bb = a;
      a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + bb) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  var out = [];
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach(function (v) {
    out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  });
  return out;
}

// ---- AES-256 (forward cipher, needed by GCM) ----
var SBOX = [];
(function () {
  var p = 1;
  var q = 1;
  do {
    p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    var x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
    SBOX[p] = (x ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
})();

var RCON = [0, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function xt(a) {
  return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
}

function gm(a, b) {
  var r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a = xt(a);
    b >>= 1;
  }
  return r;
}

function expandKey(key) {
  var nk = 8;
  var w = [];
  var i;
  var t;
  for (i = 0; i < nk; i++) {
    w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
  }
  for (i = nk; i < 60; i++) {
    t = w[i - 1];
    if (i % nk === 0) {
      t = (t << 8) | (t >>> 24);
      t = ((SBOX[t >>> 24] << 24) | (SBOX[(t >>> 16) & 0xff] << 16) | (SBOX[(t >>> 8) & 0xff] << 8) | SBOX[t & 0xff]) >>> 0;
      t = (t ^ (RCON[i / nk] << 24)) >>> 0;
    } else if (i % nk === 4) {
      t = ((SBOX[t >>> 24] << 24) | (SBOX[(t >>> 16) & 0xff] << 16) | (SBOX[(t >>> 8) & 0xff] << 8) | SBOX[t & 0xff]) >>> 0;
    }
    w[i] = (w[i - nk] ^ t) >>> 0;
  }
  return w;
}

function addRoundKey(s, w, round) {
  for (var c = 0; c < 4; c++) {
    var k = w[round * 4 + c];
    s[4 * c] ^= (k >>> 24) & 0xff;
    s[4 * c + 1] ^= (k >>> 16) & 0xff;
    s[4 * c + 2] ^= (k >>> 8) & 0xff;
    s[4 * c + 3] ^= k & 0xff;
  }
}

function shiftRows(s) {
  for (var r = 1; r < 4; r++) {
    var row = [s[r], s[r + 4], s[r + 8], s[r + 12]];
    for (var i = 0; i < 4; i++) s[r + 4 * ((i - r + 4) % 4)] = row[i];
  }
}

function mixColumns(s) {
  for (var c = 0; c < 4; c++) {
    var i = 4 * c;
    var a = s[i], b = s[i + 1], d = s[i + 2], e = s[i + 3];
    s[i] = gm(a, 2) ^ gm(b, 3) ^ d ^ e;
    s[i + 1] = a ^ gm(b, 2) ^ gm(d, 3) ^ e;
    s[i + 2] = a ^ b ^ gm(d, 2) ^ gm(e, 3);
    s[i + 3] = gm(a, 3) ^ b ^ d ^ gm(e, 2);
  }
}

function encryptBlock(w, block) {
  var s = block.slice(0, 16);
  addRoundKey(s, w, 0);
  for (var round = 1; round <= 14; round++) {
    for (var i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    shiftRows(s);
    if (round !== 14) mixColumns(s);
    addRoundKey(s, w, round);
  }
  return s;
}

function gmul128(x, y) {
  var z = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  var v = x.slice();
  for (var i = 0; i < 128; i++) {
    if ((y[i >> 3] >> (7 - (i & 7))) & 1) for (var j = 0; j < 16; j++) z[j] ^= v[j];
    var lsb = v[15] & 1;
    for (var k = 15; k > 0; k--) v[k] = ((v[k] >>> 1) | ((v[k - 1] & 1) << 7)) & 0xff;
    v[0] = (v[0] >>> 1) & 0xff;
    if (lsb) v[0] ^= 0xe1;
  }
  return z;
}

function aesGcmDecrypt(key, iv, data) {
  var w = expandKey(key);
  var h = encryptBlock(w, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  var ctr = iv.slice();
  while (ctr.length < 12) ctr.push(0);
  ctr = ctr.slice(0, 12).concat([0, 0, 0, 1]);
  var payload = data.slice();
  var tag = payload.splice(payload.length - 16, 16);
  var out = [];
  var counter = ctr.slice();
  for (var pre = 15; pre >= 0; pre--) {
    counter[pre] = (counter[pre] + 1) & 0xff;
    if (counter[pre] !== 0) break;
  }
  for (var off = 0; off < payload.length; off += 16) {
    var ks = encryptBlock(w, counter);
    for (var b = 0; b < 16 && off + b < payload.length; b++) out.push(payload[off + b] ^ ks[b]);
    for (var up = 15; up >= 0; up--) {
      counter[up] = (counter[up] + 1) & 0xff;
      if (counter[up] !== 0) break;
    }
  }
  var y = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (var p = 0; p < payload.length; p += 16) {
    var block = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var q = 0; q < 16 && p + q < payload.length; q++) block[q] = payload[p + q];
    for (var m = 0; m < 16; m++) y[m] ^= block[m];
    y = gmul128(y, h);
  }
  var lens = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  var bits = payload.length * 8;
  lens[12] = (bits >>> 24) & 0xff;
  lens[13] = (bits >>> 16) & 0xff;
  lens[14] = (bits >>> 8) & 0xff;
  lens[15] = bits & 0xff;
  for (var m2 = 0; m2 < 16; m2++) y[m2] ^= lens[m2];
  y = gmul128(y, h);
  var mask = encryptBlock(w, ctr);
  for (var v2 = 0; v2 < 16; v2++) if ((y[v2] ^ mask[v2]) !== tag[v2]) return null;
  return out;
}

function hexOf(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return out;
}

/** The AES key is SHA-256 over the signed data path, token and build salt. */
function deriveKey(pathname, token, salt) {
  var message = DATA_PREFIX + salt + "|" + pathname + "|" + token;
  var messageBytes = [];
  for (var i = 0; i < message.length; i++) messageBytes.push(message.charCodeAt(i) & 0xff);
  return sha256(messageBytes);
}

function saltOf(html) {
  var player = first(/src=["'](\/static\/[A-Za-z0-9]+\.[a-z0-9]+(?:\?[^"']*)?)["']/i, html);
  if (!player) return Promise.resolve(SALT_FALLBACK);
  return text(full(player), XPASS + "/")
    .then(function (bundle) {
      var salt = first(/["'](spv3-build-[0-9a-z-]+)["']/i, bundle) || first(/(spv3-build-[0-9a-z-]+)/i, bundle);
      return salt || SALT_FALLBACK;
    })
    .catch(function () { return SALT_FALLBACK; });
}

function decryptPayload(body, pathname, token, salt) {
  var raw = b64urlDecode(String(body || "").trim());
  if (raw.length < 28) return null;
  var key = deriveKey(pathname, token, salt);
  var plain = aesGcmDecrypt(key, raw.slice(0, 12), raw.slice(12));
  if (!plain) return null;
  try { return JSON.parse(fromUtf8(plain)); } catch (e) { return null; }
}

function sourceRows(list, referer) {
  // There are usually 20+ mirrors and most resolve to the same masters. Reading
  // the first dozen is enough to cover the language variants without making the
  // caller wait on every mirror.
  var jobs = (list || [])
    .filter(function (x) { return x && x.url; })
    .slice(0, 12)
    .map(function (server) {
    return text(full(server.url), referer)
      .then(function (body) {
        var root = JSON.parse(body);
        var out = [];
        var playlists = (root && root.playlist) || [];
        for (var i = 0; i < playlists.length; i++) {
          var sources = (playlists[i] && playlists[i].sources) || [];
          for (var j = 0; j < sources.length; j++) {
            var src = sources[j] || {};
            if (!src.file || !/^https?:\/\//i.test(src.file)) continue;
            out.push({
              label: String(server.name || src.label || "Kaynak"),
              url: src.file,
              hls: /hls/i.test(String(src.type || "")) || src.file.indexOf(".m3u8") !== -1
            });
          }
        }
        return out;
      })
      .catch(function () { return []; });
  });
  return Promise.all(jobs);
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  var isTv = mediaType === "tv" && season != null && episode != null;
  var embed = isTv
    ? XPASS + "/e/tv/" + encodeURIComponent(String(tmdbId)) + "/" + encodeURIComponent(String(season)) + "/" + encodeURIComponent(String(episode))
    : XPASS + "/e/movie/" + encodeURIComponent(String(tmdbId));

  return text(embed, XPASS + "/")
    .then(function (html) {
      var dataUrl = first(/var\s+dataUrl\s*=\s*["']([^"']+)/, html);
      if (!dataUrl) return [];
      var origin = "https://play.xpass.top";
      // Plain string parsing: the plugin runtime does not guarantee a global URL.
      var pathname = String(dataUrl).split("?")[0];
      var rawToken = first(/[?&]token=([^&#]+)/, dataUrl);
      var token = rawToken ? decodeURIComponent(rawToken) : null;
      if (!token) return [];
      return saltOf(html).then(function (salt) {
        return text(origin + dataUrl, embed)
          .then(function (body) { return decryptPayload(body, pathname, token, salt); })
          .then(function (list) {
            if (!Array.isArray(list)) return [];
            return sourceRows(list, embed).then(function (groups) {
              var out = [], seen = {};
              for (var g = 0; g < groups.length; g++) {
                for (var i = 0; i < groups[g].length; i++) {
                  var row = groups[g][i];
                  if (seen[row.url]) continue;
                  seen[row.url] = 1;
                  out.push({
                    name: "CastSinema • Xpass",
                    title: "Xpass • " + row.label,
                    url: row.url,
                    quality: "auto",
                    provider: "castsinema-xpass",
                    format: row.hls ? "m3u8" : "mp4",
                    headers: { "User-Agent": UA, Referer: XPASS + "/" },
                    behaviorHints: { notWebReady: true, proxyHeaders: { request: { "User-Agent": UA, Referer: XPASS + "/" } } }
                  });
                }
              }
              return out;
            });
          });
      });
    })
    .catch(function (e) {
      console.error("[CastSinema Xpass] " + (e && e.message ? e.message : String(e)));
      return [];
    });
}

module.exports = { getStreams: getStreams };
