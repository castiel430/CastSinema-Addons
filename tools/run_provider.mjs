// Loads a CastSinema provider and runs getStreams() against the real site.
//
// Every network call is routed through the local TLS-impersonating proxy
// (tools/tls_proxy.py) because Node's own TLS fingerprint is rejected by
// Cloudflare on several of these hosts.
//
// Usage: node tools/run_provider.mjs <provider-file> <proxy-port> <tmdbId> <type> [season] [episode]

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const [file, proxyPort, tmdbId, type, season, episode] = process.argv.slice(2);

if (!file || !proxyPort || !tmdbId || !type) {
  console.error('Usage: node tools/run_provider.mjs <provider-file> <proxy-port> <tmdbId> <type> [season] [episode]');
  process.exit(2);
}

const code = fs.readFileSync(path.resolve(file), 'utf8');
const proxyBase = `http://127.0.0.1:${proxyPort}/fetch`;

function decodeBody(encoded) {
  return Buffer.from(encoded || '', 'base64').toString('utf8');
}

// Replaces the global fetch with one that tunnels through the proxy.
async function proxyFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : String(input && input.url || input);
  const headers = {};
  const rawHeaders = (init && init.headers) || {};
  if (rawHeaders && typeof rawHeaders.forEach === 'function' && !Array.isArray(rawHeaders)) {
    rawHeaders.forEach((v, k) => { headers[k] = v; });
  } else if (rawHeaders && typeof rawHeaders === 'object') {
    for (const [k, v] of Object.entries(rawHeaders)) headers[k] = String(v);
  }
  let body = null;
  if (init && init.body != null) body = String(init.body);

  const response = await fetch(proxyBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      method: (init && init.method) || 'GET',
      headers,
      body,
      timeout: 25000,
    }),
  });

  const payload = await response.json();
  const status = payload.status || 0;
  const text = decodeBody(payload.body);

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: payload.error || '',
    url,
    headers: new Map(Object.entries(payload.headers || {})),
    text: async () => text,
    json: async () => { try { return JSON.parse(text); } catch (_) { return null; } },
    arrayBuffer: async () => Buffer.from(text, 'utf8').buffer,
  };
}

const module = { exports: {} };
const context = vm.createContext({
  module,
  exports: module.exports,
  fetch: proxyFetch,
  console,
  Promise,
  String,
  Array,
  Object,
  RegExp,
  Math,
  JSON,
  Date,
  URL,
  encodeURIComponent,
  decodeURIComponent,
  setTimeout,
  clearTimeout,
  Buffer,
  atob: (s) => Buffer.from(s, 'base64').toString('utf8'),
  btoa: (s) => Buffer.from(s, 'utf8').toString('base64'),
  require: (name) => {
    if (name === 'crypto') return require('node:crypto');
    throw new Error(`Cannot require ${name}`);
  },
});

const logs = [];
context.console = {
  log: (...a) => logs.push(a.map(x => String(x)).join(' ')),
  error: (...a) => logs.push(a.map(x => String(x)).join(' ')),
  warn: (...a) => logs.push(a.map(x => String(x)).join(' ')),
};

try {
  new vm.Script(code, { filename: file }).runInContext(context);
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: `load failed: ${error.message}`, logs }));
  process.exit(1);
}

const getStreams = module.exports && module.exports.getStreams;
if (typeof getStreams !== 'function') {
  console.log(JSON.stringify({ ok: false, error: 'provider does not export getStreams', logs }));
  process.exit(1);
}

const timeoutMs = 60000;
let timer;
try {
  const streams = await Promise.race([
    getStreams(tmdbId, type, season != null ? Number(season) : null, episode != null ? Number(episode) : null),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('provider timed out')), timeoutMs); }),
  ]);
  console.log(JSON.stringify({
    ok: true,
    count: Array.isArray(streams) ? streams.length : -1,
    streams: (Array.isArray(streams) ? streams : []).map(s => ({
      url: s.url,
      format: s.format,
      quality: s.quality,
      provider: s.provider,
      title: s.title,
    })),
    logs: logs.slice(0, 5),
  }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error && error.message || error), logs: logs.slice(0, 5) }));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
