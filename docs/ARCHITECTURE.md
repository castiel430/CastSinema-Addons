# Mimari

CastSinema deposunun teknik incelemesi. Provider sözleşmesi, akış öğeleri ve
bakım noktaları.

---

## 1. Genel bakış

Bu depo **tek ürün** içerir: Türkçe dizi/film siteleri için CastSinema scraper'ları.

```text
                 ┌──────────────────────────────────────────────────┐
                 │  manifest.json  (33 scraper tanımı)              │
                 │      │                                           │
                 │      └── providers/castsinema-*.js  (33 dosya)   │
                 └──────────────────────────────────────────────────┘
                        │  CastSinema/Stremio uygulaması indirir
                        ▼
        ┌────────────────────────────────────────────────────────────┐
        │  Hermes (istemci JS motoru)                            │
        │   getStreams(tmdbId, type, season, episode)            │
        │        │                                                │
        │        ├── TMDB (başlık/arama)                         │
        │        └── dizi/film sitesi (HTML/JS kazıma)           │
        │                  │                                     │
        │            .m3u8 / .mp4 stream URL                      │
        └────────────────────────────────────────────────────────────┘
```

**Sunucu yoktur.** Tüm sağlama istemci tarafında olur. Deploy `git push`'tan ibarettir.

Repo iki yönlü bir geri besleme döngüsü içerir:

1. `manifest.json` → provider dosyalarının hangi siteyi hangi id ile
   çalıştırdığını söyler
2. Provider dosyasının içindeki `provider: "castsinema-…"` alanı → manifest id'siyle
   eşleşmelidir

Bu eşleme `scripts/validate.mjs` tarafından zorunlu kılınır.

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
| `mediaType` | `"movie"` \| `"tv"` | CastSinema `tv`/`series`/`show` → `series` olarak normalize eder |
| `season` | number \| null | filmlerde `null` |
| `episode` | number \| null | filmlerde `null` |

