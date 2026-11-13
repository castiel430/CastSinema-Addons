# Mimari

CastSinema deposunun teknik incelemesi. Provider sözleşmesi, akış şekilleri ve
bakım noktaları.

İçindekiler:

1. [Genel bakış](#1-genel-bakış)
2. [Provider sözleşmesi](#2-provider-sözleşmesi)
3. [Stream nesnesi](#3-stream-nesnesi)
4. [Manifest şeması](#4-manifest-şeması)
5. [Provider türleri](#5-provider-türleri)
6. [Hermes uyumluluğu](#6-hermes-uyumluluğu)
7. [TMDB entegrasyonu](#7-tmdb-entegrasyonu)
8. [Doğrulama ve test](#8-doğrulama-ve-test)
9. [Bilinen sorunlar](#9-bilinen-sorunlar)
10. [Bakım rehberi](#10-bakım-rehberi)

---

## 1. Genel bakış

Bu depo **tek ürün** içerir: Türkçe dizi/film siteleri için CastSinema scraper'ları.

```text
                 ┌──────────────────────────────────────┐
                 │  manifest.json  (12 scraper tanımı) │
                 │      │                               │
                 │      ▼                               │
                 │  providers/castsinema-*.js  (12 dosya)   │
                 │      │                               │
                 └──────┼───────────────────────────────┘
                        │  CastSinema/Stremio uygulaması indirir
                        ▼
        ┌───────────────────────────────────────────────┐
        │  Hermes (istemci JS motoru)                   │
        │   getStreams(tmdbId, type, season, episode)   │
        │        │                                      │
        │        ├─► TMDB (başlık/arama)                │
        │        └─► dizi/film sitesi (HTML/JS kazıma)  │
        │                  │                             │
        │                  ▼                             │
        │            .m3u8 / .mp4 stream URL            │
        └───────────────────────────────────────────────┘
```

**Sunucu yoktur.** Tüm sağlama istemci tarafında olur. Bu, deploy'un
`git push`'tan ibaret olması demektir.

Repo iki yönlü bir geri besleme döngüsü içerir:

1. `manifest.json` → provider dosyalarının hangi siteyi hangi id ile
   çalıştıracağını söyler
2. Provider dosyasının içindeki `provider: "castsinema-…"` alanı → manifest id'siyle
   eşleşmelidir

Bu eşleşme `scripts/validate.mjs` tarafından zorunlu kılınır.

---

## 2. Provider sözleşmesi

Her provider dosyası bir **CommonJS modülüdür** ve tek zorunlu export'u vardır:

```js
function getStreams(tmdbId, mediaType, season, episode) { /* -> Promise<Stream[]> */ }
module.exports = { getStreams: getStreams };
```

| Parametre | Tip | Açıklama |
|---|---|---|
| `tmdbId` | string | TMDB sayısal kimliği (`"1399"`) |
| `mediaType` | `"movie"` \| `"tv"` \| `"anime"` | CastSinema `tv`/`series`/`show` → `series` olarak normalize eder |
| `season` | number \| null | filmlerde `null` |
| `episode` | number \| null | filmlerde `null` |

İsteğe bağlı ikinci export: `onSettings()` → `Promise<SettingsField[]>`.
Yalnızca `providers/castsinema-dizibox.js` bu export'u verir.

Bazı provider'lar üçlü export kullanır (Node + CommonJS + global geri dönüşü):

```js
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof exports !== "undefined") exports.getStreams = getStreams;
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
```

> **Dikkat:** `globalThis.getStreams` ataması global namespace'i değiştirir. Aynı
> JS context'ine iki provider yüklenirse çakışma olabilir.

### 2.1 Settings alan tipleri

```js
function onSettings() {
  return Promise.resolve([
    { type: 'header', label: 'DiziBOX TV' },
    { type: 'text', key: 'siteUrl', label: 'Website address', defaultValue: DEFAULT_SITE,
      description: 'Update this HTTPS origin if the website moves.' },
    { type: 'text', key: 'tmdbApiKey', label: 'TMDB API key (optional)', isPassword: true,
      defaultValue: '', description: 'Uses CastSinema\'s key when available.' }
  ]);
}
```

Desteklenen tipler: `header`, `info`, `text` (`isPassword`), `toggle`, `select`.
Değerler `globalThis.SCRAPER_SETTINGS` içinde `key` ile saklanır.

---

## 3. Stream nesnesi

```js
{
  name:      "CastSinema • FilmModu",          // manifest `name` ile aynı olmalı
  title:     "FilmModu • Fight Club • HLS 1080p",
  url:       "https://cdn.example/x.m3u8", // mutlak URL
  quality:   1080,                        // 1080 | 2160 | 'Auto'
  provider:  "castsinema-filmmodu",            // manifest `id` ile aynı olmalı
  format:    "m3u8",                      // "m3u8" | "video"
  headers:   { "User-Agent": UA, "Referer": "https://site/" },
  subtitles: [ { id, url, language, name, headers } ]   // opsiyonel
}
```

**`format` yalnızca iki değer alır:**

| Değer | Anlamı |
|---|---|
| `"m3u8"` | HLS playlist — native/HLS destekli oynatıcı |
| `"video"` | Doğrudan `.mp4` **veya** gömülü bir web sayfası |

> `"mp4"` hiçbir zaman üretilmez. Manifest'te `formats: ["m3u8","mp4"]` yazması
> bir *yetenek beyanıdır*; runtime değeri değildir.

**`headers` kritiktir.** Birçok CDN, doğru `Referer` ve `User-Agent` olmadan
403 döner. `Referer` her zaman **medya sunucusuna** ait olmalıdır — embed
sayfası durumunda embed sayfasının kendi host'u:

```js
headers: { "User-Agent": UA, "Referer": embedUrl }   // filmmodu
headers: { "User-Agent": UA, "Referer": HOST + "/" }  // clipbox
```

**`quality`** çoğunlukla `1080`, 4K varsa `2160`, dizibox'ta `"Auto"`.

---

## 4. Manifest şeması

CastSinema'nun `scrapers[]` dizisini kullanır (Stremio'nun `resources`/`types`/
`catalogs` şemasından farklıdır):

```jsonc
{
  "id": "castsinema",
  "name": "CastSinema",
  "version": "1.0.0",
  "scrapers": [
    {
      "id": "castsinema-dizibox",           // benzersiz; picker kimliği
      "name": "CastSinema • DiziBox",       // picker etiketi + stream `name` öneki
      "description": "DiziBox yerel HTML/JS dizi sağlayıcısı.",
      "version": "1.0.0",
      "author": "CastSinema",
      "supportedTypes": ["tv"],        // ⚠️ runtime davranışını etkileyen TEK alan
      "filename": "providers/castsinema-dizibox.js",  // manifest'e göreli JS yolu
      "enabled": true,                 // false → picker'da "No disponible"
      "hasSettings": true,             // true → onSettings() formu çizilir
      "logo": "https://raw.githubusercontent.com/castiel430/CastSinema-Addons/main/assets/logo.png",
      "contentLanguage": ["tr"],       // picker dil filtresi
      "formats": ["m3u8", "mp4"],      // yetenek beyanı
      "limited": false,
      "disabledPlatforms": [],         // ör. ["android"]
      "supportsExternalPlayer": true   // harici oynatıcıya URL vermesine izin ver
    }
  ]
}
```

### 4.1 Alanların gerçek etkisi

| Alan | Etkisi |
|---|---|
| `supportedTypes` | **Tek runtime etkisi olan alan.** CastSinema yalnızca listelenen türlerde scraper'ı çağırır. `dizibox` `["tv"]` der ve kodda da `if (['tv','series','show'].indexOf(mediaType) === -1) return [];` kontrolü yapar. |
| `filename` | Manifest↔kod sözleşmesi. Dosya yoksa `validate` hata verir. |
| `hasSettings` | `true` ise uygulama `onSettings()` formunu çizer. `false` ise form çizilmez. |
| `enabled` | `false` → picker'da gösterilmez. |
| `contentLanguage` | Picker'da dil filtresi. |
| `formats` | UI filtreleme (beyan). |
| `disabledPlatforms` | Platform bazlı gizleme. |
| `supportsExternalPlayer` | Harici oynatıcıya URL verilmesine izin verir. |
| `id`, `name`, `description`, `version`, `author`, `logo` | Yalnızca gösterim. |

> **Önemli:** Provider kodu manifesti **hiçbir zaman okumaz**. Tüm
> yapılandırma JS içinde sabittir (`var HOST = "https://bingebang.cc";`).
> Manifest'i okuyan tek şey `validate.mjs` ve testlerdir.

---

## 5. Provider türleri

### Tip A — Doğrudan HTML/JS kazıma

Zincir tipik olarak:
`TMDB → arama sayfası → detay sayfası → iframe → oynatıcı sayfası → media URL`

| Provider | Akış |
|---|---|
| `castsinema-filmmodu.js` | POST `filmmodu.cc/arama/` → `var ilkpartkod = '<base64>'` → base64 iframe → `bePlayer('hash','{json}')` → **AES-256-CBC / EVP-KDF** çöz → `video_location` |
| `castsinema-dizimom.js` | `ddizimom.net/ara?q=` → `data-pv="slug"` → `play2.pilavyerplay.top/assets/js/s.php?s=slug` → `window.__PLAYER__` → `.stream` |
| `castsinema-setfilmizle.js` | `?s=` arama → `nonces: { video: "…" }` → POST `wp-admin/admin-ajax.php` → `{success, data:{stream:{url, provider}}}` |
| `castsinema-filmmakinesi.js` | `?s=` → `<a class="mini-poster">` → detay → `<iframe src>` |
| `castsinema-hdfilmcehennemi.js` | `/search/?q=` → JSON içinde gömülü HTML → detay → `<iframe src>` |
| `castsinema-dizibox.js` | Dizin listesi → fuzzy sıralama → sezon → bölüm → `#video-area` iframe → `jwplayer().setup({…})` → `file:` |

### Tip B — JSON API

| Provider | Akış |
|---|---|
| `castsinema-hexa.js` | `theemoviedb.hexa.su/api/tmdb/…/images` → şifreli metin → `enc-dec.app/api/dec-hexa` |
| `castsinema-vidup.js` | `vidup.to/…` → `enc-dec.app` iki aşamalı token → sunucu JSON'u |
| `castsinema-clipbox.js` | `vixsrc.to/api/…` → JSON `{src}` → `src` sayfası regex ile kazınır (hibrit) |
| `castsinema-xpass.js` | `play.xpass.top/e/…` → HTML'den `var backups = [...]` → sunucu JSON `playlist[0].sources[]` |

### Tip C — Basit tek-regex kazıyıcı

`vidup`, `hexa` gibi provider'lar sayfada tek bir regex ile
`.m3u8`/`.mp4` arar. En kırılgan ama en kısa yazılan tip budur.

### 2.5 IMDb ile eşleştirme

Yeni eklenen üç site (`filmmakinesi`, `hdfilmcehennemi`,
`fullhdfilmizlesene`) **IMDb id ile arama** yapabiliyor. Provider akışı:

```text
TMDB id ──▶ /movie/{id}?append_to_response=external_ids ──▶ imdb_id
         └─▶ /tv/{id}?append_to_response=external_ids    ──▶ imdb_id
                                    │
                                    ▼
              site araması: tt0137523  →  (genelde) tek doğru sonuç
```

`append_to_response=external_ids` diziler için zorunludur; filmlerde
`imdb_id` alanı doğrudan gelir ama her ikisinde de external id okunur.

IMDb eşleşmesi başarısız olursa başlıkla arama denenir.

### 2.6 Kaynak gizleme teknikleri

`fullhdfilmizlesene` embed URL'lerini sayfadaki `scx` nesnesinde saklar:

```js
var scx = {"atom":{"tt":"QXRvbQ==","sx":{"p":[],"t":["nUE0pUZ6Yl9lLKO..."]},"order":1}};
```

Çözüm zinciri:

1. `tt` → düz `atob` → kaynak adı (`"Atom"`)
2. `sx.t[]` / `sx.p[]` → **ROT13**, sonra base64 → embed URL
3. `v2.` önekli değerler → ters çevrilir, base64url çözülür, sonra
   `hostname + "|fmx"` ile XOR maskelenir

`{` `}` parantez eşleştirmesi yapan `extractJsonObject` kullanılır; basit
`/\{.*?\}/` regex'i iç içe nesnelerde yanlış kesilir.

### 2.7 Fragman ayrımı

Bazı sayfalar oynatıcı yerine yalnızca **YouTube fragmanı** içerir (telif
nedeniyle kaldırılmış bölümlerde olduğu gibi). Provider'lar
`youtube.com`, `youtu.be`, `dailymotion.com`, `vimeo.com` adreslerini
stream olarak **kabul etmez**; aksi halde kullanıcı bölüm yerine fragman
izler.


---

## 6. Hermes uyumluluğu

CastSinema provider JS'i **Hermes** içinde çalıştırır. Kritik kısıtlar:

| Kısıt | Sonuç |
|---|---|
| `async/await` güvenilir değil | **Tüm** provider'lar yalnızca Promise zinciri kullanır; `async` anahtar kelimesi hiçbir yerde geçmez. |
| Sayfa JS'i çalıştırılamaz | Oynatıcı config'leri **statik** çözülür (`dizibox`'taki `literal()`, `unpackNumeric`). |
| Node modülleri sınırlı | `require("crypto-js")` CastSinema tarafından sağlanır; `dizibox` bunu kullanır. |
| Yan etkisiz `globalThis` | `globalThis.getStreams` ataması bazı provider'larda var — dikkat edin. |

### 6.1 Güvenlik yardımcıları (yalnızca `dizibox`)

```js
// SSRF koruması
if (!host || /(?:^|\.)localhost\.?$/i.test(host[1]) || /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host[1])) return '';

// Aynı-origin koruması
if (!url || !u.sameSite(url, base) || /%(?:2f|5c|00|0a|0d)/i.test(url)) return '';

// Cookie jar (oturum başına ayrı)
function session() { return { cookies: {} }; }

// Boyut sınırı
if (body.length > 1024 * 1024) throw failure('Response exceeds TV size limit: ' + site);

// CAPTCHA tespiti
if (/<title>\s*(?:Just a moment|Attention Required|Doğrulama gerekiyor)/i.test(body) || /cf-browser-verification|class=["']cf-turnstile/i.test(body))
  throw failure('Website CAPTCHA verification required: ' + site, true);
```

---

## 7. TMDB entegrasyonu

Doğru uygulama yalnızca `dizibox`'ta vardır — anahtar çözümleme zinciri:

1. `SCRAPER_SETTINGS.tmdbApiKey` (kullanıcı ayarları)
2. `globalThis.TMDB_API_KEY` (CastSinema'nun kendi anahtarı)
3. Gömülü yedek `4e44d9029b1270a757cddc766a1bcb63`

Anahtar tipi otomatik algılanır — 40 karakterden uzunsa **v4 Read Access Token**
(`Authorization: Bearer`), değilse **v3 API key** (`?api_key=`):

```js
var token = cfg.key.length > 40;
var url = 'https://api.themoviedb.org/3/tv/' + encodeURIComponent(id) + '?language=tr-TR';
if (!token) url += '&api_key=' + encodeURIComponent(cfg.key);
```

Kalan 5 provider (filmmodu, dizimom, setfilmizle, filmmakinesi, hdfilmcehennemi)
anahtarı doğrudan gömülü olarak kullanır.

### 7.1 Kimlik eşleme stratejileri

| Strateji | Kullanan provider'lar |
|---|---|
| **Doğrudan TMDB id geçişi** | clipbox, vidup, hexa, xpass |
| **TMDB → başlık/imdb_id → site araması → slug** | filmmodu, dizimom, setfilmizle, filmmakinesi, hdfilmcehennemi |
| **Dizin listesi + fuzzy sıralama** | dizibox |

Türkçe-duyarlı normalizasyon zorunludur (`ı/ğ/ü/ş/ö/ç`):

```js
function normalize(value) {
  return text(value)
    .replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
    .replace(/[çÇ]/g, 'c').replace(/[öÖ]/g, 'o').replace(/[üÜ]/g, 'u')
    .toLowerCase().replace(/\u0307/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
```

---

## 8. Doğrulama ve test

### 8.1 `scripts/validate.mjs` — 6 kontrol

1. **Commit edilmiş Google API anahtarı yok** (`AIza…35`) — tüm depo taranır
2. **Placeholder yok** — `manifest.json` içinde `<KULLANICI>` / `<DEPO>` / `<MARKA>`
   kalmışsa hata verir (yayınlama öncesi kalan iş)
3. **Manifest şeması** — `scrapers` dizisi dolu, her girdide `id`/`name`/`filename`
   var, `id` benzersiz
4. **Dosya varlığı + sözdizimi** — her `filename` diskte var ve `node --check`
   ile geçiyor
5. **Yetim provider yok** — `providers/` altındaki her `.js` manifest'te
   listelenmiş olmalı
6. **Marka tutarlılığı** — her provider'ın içindeki `provider:` id'si manifest
   `id`'siyle eşleşmeli; stream `name`'i `CastSinema • ` önekiyle başlamalı; eski
   marka kalıntısı olmamalı (telif/provenance satırları hariç)

### 8.2 Testler — 14 test

`tests/providers.test.mjs` içindeki 14 test, provider'ları **`node:vm`** içinde
**mock `fetch`** ile çalıştırır — gerçek internete hiç çıkmaz.

| Test | Kapsam |
|---|---|
| Manifest şeması | `manifest.name`, `scrapers` dizisi, `filename` eşleşmesi |
| ClipBox ×2 | Film rotası, TV sezon/bölüm rotası |
| Vidup ×2 | Decrypt akışı, TV TMDB rotası |
| Hexa | Cap-token decrypt akışı |
| Vidup, Hexa | HTTP decrypt akışı |
| FilmModu | Vidmixi oynatıcısından HLS çıkarma |
| DiziMom | Dizi için HLS çıkarma |
| SetFilmIzle | `admin-ajax` üzerinden oynatılabilir stream |
| FilmMakinesi | iframe stream çıkarma |
| DiziBox | Dizin araması + bölüm stream çıkarma |
| HDFilmCehennemi | Embed stream çıkarma |

> **Niyetli tasarım kararı:** Canlı kaynak sitelerin geçici kapanması veya
> rate-limit'i CI'yi gereksiz yere kırmasın diye canlı stream smoke testi
> yapılmaz. Tüm testler deterministiktir.

---

## 9. Bilinen sorunlar

### 9.1 ✅ Upstream `generate` hattı çöküyordu — **düzeltildi**

Bu depodaki önceki sürümde `npm run generate` **her zaman**
hata veriyordu: kaynak sayısı `14/27/41` bekleniyordu, registry'de 15 base
kaynak (`cifd2m`) + 27 Aslan = 42 vardı. Ayrıca 46 kanal sessizce düşüyordu
(`${OFFICIAL_LOGO}` ve mutlak URL biçimleri regex'e uymuyordu).

Bu repo tek ürüne indirgendiği için **upstream senkronizasyonu, generate
hattı, canlı yayın ve global ağaçlar tamamen kaldırıldı** — sorunlar da
böylece ortadan kalktı.

### 9.2 ✅ Upstream manifestinde ClipBox yoktu — **düzeltildi**

`providers/castsinema-clipbox.js` dosyası bu depoda mevcut ve testi geçiyordu,
ama kök `manifest.json` içinde **listelenmemişti** — yani hiçbir kullanıcıya
ulaşmıyordu. Bu depoya `castsinema-clipbox` olarak eklendi.

### 9.3 🟡 Üçüncü taraf çözümleme servisi (`enc-dec.app`)

5 provider bu tek servise bağlı:

| Endpoint | Kullananlar |
|---|---|
| `/enc-vidup`, `/dec-vidup` | vidup |
| `/enc-vidup`, `/dec-vidup` | vidup |
| `/enc-hexa`, `/dec-hexa` | hexa |
| `/enc-hexa`, `/dec-hexa` | hexa |

Servis çökerse 5 provider birlikte kırılır. Upstream'de bu adresler private
`ApiConstants.kt`'den tazeleniyordu; artık sabittir ve manuel güncellenmelidir.

### 9.4 🟡 Site adresleri sabit kodlu

Her provider kendi `HOST` değişkenini içinde taşır. Bu siteler sık sık domain
değiştirdiği için **bakımın en sık yapıldığı yer** budur:

```js
var HOST = "https://filmmodu.cc";
```

Yeni adresi bulduğunuzda ilgili provider dosyasındaki `HOST` sabitini güncelleyin.

### 9.5 🟡 `castsinema-clipbox.js` makine üretimi dosyadır

Bu dosya upstream'de private Kotlin kaynağından **üretilmiş** tek dosyadır
(bkz. [NOTICE](../NOTICE)). Önceki
üretici betik bu depoda **kaldırıldı**, çünkü
private upstream erişimi yok. Dosya sabit kaldı; artık elle bakım gerektirir.

### 9.6 🟡 `hasSettings` yalnızca dizibox'ta

Diğer 11 provider ayar arayüzü sunmaz — site adresi değişirse dosyayı elle
düzenlemeniz gerekir.

### 9.7 🟡 `format: "video"` gömülü sayfalar

`filmmakinesi` ve `hdfilmcehennemi` doğrudan medya yerine **embed sayfası**
döndürür. Bunlar harici oynatıcıda açılmaz; CastSinema'nun webview'ı üzerinden
oynatılır.

### 9.8 🟡 `hdfilmcehennemi` bölüm sayfaları boş

Film sayfaları oynatıcıyı sunucu tarafında verir
(`<iframe data-src="https://hdfilmcehennemi.mobi/video/embed/…">`), ancak
**bölüm sayfaları `player-container` öğesini boş render ediyor**. Sitenin
oynatıcıyı `/video/<data-video>/` uç noktasından, JavaScript ile sonradan
çekmesi gerekiyor; ancak bölüm sayfasında `data-video` değeri bulunmuyor.

Sonuç: provider bölüm isteklerinde boş dizi döndürüyor (hata vermiyor).
Film desteği tam çalışıyor. Site bölüm oynatıcısını geri getirirse provider
`/video/<id>/` yolunu zaten deniyor.

### 9.9 🟡 `filmmakinesi` bölümleri siteye göre değişiyor

Bazı bölümler telif nedeniyle kaldırılmış durumda. Bu durumda sayfada yalnızca
YouTube fragmanı kalıyor ve provider bunu bilinçli olarak reddediyor —
kullanıcı fragmanı izlemek yerine boş sonuç alıyor.

### 9.10🟡 Cloudflare istemci engeli

`filmmakinesi.to` ve `fullhdfilmizlesene.now` Node/undici TLS parmak izini
engelliyor (403). Tarayıcı, Android ve native istemciler geçiyor. Provider'lar
istemcide çalıştığı için bu bir sorun değildir, ancak **sunucu tarafında
test edilemez** — doğrulama tarayıcı üzerinden yapılmalıdır.


---

## 10. Bakım rehberi

### Yeni provider eklemek

1. `providers/castsinema-<ad>.js` oluşturun, `getStreams` export'u verin
2. `manifest.json`'a karşılık gelen scraper girdisini ekleyin
   (`id`, `name`, `filename`, `provider` eşleşmesi şart)
3. `npm test` — yetim dosya ve marka tutarlılığı kontrolleri sizi yakalar

### Bir provider çalışmıyorsa

1. `HOST` sabitini güncelleyin (site domain değiştirmiş olabilir)
2. `enc-dec.app` veya `sub.vyper.top` çalışıyor mu kontrol edin
3. Provider'ın `console.error` çıktısını CastSinema loglarında arayın
4. Site yapısı değişmiş olabilir — regex'i güncelleyin

### Provider kodu değiştirirken

- `async/await` **kullanmayın** — Promise zinciri kullanın
- `getStreams` her zaman `Promise<Stream[]>` dönmeli, hata halinde `[]`
- `provider` alanı manifest `id`'siyle **birebir** aynı olmalı
- `name` alanı `CastSinema • ` önekiyle başlamalı
- `headers` içinde doğru `Referer` olmalı (medya host'u)
