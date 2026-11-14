// GitHub koordinatı yerine gizli-kurulum Worker adresini yazar.
//   node scripts/set-worker.mjs https://castsinema-addons.<hesap>.workers.dev
//
// manifest.json ve dokümanlardaki logo URL'lerini
//   https://<worker>/assets/logo.png
// olarak günceller. Gizli yol (SECRET_PATH) repoya hiç yazılmaz — o değeri
// kurulum URL'si olarak CastSinema'ya siz elle yazarsınız (bkz.
// docs/PRIVATE-HOSTING.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = String(process.argv[2] || '').replace(/\/+$/, '');

if (!/^https:\/\/[a-z0-9.-]+/i.test(base)) {
  console.error('Kullanım: node scripts/set-worker.mjs https://<worker>.workers.dev');
  process.exit(1);
}

const LOGO = `${base}/assets/logo.png`;
const OLD_LOGO = 'https://raw.githubusercontent.com/castiel430/CastSinema-Addons/main/assets/logo.png';

const targets = [
  'manifest.json',
  'README.md',
  'docs/ARCHITECTURE.md',
  'docs/SETUP.md',
  'docs/BRANDING.md',
  'docs/PRIVATE-HOSTING.md',
];

let changed = 0;
for (const rel of targets) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  let text = fs.readFileSync(file, 'utf8');
  const next = text.split(OLD_LOGO).join(LOGO);
  if (next !== text) {
    fs.writeFileSync(file, next);
    changed += 1;
    console.log(`  güncellendi: ${rel}`);
  }
}

console.log(`\n${changed} dosya güncellendi. Logo → ${LOGO}`);
console.log(`\nKurulum URL'niz (CastSinema'ya elle yazın):`);
console.log(`  ${base}/<GİZLİ_YOL>/manifest.json`);
console.log(`\n<GİZLİ_YOL> = worker'a verdiğiniz SECRET_PATH değeridir. Bunu kimseyle paylaşmayın.`);
