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
| **Vidup** | `vidup.to` | film + dizi | ✅ çalışıyor |
| **Hexa** | `theemoviedb.hexa.su` | film + dizi | ✅ çalışıyor |
| **Xpass** | `play.xpass.top` | film + dizi | ✅ çalışıyor |
| **FilmModu** | `filmmodu.cc` | film | ✅ çalışıyor |
| **DiziMom** | `ddizimom.net` | dizi | ✅ çalışıyor |
| **SetFilmIzle** | `www.setfilmizle.ltd` | film + dizi | ✅ çalışıyor |
| **BoxFilm** | `boxfilm.net` | film | ✅ çalışıyor (~120 film) |
| **FullHDFilmizlesene** | `www.fullhdfilmizlesene.now` | film | ✅ çalışıyor |
| **FilmMakinesi** | `filmmakinesi.to` | film + dizi | ✅ çalışıyor |
| **HDFilmCehenni** | `www.hdfilmcehenni.nl` | film | ✅ çalışıyor |
| **Webteizle** | `webteizle.info` | film | ✅ çalışıyor |
| **Sezonluk Dizi** | `sezonlukdizi.cc` | dizi | ✅ çalışıyor |
| **Vidmody** | `vidmody.com` | film | ✅ çalışıyor |
| **HDFilmDelisi** | `hdfilmdelisi.org` | film | ✅ çalışıyor |
| **Kartun** | `kartun.api` | dizi | ✅ çalışıyor |
| **Anime** | `anime.api` | dizi | ✅ çalışıyor |
| **Toon** | `toon.api` | dizi | ✅ çalışıyor |
| **JetFilmizle** | `jetfilmizle.api` | film | ✅ çalışıyor |
| **CimX** | `cimx.api` | film + dizi | ✅ çalışıyor |
| **DiziFilmizle** | `dizifilmizle.to` | film + dizi | ✅ çalışıyor |

22 provider. Durumlar `tools/domain_watch.py` tarafından canlı olarak
doğrulanır (aşağıya bakın).

> **Durum tablosu zamanla eskir.** Güncel tabloyu
> `reports/domain-watch-<tarih>.md` dosyasından veya
> `python tools/domain_watch.py` çalıştırarak görün.

### Siteye özel notlar

| Provider | Not |
|---|---|
| **DiziBox** | Dizin listesi + Türkçe-duyarlı fuzzy sıralama kullanır. Oynatıcı zinciri `king.php → molystream → moly.php → haydi.php → ok.ru` şeklindedir ve her halka **Referer** başlığı ister. |
| **FilmModu** | Laravel uygulaması: arama `/arama/onemi`, kaynaklar `/px`; ikisi de CSRF + oturum çerezi istiyor. Provider küçük bir cookie jar tutar. |
| **Hexa** | API bir captcha handshake kullanır: challenge → çözüm servisi → redeem → kısa ömürlü cap token. |
| **FilmMakinesi** | Arama `/arama/?s=` üzerinden ve **IMDb id** ile çalışır; bölüm oynatıcısı `closeload.filmmakinesi.to` altındadır. Telif nedeniyle kaldırılmış bölümlerde sadece YouTube fragmanı kalır — provider bunu **stream olarak döndürmez**. |
| **HDFilmCehenni** | Arama `/search?q=` üzerinden JSON döner. Film sayfaları oynatıcıyı sunucu tarafında verir; **bölüm sayfaları oynatıcıyı boş render ediyor**, bu yüzden dizi sunulmuyor. |
| **FullHDFilmizlesene** | Yalnızca film. Kaynak adresleri sayfadaki `scx` nesnesinde ROT13 + base64 ile gizlenir; provider bunları çözer. |
| **BoxFilm** | JSON arama API'si sunucu tarafında **Türkçe** başlıklarla eşleşiyor; küçük bir katalog (~120 film) var ve doğrudan m3u8 veriyor. |
| **Webteizle** | Arama formu `?q=` üzerinden çalışır; IMDb id'leri poster URL'lerinde bulunur. Player code base64-reversed ile çözülür. |
| **Sezonluk Dizi** | Arama `/ara?q=` üzerinden JSON döner; bölüm sayfaları player code ile çalışır. |

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
├── manifest.json           # 22 scraper tanımı
├── providers/              # 22 provider JS dosyası
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
├── tests/providers.test.mjs   # 19 birim testi
└── docs/
    ├── ARCHITECTURE.md
    ├── BRANDING.md
    └── SETUP.md
```

---

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm test` | Doğrulama + 19 birim test |
| `npm run validate` | Yalnızca statik kontroller |
| `npm run set-repo -- <user> <repo>` | Kurulum adreslerini günceller |
| `npm run github:setup -- [repo]` | Repo oluşturur, push eder, yayını doğrular |
| `python tools/domain_watch.py` | Domainleri tarar ve canlı test yapar |

---

## Uyarılar

### Üçüncü taraf servisler

`Vidup` ve `Hexa` provider'ları `https://enc-dec.app` adlı **üçüncü
taraf** çözümleme servisine bağlıdır. Servis çökerse bu iki provider birlikte
çalışmaz. Servisin kullanım şartlarını inceleyin.

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
npm test                                        # validate + 19 unit tests
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
| **Vidup** | `vidup.to` | movie + series |
| **Hexa** | `theemoviedb.hexa.su` | movie + series |
| **Xpass** | `play.xpass.top` | movie + series |
| **FilmModu** | `filmmodu.cc` | movie |
| **DiziMom** | `ddizimom.net` | series |
| **SetFilmIzle** | `www.setfilmizle.ltd` | movie + series |
| **BoxFilm** | `boxfilm.net` | movie (~120) |
| **FullHDFilmizlesene** | `www.fullhdfilmizlesene.now` | movie |
| **FilmMakinesi** | `filmmakinesi.to` | movie + series |
| **HDFilmCehenni** | `www.hdfilmcehenni.nl` | movie |
| **Webteizle** | `webteizle.info` | movie |
| **Sezonluk Dizi** | `sezonlukdizi.cc` | series |
| **Vidmody** | `vidmody.com` | movie |
| **HDFilmDelisi** | `hdfilmdelisi.org` | movie |
| **Kartun** | `kartun.api` | series |
| **Anime** | `anime.api` | series |
| **Toon** | `toon.api` | series |
| **JetFilmizle** | `jetfilmizle.api` | movie |
| **CimX** | `cimx.api` | movie + series |
| **DiziFilmizle** | `dizifilmizle.to` | movie + series |
