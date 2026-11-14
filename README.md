# CastSinema

Türkçe dizi ve film sitelerini **doğrudan CastSinema / Stremio** içinde çalıştıran
scraper deposu.

Her provider, bir kaynak sitenin HTML/API yapısını okuyup CastSinema'nın beklediği
`getStreams(tmdbId, mediaType, season, episode)` sözleşmesini karşılar.
Sunucu yoktur, derleme adımı yoktur — `git push` yeterlidir.

---

## Kurulum

**CastSinema / Stremio → Addons → Advanced → Install from URL:**

```text
https://raw.githubusercontent.com/castiel430/CastSinema-Addons/main/manifest.json
```

> **Uygulamada ilk eklemeden sonra**: manifesti uygulama kurulumda **saklıyor**. İlk
eklemeden sonra: manifesti CastSinema kurulumda **saklıyor**. İlk
ekleme sırasında bir dosya adı değiştiyse, addon'u kaldırıp **yeniden ekleyin**
ki güncel manifest çekilsin.

Depoyu kendi hesabınıza taşıyorsanız:

```bash
node scripts/set-repo.mjs <github-user> <repo-name>
```

Bu komut logo adreslerini ve dokümanlardaki kurulum URL'lerini günceller.
`npm run validate` placeholder kaldığında hata verir, yani bozuk bir manifest
yayınlayamazsınız.

---

## Provider listesi

