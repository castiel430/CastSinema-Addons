// Patches every repository URL in the repo with your own GitHub coordinates.
//
//   node scripts/set-repo.mjs <github-user> <repo-name>
//
// It rewrites the logo URLs in manifest.json and the install URLs in
// README.md / docs/*.md, then re-runs validation.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const [user, repo] = process.argv.slice(2);
if (!user || !repo) {
  console.error('Usage: node scripts/set-repo.mjs <github-user> <repo-name>');
  console.error('Example: node scripts/set-repo.mjs myuser castsinema-addons');
  process.exit(1);
}

if (!/^[A-Za-z0-9._-]+$/.test(user) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
  console.error('Invalid user or repo name. Use only letters, digits, dot, dash and underscore.');
  process.exit(1);
}

const base = `https://raw.githubusercontent.com/${user}/${repo}/main`;
const targets = ['manifest.json', 'README.md', 'docs/ARCHITECTURE.md', 'docs/BRANDING.md', 'docs/SETUP.md'];
let changed = 0;

// Match any raw.githubusercontent owner/repo pair so the command stays
// idempotent: running it twice must still update the casing or the owner.
const rawUrl = /https:\/\/raw\.githubusercontent\.com\/[^\s"'`)\]]+\/[^\s"'`)\]]+\/main/g;
// Match the bare placeholder form used in prose and code samples.
const placeholderPath = /<\/?(?:KULLANICI|DEPO|MARKA|user|repo)>[^\s"'`)\]]*\/[^\s"'`)\]]*<\/?(?:KULLANICI|DEPO|MARKA|user|repo)>/g;

for (const relative of targets) {
  const full = path.join(repoRoot, relative);
  let text;
  try {
    text = await fs.readFile(full, 'utf8');
  } catch {
    continue;
  }
  const before = text;
  text = text.replace(rawUrl, base);
  text = text.replace(placeholderPath, `${user}/${repo}`);
  text = text.replaceAll('<KULLANICI>/<DEPO>', `${user}/${repo}`);
  if (text !== before) {
    await fs.writeFile(full, text, 'utf8');
    changed += 1;
    console.log(`patched ${relative}`);
  }
}

console.log(changed ? `\nRepository coordinates set to ${user}/${repo}.` : 'Nothing to patch.');
console.log('Run "npm test" to verify.');
