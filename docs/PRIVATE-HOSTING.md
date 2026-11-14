# Gizli kurulum (opsiyonel)

Bu depoda addon varsayılan olarak **public** GitHub'dan yayınlanır: manifest ve
provider dosyaları anonim `raw.githubusercontent.com` URL'lerinden çekilir.
Repoyu **private** yaparsanız o URL'ler **404** döner ve addon çalışmaz.

Bu kılavuzdaki kurulum ile depo **private** kalabilir; addon yine de çalışır —
yalnızca bilinenlere açık, anonim HTTP ile dağıtılır.

> **Önemli dürüstlük notu:** Addon dosyalarını anonim HTTP ile çektiği için
> gerçek bir şifre/oturum **kullanılamaz.** Bu kurulumda
> gizlilik = **tahmin edilemez bir yol segmenti** (secret path). URL'yi bilen
> herkes dosyaları okuyabilir; URL'yi bilmeyen kimse tahmin edemez.

---

## 1. Mimari

```text
Private GitHub repo  --(push)-->  GitHub Actions  -->  Cloudflare KV (addon dosyaları)
                                                              |
CastSinema uygulamasi  -- anonim HTTPS -->  Cloudflare Worker (secret path)  -->  KV
```

- Repo **private** — kaynak kod, issue'lar ve geçmiş gizli kalır.
- Actions, her push'ta addon dosyalarını (manifest + providers + logo) KV'ye yükler.
- Worker yalnızca `https://<worker>/<GİZLİ_YOL>/...` yolunu sunar; diğer her şey 404.
- `/assets/logo.png` herkese açıktır (picker logosu — içerik zaten açık kaynaklı marka öğesi).

## 2. Kurulum adımları

### Adım 1 — Cloudflare

1. https://dash.cloudflare.com → ücretsiz hesap açın.
2. **Workers & Pages → KV** → yeni namespace: `castsinema-addons`.
   Namespace ID'yi not edin (Worker ve Actions'ta kullanılacak).
3. **My Profile → API Tokens → Create Token → Create Custom Token**:
   - Permission: `Account → Workers KV Storage → Edit`
   - Account Resources: kendi hesabınız
   Token'ı güvenli bir yere kaydedin.

### Adım 2 — Worker'ı dağıtın

Seçenekler:

**A) Wrangler (önerilen)**
```bash
npm install -g wrangler
cd worker
wrangler login
wrangler deploy          # worker.js'i + KV binding'i yükler
wrangler secret put SECRET_PATH
```
`wrangler.toml` içindeki `BURAYA_KV_NAMESPACE_ID_YAZIN`'ı kendi namespace ID'nizle
değiştirin. `SECRET_PATH` için uzun rastgele bir değer kullanın:
```bash
openssl rand -hex 32
```

**B) Dashboard (kod yok)**
1. Workers & Pages → Create → Worker → `worker.js` içeriğini yapıştırın.
2. Worker → Settings → **Variables and Secrets**:
   - `ADDON_FILES` — KV namespace binding (binding olarak KV namespace'i bağlayın)
   - `SECRET_PATH` — secret olarak ekleyin

### Adım 3 — GitHub'a secrets ekleyin

Repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Değer |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID (dashboard sağ üst köşede) |
| `CLOUDFLARE_KV_NAMESPACE_ID` | `castsinema-addons` namespace ID'niz |
| `CLOUDFLARE_API_TOKEN` | Adım 1'deki Workers KV Storage token'ı |

`SECRET_PATH` repo secret'ı **değildir** — yalnızca Worker'ın içinde yaşar.

### Adım 4 — İlk senkronu çalıştırın

Actions → **Sync addon files** → Run workflow. Veya basitçe `main`'e küçük bir
commit push'layın — workflow otomatik çalışır ve KV'ye `manifest.json`,
`providers/*.js`, `assets/logo.png`'i yükler; repo'da olmayan eski anahtarları siler.

### Adım 5 — Logo URL'lerini güncelleyin

```bash
node scripts/set-worker.mjs https://<worker-adınız>.workers.dev
git add -A && git commit -m "chore: point logo at worker" && git push
```
(`set-worker.mjs` yalnızca logo URL'lerini değiştirir; `SECRET_PATH` repoya yazılmaz.)

### Adım 6 — CastSinema'ya ekleyin

Kurulum URL'niz:

```text
https://<worker-adınız>.workers.dev/<GİZLİ_YOL>/manifest.json
```

Örnek: `https://castsinema-addons.example.workers.dev/9f3a.../manifest.json`

### Adım 7 — Repoyu private yapın

```bash
gh repo edit --visibility private
```

veya repo → Settings → General → Danger Zone → **Change visibility** → Private.

Artık repo private; addon yine de çalışıyor — sadece doğru URL'yi bilen kullanır.

## 3. Güncelleme akışı

Provider değiştiğinde/push'ta:

1. `git push` → CI testleri koşar
2. **Sync addon files** workflow'u KV'yi günceller (yeni dosya eklenir, silinen silinir)
3. Yaklaşık 5 dakika içinde yeni içerik dağılır (KV cache TTL = 300 sn)
4. Uygulama bir sonraki açılışında yeni manifesti alır

Not: `domain-watch` workflow'u (6 saatte bir) private repoda da çalışır ama Actions
dakikanızı tüketir; isterseniz `.github/workflows/domain-watch.yml`'i silin veya
`on: workflow_dispatch`'e çevirin.

## 4. Sorun giderme

- **404** → `SECRET_PATH` yanlış (büyük/küçük harf, baştaki `/`, sondaki `/` dahil değil;
  URL `.../<GİZLİ_YOL>/manifest.json` olmalı) veya KV'ye hiç senkron girmemiş.
- **`SyntaxError: Unexpected token` / logo görünüyor ama manifest okunmuyor** →
  sync workflow'un loglarına bakın; `CF-KV` hatası varsa token izinlerini kontrol edin
  (`Workers KV Storage: Edit`).
- **Değişiklik görünmüyor** → KV TTL 300 sn; 5 dk bekleyin veya hard refresh.
- **Worker deploy sonrası binding yok** → `ADDON_FILES` binding'inin KV namespace'e
  bağlı olduğunu kontrol edin (dashboard → Worker → Settings → Bindings).

## 5. Güvenlik notları

- `SECRET_PATH` yalnızca sizde ve Worker'da yaşar — repoya/commit'e **girmez**.
- Logo herkese açıktır (`/assets/logo.png`); içeriği hassas değildir.
- Repo private olsa bile dosyalar anonim HTTP ile dağıtılır: URL'yi bilen herkes
  okuyabilir. "Gerçek şifre" istiyorsanız bu mimari yeterli değildir; o durumda
  Tailscale/ev sunucusu (ağ içi, yalnızca bizim cihazlara açık) gibi bir çözüm gerekir.