| Provider | Kaynak site | Tip | Durum |
|---|---|---|---|
| **DiziBox** | `www.dizibox.live` | dizi | ✅ çalışıyor |
| **ClipBox** | `vixsrc.to` | film + dizi | ✅ çalışıyor |
| **Xpass** | `play.xpass.top` | film + dizi | ✅ çalışıyor |
| **FilmModu** | `filmmodu.cc` | film | ✅ çalışıyor |
| **DiziMom** | `ddizimom.net` | dizi | ✅ çalışıyor |
| **SetFilmIzle** | `www.setfilmizle.ltd` | film + dizi | ✅ çalışıyor |
| **BoxFilm** | `boxfilm.net` | film | ✅ çalışıyor (~120 film) |
| **FullHDFilmizlesene** | `www.fullhdfilmizlesene.now` | film | ✅ çalışıyor (HLS + altyazı) |
| **FilmMakinesi** | `filmmakinesi.co` | film | ✅ çalışıyor (küçük katalog) |
| **HDFilmCehennemi** | `www.hdfilmcehennemi.nl` | film + dizi | ✅ çalışıyor (HLS + altyazı) |
| **Webteizle** | `webteizle.info` | film | ✅ çalışıyor |
| **Sezonluk Dizi** | `sezonlukdizi.cc` | dizi | ✅ çalışıyor |
| **DiziFilmizle** | `dizifilmizle.to` | film + dizi | ✅ çalışıyor |
| **DiziBal** | `dizibal.org` | film + dizi | ✅ çalışıyor (HLS + altyazı) |
| **DiziPod** | `dizipod.com` | dizi | ✅ çalışıyor (HLS) |
| **DiziYou** | `www.diziyou.one` | film + dizi | ✅ çalışıyor (HLS + altyazı) |
| **JetFilmizle** | `jetfilmizle.app` | film | ✅ çalışıyor (godrive + videopark) |
| **Ddizi** | `www.ddizi.tel` | dizi | ✅ çalışıyor (MP4/HLS) |
| **Dizikorea3** | `dizikorea3.com` | dizi | ✅ çalışıyor (HLS + altyazı) |
| **Sinemetrik** | `www.sinemetrik.com` | film + dizi | ✅ çalışıyor (HLS + altyazı) |
| **WebdramaTurkey2** | `webdramaturkey2.com` | film + dizi | ✅ çalışıyor (HLS + altyazı) |
| **TLC Türkiye** | `www.tlctv.com.tr` | dizi | ✅ çalışıyor (imzalı DYG HLS) |
| **DMAX** | `www.dmax.com.tr` | dizi | ✅ çalışıyor (HLS) |
| **Yeşilçam TV** | `yesilcamtv.com.tr` | film | ✅ çalışıyor (Rumble HLS + MP4) |
| **BelgeselX** | `belgeselx.com` | dizi | ✅ çalışıyor (MP4) |
| **PuhuTV** | `puhutv.com` | film + dizi | ✅ çalışıyor (DYG HLS + altyazı) |
| **RecTV** | `rectv.org.tr` | film + dizi | ✅ çalışıyor (imzalı API, HLS) |
| **AnimeciX** | `animecix.tv` | dizi (anime) | ✅ çalışıyor (MP4) |
| **Anizium** | `anizium.co` | dizi (anime) | ✅ çalışıyor (MP4 + altyazı) |
| **AsyaAnimeleri** | `asyaanimeleri.top` | dizi (anime) | ✅ çalışıyor (HLS) |
| **IzleFilm** | `izlefilm.net` | film | ✅ çalışıyor (ok.ru → HLS) |
| **DiziPal** | `dizipal1595.com` | film + dizi | ⚠️ Cloudflare (CI ağını 403'lüyor) |
| **SelcukFlix** | `selcukflix.app` | film + dizi | ⚠️ Cloudflare (CI ağını 403'lüyor) |
| **Dizilla** | `dizilla.la` | dizi | ⚠️ Cloudflare (CI ağını 403'lüyor) |
| **Webteizle** | `webteizle.info` | film | ⚠️ Cloudflare (CI ağını 403'lüyor) |

34 provider. Durumlar `tools/domain_watch.py` tarafından canlı olarak
doğrulanır (aşağıya bakın). Cloudflare uyarısı alan provider'lar, çalışan kod
yoluna sahiptir ancak bu deponun test çıkış IP'si site WAF'ı tarafından
engellenir; ev/telefon ağından normal şekilde çalışırlar.

> **Durum tablosu zamanla eskir.** Güncel tabloyu
> `reports/domain-watch-<tarih>.md` dosyasından veya
> `python tools/domain_watch.py` çalıştırarak görün.

### Siteye özel notlar

| Provider | Not |
|---|---|
| **DiziBox** | Dizin listesi + Türkçe-duyarlı fuzzy sıralama kullanır. Oynatıcı zinciri `king.php → molystream → moly.php → haydi.php → ok.ru` şeklindedir ve her halka **Referer** başlığı ister. |
| **FilmModu** | Laravel uygulaması: arama `/arama/onemi`, kaynaklar `/px`; ikisi de CSRF + oturum çerezi istiyor. Provider küçük bir cookie jar tutar. |
| **FilmMakinesi** | Canlı arama ucu `/?knl_ajax_search=1&s=` üzerinden çalışır (tema JS'inin kullandığı uç). Film sayfasındaki `oynatloload.top` oynatıcısı, sayfadaki `__ULTRA_EAUTH` jetonu ile `/api/video-bilgi/<id>` ucundan **HLS master + Türkçe .vtt** döndürür. Sitenin kataloğu küçük olduğu için sitede yayınlanmayan bir başlık için sonuç çıkmaz. |
| **HDFilmCehennemi** | Arama `/search/?q=` üzerinden JSON döner (`X-Requested-With: fetch` zorunlu). Oynatıcı `hdfilmcehennemi.mobi` yalnızca **oynatıcı istemcilerine** (okhttp/ExoPlayer) yanıt verir; manifest şifreli olarak gelir ve saf JS ile çözülür. Dizi sayfasından bölüm linki bulunur, bölüm sayfasındaki oynatıcıdan HLS + altyazı çıkarılır. |
| **FullHDFilmizlesene** | Yalnızca film. Kaynak adresleri sayfadaki `scx` nesnesinde ROT13 + base64 (veya `v2.` varyantı) ile gizlenir; provider bunları çözer, ardından `rapidvid` oynatıcısındaki şifreli manifestten HLS master + altyazı elde eder. |
| **BoxFilm** | JSON arama API'si sunucu tarafında **Türkçe** başlıklarla eşleşiyor; küçük bir katalog (~120 film) var ve doğrudan m3u8 veriyor. |
| **Webteizle** | Arama formu `?q=` üzerinden çalışır; IMDb id'leri poster URL'lerinde bulunur. Player code base64-reversed ile çözülür. |
| **Sezonluk Dizi** | Arama `/ara?q=` üzerinden JSON döner; bölüm sayfaları player code ile çalışır. Filemoon oynatıcısı ECDSA/PoW attestation ister; provider saf JS SHA-256/AES-GCM ile bunu üretir. |
| **Xpass** | Oynatıcı sayfası `/data/...` gövdesini AES-256-GCM ile şifreler. Anahtar `SHA-256("spv3-data-response\|<salt>\|<path>\|<token>")`; salt çalışma anında oynatıcı bundle'ından okunur. İlk 12 ayna okunur (zaman aşımı 8 sn). |
| **BoxFilm** | HLS CDN yalnızca `Referer` = `boxload.xyz/boxes/<id>` oynatıcı sayfası olduğunda yanıt verir; provider bu başlığı ve `Origin`'i gönderir. Oyuncu config'inden Türkçe/İngilizce/zorunlu altyazı izleri de çıkarılır. |
| **JetFilmizle** | `POST /jetplayer` → iframe → godrive (çoklu kalite MP4) ve videopark apollo (HLS) çözücüleri. Kaynak etiketi TR Dublaj/Altyazılı olarak korunur. |
| **Ddizi** | Bölümler tabii CDN'inden çoklu kalite MP4 olarak gelir. |
| **RecTV** | Resmî API attest/nonce + HMAC-SHA256 imzası ister; token'lı m3u8 döner. |
| **PuhuTV / TLC / DMAX** | DYG (NTV) altyapısı: `player/info` ucu imzalı HLS adresi verir. |
| **Yeşilçam TV** | Rumble embed'inden kalite başına HLS (`r_file=chunklist.m3u8`) ve doğrudan MP4 kaynakları çıkarılır. |

---

## Cloudflare ve kullanıcı ajanı

Sitelerin çoğu Cloudflare arkasında ve **bot gibi görünen istemcileri 403 ile
reddediyor**. Uygulamanın plugin motoru `fetch` çağrılarını doğrudan yerel HTTP
istemcisine bağlıyor ve bu istemcinin gönderdiği profil bazı siteler tarafından
kabul edilmiyor.

Bu yüzden her provider, isteklerini birkaç **tarayıcı profiliyle** sırayla
deniyor (Chrome → Firefox → Edge → Safari → medya istemcisi → profil'siz) ve
403 alırsa bir sonraki profile geçiyor. Bu katman `providers/*.js` içindeki
`netFetch` ile sağlanır.

---

## Nasıl çalışır

Provider dosyaları CommonJS modülüdür ve istemcide (QuickJS) çalışır:

```js
function getStreams(tmdbId, mediaType, season, episode) { /* -> Promise<Stream[]> */ }
module.exports = { getStreams: getStreams };
```

Dönen stream nesnesi:

```js
{
  name:    "CastSinema • FilmModu",   // manifest ile aynı olmalı
  title:   "FilmModu • Dövüş Kulübü • HLS 1080p",
  url:     "https://cdn.example/x.m3u8",
  quality: 1080,
  provider: "castsinema-filmmodu",     // manifest id ile aynı olmalı
  format:  "m3u8",                   // "m3u8" | "video"
  headers: { "User-Agent": "…", "Referer": "https://…" }
}
```

Kurallar:

- **Promise zinciri kullanılır**, `async/await` yok (QuickJS'te dinamik kodda
  güvenilir değil).
- Sayfa içi JavaScript **çalıştırılmaz**; oynatıcı config'leri statik çözülür.
- `provider` alanı manifest `id`'siyle, `name` alanı `CastSinema • ` önekiyle
  birebir eşleşmelidir. `npm run validate` bunu zorunlu kılar.

Detaylı sözleşme → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## Domain bekçisi (bot)

Siteler sık sık domain değiştirir. Depoda bunu izleyen bir Python bot var:

```bash
pip install -r tools/requirements.txt
python tools/domain_watch.py                 # tara, test et, rapor yaz
python tools/domain_watch.py --fix           # çalışan domaini bulup provider'ı güncelle
python tools/domain_watch.py --provider castsinema-filmmakinesi
```

Bot her provider için:

1. **Mevcut domainleri yoklar** (DNS + HTTP + içerik imzası).
2. **Yeni domain arar** — site adı + yaygın TLD listesi, DNS ile süzer.
3. **Provider'ı gerçek siteye karşı çalıştırır** — Node içinde, TLS parmak
   izini taklit eden bir Python proxy üzerinden, böylece Cloudflare engeli
   aşılır ve gerçek kod yolu test edilir.
4. **Rapor yazar** (`reports/domain-watch-<tarih>.md`) — hangi isteklerin
   başarısız olduğuna kadar.

Bulduğu domaini `--fix` ile provider dosyasına yazar. GitHub Actions'ta
her 6 saatte bir otomatik çalışacak şekilde tanımlıdır:

```yaml
# .github/workflows/domain-watch.yml
- run: python tools/domain_watch.py
- run: python tools/domain_watch.py --fix
```

---

## Depo haritası

```text
CastSinema/
├── manifest.json           # 33 scraper tanımı
├── providers/              # 33 provider JS dosyası
├── assets/logo.png         # picker logosu
├── scripts/
│   ├── validate.mjs        # manifest + provider doğrulaması
│   ├── set-repo.mjs        # GitHub koordinatlarını ayarlar
│   └── github-setup.mjs    # repo oluşturma + push + doğrulama
├── tools/
│   ├── domain_watch.py     # domain bekçisi (bot)
│   ├── tls_proxy.py        # TLS taklit eden fetch proxy
│   ├── run_provider.mjs    # provider'ı canlı siteye karşı çalıştıran koşum
│   ├── providers.json      # provider başına test vakası ve host listesi
│   └── requirements.txt
├── tests/providers.test.mjs   # 20 birim testi
└── docs/
    ├── ARCHITECTURE.md
    ├── BRANDING.md
    └── SETUP.md
```

---

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm test` | Doğrulama + 20 birim test |
| `npm run validate` | Yalnızca statik kontroller |
| `npm run set-repo -- <user> <repo>` | Kurulum adreslerini günceller |
| `npm run github:setup -- [repo]` | Repo oluşturur, push eder, yayını doğrular |
| `python tools/domain_watch.py` | Domainleri tarar ve canlı test yapar |

---

## Uyarılar

### Gömülü TMDB anahtarı

Provider'ların çoğu `4e44d9029b1270a757cddc766a1bcb63` TMDB v3 anahtarını
gomülü kullanır. Bu anahtar upstream'e aittir. Kendi anahtarınızı kullanmak
için → [`docs/BRANDING.md §2.1`](docs/BRANDING.md).

### Lisans

MIT License. Tüm haklar saklıdır — ayrıntı için [LICENSE](LICENSE).

---

## English

Scraper addons that run Turkish movie and series sites directly inside
CastSinema / Stremio. Each provider reads a site's HTML or API and fulfils the
`getStreams(tmdbId, mediaType, season, episode)` contract.

```bash
npm test                                        # validate + 20 unit tests
node scripts/set-repo.mjs <user> <repo>         # set your GitHub coordinates
python tools/domain_watch.py                    # scan domains and test live
```

Install URL:

```text
https://raw.githubusercontent.com/castiel430/CastSinema-Addons/main/manifest.json
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the provider contract,
[`docs/BRANDING.md`](docs/BRANDING.md) for hardcoded credentials and
[`docs/SETUP.md`](docs/SETUP.md) for deployment.

## English Provider List

| Provider | Source site | Type |
|---|---|---|
| **DiziBox** | `www.dizibox.live` | series |
| **ClipBox** | `vixsrc.to` | movie + series |
| **Xpass** | `play.xpass.top` | movie + series |
| **FilmModu** | `filmmodu.cc` | movie |
| **DiziMom** | `ddizimom.net` | series |
| **SetFilmIzle** | `www.setfilmizle.ltd` | movie + series |
| **BoxFilm** | `boxfilm.net` | movie (~120) |
| **FullHDFilmizlesene** | `www.fullhdfilmizlesene.now` | movie |
| **FilmMakinesi** | `filmmakinesi.co` | movie (küçük katalog) |
| **HDFilmCehennemi** | `www.hdfilmcehennemi.nl` | movie + series |
| **Webteizle** | `webteizle.info` | movie |
| **Sezonluk Dizi** | `sezonlukdizi.cc` | series |
| **DiziFilmizle** | `dizifilmizle.to` | movie + series |
| **DiziBal** | `dizibal.org` | movie + series |
| **DiziPod** | `dizipod.com` | series |
| **DiziYou** | `www.diziyou.one` | movie + series |
| **JetFilmizle** | `jetfilmizle.app` | movie |
| **Ddizi** | `www.ddizi.tel` | series |
| **Dizikorea3** | `dizikorea3.com` | series |
| **Sinemetrik** | `www.sinemetrik.com` | movie + series |
| **WebdramaTurkey2** | `webdramaturkey2.com` | movie + series |
| **TLC Türkiye** | `www.tlctv.com.tr` | series |
| **DMAX** | `www.dmax.com.tr` | series |
| **Yeşilçam TV** | `yesilcamtv.com.tr` | movie |
| **BelgeselX** | `belgeselx.com` | series |
| **PuhuTV** | `puhutv.com` | movie + series |
| **RecTV** | `rectv.org.tr` | movie + series |
| **AnimeciX** | `animecix.tv` | series (anime) |
| **Anizium** | `anizium.co` | series (anime) |
| **AsyaAnimeleri** | `asyaanimeleri.top` | series (anime) |
| **IzleFilm** | `izlefilm.net` | movie (ok.ru → HLS) |
| **DiziPal** | `dizipal1595.com` | movie + series (Cloudflare WAF) |
| **SelcukFlix** | `selcukflix.app` | movie + series (Cloudflare WAF) |
| **Dizilla** | `dizilla.la` | series (Cloudflare WAF) |
