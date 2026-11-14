# Kurulum ve dağıtım

## 1. Gereksinimler

- **Node.js 22+** (yalnızca test/doğrulama için — deploy için gerekmez)
- **Git**
- Bağımlılık yoktur

```bash
npm install
npm test
```

## 2. Depoyu GitHub'a taşıma

### 2.1 Yeni repo oluşturma

```bash
gh repo create castiel430/castsinema-addons --public
cd CastSinema-Addons
git remote add origin git@github.com:castiel430/castsinema-addons.git
git push -u origin main
```

### 2.2 Koordinatları ayarlama

```bash
node scripts/set-repo.mjs castiel430/castsinema-addons
```

Bu, `manifest.json` içindeki logo URL'lerini ve dokümanlardaki kurulum
adreslerini günceller.

```bash
npm test    # placeholder kalmadığını doğrular
git add -A && git commit -m "chore: set repository coordinates" && git push
```

### 2.3 GitHub Actions

`.github/workflows/ci.yml` her push'ta `validate` + test çalıştırır. Depoyu
fork'larsanız kendi CI'nız otomatik çalışır; **secret veya başka ayar
gerekmez**.

Repo ayarlarında Actions için "Read and write permissions" gerekmez —
CI sadece okur.

---

## 3. Kurulum adresleri

```text
https://raw.githubusercontent.com/castiel430/CastSinema-Addons/main/manifest.json
```

### CastSinema / Stremio'ya ekleme

- **Stremio:** Addons → Advanced → Install from URL → yukarıdaki URL
- **CastSinema:** Addon yöneticisinde "Scraper deposu ekle" → aynı URL

### Doğrulama

```bash
curl -s https://raw.githubusercontent.com/castiel430/CastSinema-Addons/main/manifest.json | head -20
```

Kontrol edilecekler:

- `"id": "castsinema"` ve `"name": "CastSinema"`
- 36 scraper girdisi
- Her `filename` için `https://raw.githubusercontent.com/castiel430/CastSinema-Addons/main/<filename>`
  adresi **200** dönmeli

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  https://raw.githubusercontent.com/castiel430/CastSinema-Addons/main/providers/castsinema-dizibox.js
```

---

## 4. Yayınlama akışı

Bu depoda **derleme adımı yoktur.** Provider dosyaları doğrudan GitHub'dan
sunulur. Yayınlama = `git push`.

```text
git add -A
git commit -m "..."
git push
```

Raw URL'ler GitHub'ın CDN'inde birkaç saniye içinde yenilenir. Yeni bir
provider eklediyseniz `manifest.json`'ı da aynı commit'te güncelleyin.

> **Not:** `manifest.json` değiştiğinde CastSinema/Stremio istemcisi yeni sürümü
> ancak bir sonraki açılışta veya manuel yenileme ile alır.

---

## 5. Bakım

### Site adresi değişti

İlgili provider dosyasındaki `HOST` sabitini güncelleyin:

```js
var HOST = "https://filmmodu.cc";
```

Ardından:

```bash
npm test
git commit -am "fix: update FilmModu host" && git push
```

### Yeni provider ekleme

1. `providers/castsinema-<ad>.js` oluşturun (`getStreams` export'u ile)
2. `manifest.json`'a scraper girdisi ekleyin — `id` ve `provider` eşleşmeli
3. `tools/providers.json`'a test konfigürasyonu ekleyin
4. `npm test`

Ayrıntı → [`ARCHITECTURE.md §10`](ARCHITECTURE.md#10-bakım-rehberi)

### Test ekleme

`tests/providers.test.mjs` içindeki `loadProvider()` yardımcısı provider'ı
`node:vm` içinde mock `fetch` ile çalıştırır:

```js
const provider = await loadProvider('providers/castsinema-xxx.js', async (url) => response({
  json: { /* ... */ }
}));
const streams = await provider.getStreams('1399', 'movie', null, null);
assert.equal(streams[0].provider, 'castsinema-xxx');
```

---

## 6. Sorun giderme

### `npm test` → "manifest.json still contains a castiel430/castsinema-addons placeholder"

```bash
node scripts/set-repo.mjs castiel430/castsinema-addons
```

### `npm test` → "Provider X is not referenced by manifest.json"

`providers/` altına dosya eklediyseniz `manifest.json`'a scraper girdisi
ekleyin veya dosyayı silin.

### `npm test` → "emits provider id ... but manifest.json declares ..."

Provider dosyasındaki `provider: "..."` değerini manifest `id`'siyle aynı yapın.

### `npm test` → "emits stream name ... which does not start with "CastSinema • ""

Stream `name` alanını `CastSinema • <Kaynak>` biçiminde yazın.

### Provider hiç stream döndürmüyor

1. Site adresi değişmiş olabilir — `HOST` sabitini kontrol edin
2. Site yapısı değişmiş olabilir — regex'i güncelleyin
3. CastSinema loglarında provider'ın `console.error` çıktısını arayın
4. Site CAPTCHA'ya geçiş olabilir — `dizibox` bunu tespit edip hata verir
5. Cloudflare WAF engeli olabilir (webteizle, dizipal, selcukflix) — tarayıcıdan doğrulayın

### Logo görünmüyor

`assets/logo.png` dosyası `main` branch'inde var mı ve `manifest.json`'daki
`logo` URL'si doğru mu?

### "No disponible" görünüyor

`enabled: false` yapılmış bir scraper'ı seçiyorsunuz demektir.

### Provider listede var ama tıklanınca hata veriyor

`supportedTypes` alanını kontrol edin — içerik türü listede yoksa provider
çağrılmaz.