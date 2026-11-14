// Private repo → Cloudflare KV senkronu.
// Push'ta (veya elle) çalışır: manifest.json + providers/*.js + assets/logo.png
// KV namespace'e yüklenir, listede olmayan eski anahtarlar silinir.
//
// Gerekli ortam değişkenleri (GitHub repo secrets olarak tanımlanır):
//   CLOUDFLARE_ACCOUNT_ID   — Cloudflare Account ID
//   CLOUDFLARE_KV_NAMESPACE_ID — KV namespace ID (örn. "abc123...")
//   CLOUDFLARE_API_TOKEN    — "Workers KV Storage: Edit" izni olan token

import fs from 'node:fs';
import path from 'node:path';

const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID, CLOUDFLARE_API_TOKEN } = process.env;

if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_KV_NAMESPACE_ID || !CLOUDFLARE_API_TOKEN) {
  console.error('Eksik ortam değişkeni: CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_KV_NAMESPACE_ID / CLOUDFLARE_API_TOKEN');
  process.exit(1);
}

const API = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_KV_NAMESPACE_ID}`;
const HEADERS = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };

const TYPES = [
  ['.json', 'application/json'],
  ['.js', 'application/javascript'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.vtt', 'text/vtt'],
];

function contentType(key) {
  for (const [ext, type] of TYPES) {
    if (key.toLowerCase().endsWith(ext)) return type;
  }
  return 'application/octet-stream';
}

function collectFiles() {
  const files = new Map();
  files.set('manifest.json', 'manifest.json');
  for (const name of fs.readdirSync('providers')) {
    if (name.endsWith('.js')) files.set(`providers/${name}`, `providers/${name}`);
  }
  if (fs.existsSync(path.join('assets', 'logo.png'))) {
    files.set('assets/logo.png', 'assets/logo.png');
  }
  return files;
}

async function putKey(key, filePath) {
  const body = new Uint8Array(fs.readFileSync(filePath));
  const url = `${API}/values/${encodeURIComponent(key)}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(url, {
      method: 'PUT',
      headers: { ...HEADERS, 'Content-Type': contentType(key) },
      body,
    });
    const text = await r.text();
    if (r.ok) return;
    console.error(`  YÜKLEME HATASI ${key} (deneme ${attempt}/3): HTTP ${r.status} ${text.slice(0, 300)}`);
    if (attempt === 3) throw new Error(`PUT failed for ${key}`);
  }
}

async function listKeys() {
  const names = [];
  let page = 1;
  while (true) {
    const r = await fetch(`${API}/keys?page=${page}&per_page=1000`, { headers: HEADERS });
    const data = await r.json();
    if (!r.ok || !data.success) {
      throw new Error(`KV listesi alınamadı: HTTP ${r.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
    for (const k of data.result || []) names.push(k.name);
    const info = data.result_info || {};
    if (!data.result || data.result.length < (info.per_page || 1000)) break;
    page += 1;
  }
  return names;
}

async function deleteKey(key) {
  const r = await fetch(`${API}/values/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  if (!r.ok) {
    const text = await r.text();
    console.error(`  SİLME HATASI ${key}: HTTP ${r.status} ${text.slice(0, 200)}`);
    return false;
  }
  return true;
}

const files = collectFiles();
const expected = new Set(files.keys());
let uploaded = 0;
for (const [key, filePath] of files) {
  await putKey(key, filePath);
  uploaded += 1;
}
console.log(`Yüklendi: ${uploaded} dosya`);

const current = await listKeys();
const stale = current.filter((name) => !expected.has(name));
let deleted = 0;
for (const key of stale) {
  if (await deleteKey(key)) deleted += 1;
}
console.log(`Toplam anahtar: ${current.length}; silinen (güncel seti dışı): ${deleted}`);
console.log('Senkron tamamlandı.');