İsteğe bağlı ikinci export: `onSettings()` → `Promise<SettingsField[]>`.
Yalnızca `providers/castsinema-dizibox.js` bu export'u verir.

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
  format:    "m3u8",                      // "m3u8" | "mp4"
  headers:   { "User-Agent": UA, "Referer": "https://site/" },
  subtitles: [ { id, url, language, name, headers } ]   // opsiyonel
}
```

**`format` yalnızca iki değer alır:** `"m3u8"` (HLS playlist) veya `"mp4"` (doğrudan medya).
Manifest'te `formats: ["m3u8","mp4"]` yazması bir *yetenek beyanıdır*; runtime değeri değildir.

**`headers` kritiktir.** Birçok CDN, doğru `Referer` ve `User-Agent` olmadan
403 döner. `Referer` her zaman **medya sunucusuna** ait olmalıdır.

**`quality`** çoğunlukla `1080`, 4K varsa `2160`.

---

## 4. Manifest şeması

CastSinema'nun `scrapers[]` dizisini kullanır:

```jsonc
{
  "id": "castsinema",
  "name": "CastSinema",
  "version": "1.8.0",
  "scrapers": [
    {
      "id": "castsinema-dizibox",           // benzersiz; picker kimliği
      "name": "CastSinema • DiziBox",       // picker etiketi + stream `name` öneki
      "description": "DiziBox yerel HTML/JS dizi sağlayıcısı.",
      "version": "1.0.0",
      "author": "CastSinema",
      "supportedTypes": ["tv"],        // runtime davranışını etkileyen TEK alan
      "filename": "providers/castsinema-dizibox.js",
      "enabled": true,
      "hasSettings": true,
      "logo": "https://raw.githubusercontent.com/castiel430/CastSinema-Addons/main/assets/logo.png",
      "contentLanguage": ["tr"],
      "formats": ["m3u8", "mp4"],
      "limited": false,
      "disabledPlatforms": [],
      "supportsExternalPlayer": true
    }
  ]
}
```

### 4.1 Alanların gerçek etkisi

| Alan | Etkisi |
|---|---|
| `supportedTypes` | **Tek runtime etkisi olan alan.** CastSinema yalnızca listelenen türlerde scraper'ı çağırır. |
| `filename` | Manifest–kod sözleşmesi. Dosya yoksa `validate` hata verir. |
| `hasSettings` | `true` ise uygulama `onSettings()` formunu çizer. |
| `enabled` | `false` → picker'da "No disponible". |
| `contentLanguage` | Picker'da dil filtresi. |
| `formats` | UI filtreleme (beyan). |
| `disabledPlatforms` | Platform bazlı gizleme. |
| `supportsExternalPlayer` | Harici oynatıcıya URL verilmesine izin verir. |
| `id`, `name`, `description`, `version`, `author`, `logo` | Yalnızca gösterim. |

> **Önemli:** Provider kodu manifesti **hiçbir zaman okumaz**. Tüm
> yapılandırma JS içinde sabittir (`var HOST = "https://…"`).

---

## 5. Provider türleri

33 provider 4 ana akış ailesine ayrılır:

| Aile | Açıklama | Örnekler |
|---|---|---|
| **HTML/JS kazıma** | Arama → detay → iframe → oynatıcı sayfası → media URL | filmmodu, dizimom, setfilmizle, hdfilmcehennemi, filmmakinesi, dizibox, dizilla, dizifilmizle, jetfilmizle, webteizle |
| **JSON API** | REST/JSON endpoint'lerinden doğrudan stream | boxfilm, dizipal, selcukflix, sinemetrik, rectv, xpass, puhutv, tlctr, dmax |
| **Tek-regex / embed** | Sayfada `.m3u8`/`.mp4` veya embed URL aranır | clipbox, yesilcamtv, webdramaturkey2, asyaanimeleri, dizikorea3 |
| **MP4/ok.ru CDN** | Doğrudan MP4 kaynakları | ddizi, belgeselx, animecix, anizium, dizipod, diziyou |

Her provider kendi `HOST` sabitini taşır; site domain değiştiğinde bu sabit
güncellenmelidir.

---

## 6. Hermes uyumluluğu

CastSinema provider JS'i **Hermes** içinde çalıştırır. Kritik kısıtlar:

| Kısıt | Sonuç |
|---|---|
| `async/await` güvenilir değil | **Tüm** provider'lar yalnızca Promise zinciri kullanır. |
| Sayfa JS'i çalıştırılamaz | Oynatıcı config'leri **statik** çözülür. |
| Node modülleri sınırlı | `require("crypto")` CastSinema tarafından sağlanır. |
| Yan etkisiz `globalThis` | `globalThis.getStreams` ataması bazı provider'larda var — dikkat edin. |

---

## 7. TMDB entegrasyonu

Doğru uygulama `dizibox`'ta vardır — anahtar çözümleme zinciri:

1. `SCRAPER_SETTINGS.tmdbApiKey` (kullanıcı ayarları)
2. `globalThis.TMDB_API_KEY` (CastSinema'nun kendi anahtarı)
3. Gömülü yedek `4e44d9029b1270a757cddc766a1bcb63`

Anahtar tipi otomatik algılanır — 40 karakterden uzunsa **v4 Read Access Token**
(`Authorization: Bearer`), değilse **v3 API key** (`?api_key=`).

Kalan provider'lar anahtarı doğrudan gömülü olarak kullanır.

### 7.1 Kimlik eşleme stratejileri

| Strateji | Kullanan provider'lar |
|---|---|
| **Doğrudan TMDB id geçişi** | clipbox, xpass, ddizi, belgeselx, animecix, anizium, asyaanimeleri |
| **TMDB → imdb_id → site araması → slug** | filmmodu, dizimom, setfilmizle, filmmakinesi, hdfilmcehennemi, dizifilmizle, yesilcamtv, webteizle, dizikorea3, sinemetrik, puhutv, dmax, tlctr, dizilla, dizibal, dizipod, diziyou, jetfilmizle, webdramaturkey2, rectv, sezonlukdizi |
| **Dizin listesi + fuzzy sıralama** | dizibox |
| **Şifreli player token** | boxfilm, dizipal, selcukflix, xpass |

Türkçe-duyarlı normalizasyon zorunludur (`ı/ş/ğ/ü/ö/ç`).

---

## 8. Doğrulama ve test

### 8.1 `scripts/validate.mjs` — 6 kontrol

1. **Commit edilmiş Google API anahtarı yok** (`AIza…35`) — tüm depo taranır
2. **Placeholder yok** — `manifest.json` içinde `<KULLANICI>` / `<DEPO>` / `<MARKA>`
   kalmışsa hata verir
3. **Manifest şeması** — `scrapers` dizisi dolu, her girdide `id`/`name`/`filename`
   var, `id` benzersiz
4. **Dosya varlığı + sözdizimi** — her `filename` diskte var ve `node --check`
   ile geçiyor
5. **Yetim provider yok** — `providers/` altındaki her `.js` manifest'te
   listelenmiş olmalı
6. **Marka tutarlılığı** — her provider'ın içindeki `provider:` id'si manifest
   `id`'siyle eşleşmeli; stream `name`'i `CastSinema • ` önekiyle başlamalı

### 8.2 Testler — 20 test

`tests/providers.test.mjs` içindeki 20 test, provider'ları **`node:vm`** içinde
**mock `fetch`** ile çalıştırır — gerçek internete hiç çıkmaz.

Kapsam: manifest şeması, ClipBox (film + TV), Vidup (decrypt + TV), Hexa
(cap-token), FilmModu (Vidmixi HLS), DiziMom, SetFilmIzle (admin-ajax), DiziBox
(dizin + bölüm), HDFilmCehennemi (embed), BoxFilm (rotated player + altyazı),
FullHDFilmizlesene (rotated source list), DiziFilmizle (Vidmixi + altyazı),
Dizilla (pichive master + altyazı), Xpass (AES-256-GCM decrypt success/failure),
YesilCam TV (query-string HLS).

> **Niyetli tasarım kararı:** Canlı kaynak sitelerin geçici kapanması veya
> rate-limit'i CI'yi gereksiz yere kırmamasın diye canlı stream smoke testi
> yapılmaz. Tüm testler deterministiktir.

---

## 9. Bilinen sorunlar

### 9.1 Cloudflare istemci engeli

`webteizle.info`, `dizipal1595.com`, `selcukflix.app` (ve `dizilla.la` intermittently)
Node/undici TLS parmak izini engelliyor (403). Tarayıcı, Android ve native istemciler
geçiyor. Provider'lar istemcide çalıştığı için bu bir sorun değildir, ancak
**sunucu tarafında test edilemez** — doğrulama tarayıcı üzerinden yapılmalıdır.

### 9.2 `filmmakinesi` bölüm sayfaları

Bazı bölümler telif nedeniyle kaldırılmış durumda. Bu durumda sayfada yalnızca
YouTube fragmanı kalıyor ve provider bunu bilinçli olarak reddediyor — kullanıcı
fragmanı izlemek yerine boş sonuç alıyor.

### 9.3 `hdfilmcehennemi` bölüm sayfaları

Film sayfaları oynatıcıyı sunucu tarafında verir, ancak bölüm sayfaları
`player-container` içini boş render ediyor. Provider bölüm isteklerinde boş dizi
döndürüyor (hata vermiyor). Film desteği tam çalışıyor.

### 9.4 Site adresleri sabit kodlu

Her provider kendi `HOST` değişkenini içinde taşır. Bu siteler sık sık domain
değiştirdiği için **bakımın en sık yapıldığı yer** budur:

```js
var HOST = "https://filmmodu.cc";
```

---

## 10. Bakım rehberi

### Yeni provider eklemek

1. `providers/castsinema-<ad>.js` oluşturun, `getStreams` export'u verin
2. `manifest.json`'a karşılık gelen scraper girdisini ekleyin
   (`id`, `name`, `filename`, `provider` eşlemesi şart)
3. `tools/providers.json`'a test konfigürasyonu ekleyin
4. `npm test` — yetim dosya ve marka tutarlılığı kontrolleri sizi yakalar

### Bir provider çalışmıyorsa

1. `HOST` sabitini güncelleyin (site domain değiştirmiş olabilir)
2. Provider'ın `console.error` çıktısını CastSinema loglarında arayın
3. Site yapısı değişmiş olabilir — regex'i güncelleyin

### Provider kodu değiştirirken

- `async/await` **kullanmayın** — Promise zinciri kullanın
- `getStreams` her zaman `Promise<Stream[]>` dönmeli, hata halinde `[]`
- `provider` alanı manifest `id`'siyle **birebir** aynı olmalı
- `name` alanı `CastSinema • ` önekiyle başlamalı
- `headers` içinde doğru `Referer` olmalı (medya host'u)
- `format` alanı `"m3u8"` veya `"mp4"` olmalı (asla `"video"` değil)