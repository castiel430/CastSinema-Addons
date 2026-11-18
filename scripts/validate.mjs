import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const BRAND = 'CastSinema';
const BRAND_ID_PREFIX = 'castsinema-';
const PROVIDERS_DIR = 'providers';

const googleApiKey = /AIza[0-9A-Za-z_-]{35}/;
const placeholder = /<KULLANICI>|<DEPO>|<MARKA>/;

function fail(message) {
  throw new Error(message);
}

// ---------------------------------------------------------------------------
// 1. No committed Google API keys anywhere in the repository.
// ---------------------------------------------------------------------------
async function assertNoCommittedGoogleKeys(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await assertNoCommittedGoogleKeys(full);
      continue;
    }
    if (!entry.isFile()) continue;
    let text;
    try {
      text = await fs.readFile(full, 'utf8');
    } catch {
      continue;
    }
    if (googleApiKey.test(text)) {
      fail(`Refusing committed Google API key in ${path.relative(repoRoot, full)}`);
    }
  }
}
await assertNoCommittedGoogleKeys(repoRoot);

// ---------------------------------------------------------------------------
// 2. Manifest schema.
// ---------------------------------------------------------------------------
const manifestPath = new URL('../manifest.json', import.meta.url);
const manifestRaw = await fs.readFile(manifestPath, 'utf8');

if (placeholder.test(manifestRaw)) {
  fail(
    'manifest.json still contains a <KULLANICI>/<DEPO>/<MARKA> placeholder.\n' +
    '  Fix it with:  node scripts/set-repo.mjs <github-user> <repo-name>'
  );
}

const manifest = JSON.parse(manifestRaw);
const scrapers = Array.isArray(manifest) ? manifest : manifest?.scrapers;
if (!Array.isArray(scrapers) || scrapers.length === 0) fail('manifest.json has no scrapers');

const seenIds = new Set();
for (const entry of scrapers) {
  if (!entry.id || !entry.filename) fail('Invalid manifest scraper entry');
  if (!entry.name) fail(`Manifest scraper ${entry.id} has no name`);
  if (seenIds.has(entry.id)) fail(`Duplicate manifest scraper id: ${entry.id}`);
  seenIds.add(entry.id);
}

// ---------------------------------------------------------------------------
// 3. Every referenced provider exists and passes a syntax check.
// ---------------------------------------------------------------------------
const referenced = new Set();
for (const entry of scrapers) {
  const fileUrl = new URL(`../${entry.filename}`, import.meta.url);
  try {
    await fs.access(fileUrl);
  } catch {
    fail(`Manifest scraper ${entry.id} references a missing file: ${entry.filename}`);
  }
  referenced.add(path.basename(entry.filename));

  const result = spawnSync(process.execPath, ['--check', fileURLToPath(fileUrl)], { encoding: 'utf8' });
  if (result.status !== 0) fail(result.stderr || `Syntax check failed: ${entry.filename}`);
}

// ---------------------------------------------------------------------------
// 4. No orphaned provider files.
// ---------------------------------------------------------------------------
const providersDir = new URL(`../${PROVIDERS_DIR}/`, import.meta.url);
for (const file of await fs.readdir(providersDir)) {
  if (!file.endsWith('.js')) continue;
  if (!referenced.has(file)) {
    fail(`Provider ${PROVIDERS_DIR}/${file} is not referenced by manifest.json. Add a scraper entry or delete the file.`);
  }
}

// ---------------------------------------------------------------------------
// 5. Brand consistency: manifest id vs the provider id inside the JS, the
//    stream display name prefix, and no stale upstream brand strings.
// ---------------------------------------------------------------------------
for (const entry of scrapers) {
  const code = await fs.readFile(new URL(`../${entry.filename}`, import.meta.url), 'utf8');

  // The provider must emit the same id as the manifest, and that id has to
  // carry the brand prefix. This catches a leftover id from any earlier name.
  const providerIds = new Set([...code.matchAll(/provider\s*:\s*['"]([^'"]+)['"]/g)].map(m => m[1]));
  if (providerIds.size === 0) fail(`${entry.filename} does not declare a provider id`);
  for (const id of providerIds) {
    if (id !== entry.id) {
      fail(`${entry.filename} emits provider id "${id}" but manifest.json declares "${entry.id}".`);
    }
    if (!id.startsWith(BRAND_ID_PREFIX)) {
      fail(`${entry.filename} emits provider id "${id}" which does not start with "${BRAND_ID_PREFIX}".`);
    }
  }

  // The stream display name must use the current brand as prefix.
  const names = [...code.matchAll(/name\s*:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  for (const name of names) {
    if (name.includes('•') && !name.startsWith(`${BRAND} •`)) {
      fail(`${entry.filename} emits stream name "${name}" which does not start with "${BRAND} •".`);
    }
  }

  // The manifest id itself has to be branded as well.
  if (!entry.id.startsWith(BRAND_ID_PREFIX)) {
    fail(`manifest scraper "${entry.id}" does not start with "${BRAND_ID_PREFIX}".`);
  }
}

// ---------------------------------------------------------------------------
// 6. Optional runtime check: the addon exposes a loadable getStreams export.
// ---------------------------------------------------------------------------
for (const entry of scrapers) {
  const code = await fs.readFile(new URL(`../${entry.filename}`, import.meta.url), 'utf8');
  if (!/getStreams/.test(code)) fail(`${entry.filename} does not define getStreams`);
}

// ---------------------------------------------------------------------------
console.log(
  `Validated ${scrapers.length} ${BRAND} scraper(s), ${referenced.size} provider file(s); ` +
  `manifest id "${manifest.id}", ${scrapers.filter(s => s.enabled !== false).length} enabled.`
);
