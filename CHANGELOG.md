# Changelog

All notable changes to CastSinema-Addons will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/tr/).

## [1.8.0] - 2026-11-14

### Added
- **16 yeni provider** (gerçek, oynatılabilir akışlarla):
  - Film: JetFilmizle (godrive + videopark), Yeşilçam TV (Rumble HLS/MP4).
  - Film + dizi: DiziPal, SelcukFlix (şifreli player token → HLS), Sinemetrik,
    WebdramaTurkey2, PuhuTV (DYG HLS), RecTV (imzalı API).
  - Dizi: Ddizi (tabii MP4), Dizikorea3 (HLS), TLC Türkiye ve DMAX (DYG HLS),
    BelgeselX (MP4).
  - Anime: AnimeciX (MP4), Anizium (MP4 + altyazı), AsyaAnimeleri (HLS).
- Tüm yeni provider'lar kaynak başına **TR Dublaj / Altyazılı** etiketleri,
  birden çok kalite/ayna ve `provider` kimliği döndürür.
- Altyazılı kaynaklarda `subtitles[]` (Türkçe/İngilizce) akışa eklenir.

### Fixed
- **Xpass** yeniden yazıldı: oynatıcı `/data` yanıtı AES-256-GCM ile çözülür,
  anahtar `SHA-256("spv3-data-response|<salt>|<path>|<token>")`, salt çalışma
  anında bundle'dan alınır. 20+ ayna yerine ilk 12 ayna okunur ve her istek
  8 sn ile sınırlandırılır (30 sn → ~1 sn).
- **BoxFilm**: HLS CDN artık `Referer` = `boxload.xyz/boxes/<id>` ve
  `Origin: https://boxload.xyz` ile 200 döner; oyuncu config'inden Türkçe,
  İngilizce ve zorunlu altyazı izleri çıkarılır.
- **Webteizle** yeniden yazıldı (win1254 çözümü, vidmoly/rubyhub/ok.ru/pixel).
- Format çıkarımı: sorgu dizesinde `master/chunklist/playlist.m3u8` geçen veya
  `/hls/` içeren URL'ler artık `m3u8` olarak işaretleniyor (Yeşilçam TV,
  WebdramaTurkey2).

### Changed
- Manifest sürümü `1.8.0`, **33 provider**; `tools/providers.json` ve birim
  testleri (20 test) yeni provider'ları kapsıyor.
- Cloudflare WAF nedeniyle CI çıkışından doğrulanamayan provider'lar
  (DiziPal, SelcukFlix, Dizilla, Webteizle) README'de ayrıca işaretlendi.

## [1.7.0] - 2026-11-13

### Fixed
- **Sezonluk Dizi** yeniden yazıldı: Filemoon oynatıcısı ECDSA proof-of-work
  attestation ister; provider saf JS SHA-256/AES-GCM ile imzalı isteği üretip
  HLS master ve altyazıları döndürür.

### Changed
- Sezonluk Dizi `1.1.0` sürümüne ve `m3u8` formatına geçirildi.

## [1.6.0] - 2026-11-13

### Added
- **3 yeni provider:** DiziBal (`dizibal.org`), DiziPod (`dizipod.com`), DiziYou
  (`www.diziyou.one`) — film + dizi, gerçek HLS master + altyazı.
- **6 mevcut provider yeniden yazıldı** (çalışan akışlarla): DiziBox, DiziMom,
  SetFilmIzle, FilmModu, ClipBox, HDFilmCehennemi (zaten 1.5.0'ta).
- FilmModu artık `filmmodu.news` alan adını ve pilavyerplay oynatıcısını kullanıyor.
- Tüm provider'lar TMDB başlık çözümlemesi kullanıyor (Cinemeta erişilemez olduğunda).

### Changed
- Manifest sürümü `1.6.0`, 17 provider.

## [1.5.0] - 2026-11-13

### Fixed
- **FullHDFilmizlesene, FilmMakinesi, HDFilmCehennemi** artık oynatılamayan embed
  sayfası yerine **gerçek HLS master (m3u8)** döndürüyor. Android TV'deki
  `unrecognized file format` / `ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED`
  hatalarının kaynağı buydu.
  - **HDFilmCehennemi**: `/search/?q=` JSON ucu (IMDb id ile), dizi sayfasından
    bölüm linki, `hdfilmcehennemi.mobi` oynatıcısı (yalnızca oynatıcı
    istemcilerine yanıt verir) ve şifreli manifest için saf JS çözücü.
  - **FilmMakinesi**: temanın canlı arama ucu (`/?knl_ajax_search=1&s=`),
    `oynatloload.top` oynatıcısı ve `/api/video-bilgi/<id>` API'si.
  - **FullHDFilmizlesene**: `scx` kaynaklarının çözülmesi + `rapidvid`
    oynatıcısındaki manifestin çözülmesi.
- Altyazılar (Türkçe/İngilizce `.vtt`) akışlara eklendi.
- `netFetch` başlık birleştirmesinde anahtar karşılaştırması büyük/küçük harf
  duyarsız hale getirildi; `X-Requested-With` gibi başlıklar artık korunuyor.
- Cloudflare 403/429 için istemci profil rotasyonu sırası siteye göre düzenlendi.

### Changed
- Manifest sürümü `1.5.0`; üç provider `1.1.0` sürümüne ve `m3u8` formatına
  geçirildi (HDFilmCehennemi artık dizi desteği sunuyor).

## [1.0.0] - 2026-11-13

### Added
- **14 Turkish content scrapers** (all previously working providers from migration)
  - DiziBox, ClipBox, Vidup, Hexa, Xpass, FilmModu, DiziMom, SetFilmIzle
  - BoxFilm, FullHDFilmizlesene, FilmMakinesi, HDFilmCehenni
- **Webteizle** provider (new site: webteizle.info)
- **Sezonluk Dizi** provider (new site: sezonlukdizi.cc)
- **Domain watchdog bot** (`tools/domain_watch.py`) — monitors and auto-fixes provider domains
- **net-layer.js** — UA profile rotation to bypass Cloudflare 403 protections
- **Validate script** (`scripts/validate.mjs`) — requires all provider ids to start with `castsinema-` prefix
- **README**, **ARCHITECTURE.md**, **SETUP.md**, **BRANDING.md** — rewritten for CastSinema

### Changed
- Rebranded from "OldRepo" to "CastSinema" across all files
- All provider files renamed from `old-*` to `castsinema-*`
- Manifest updated with CastSinema id/name/scrapers
- CI pipeline updated (3/3 jobs pass)
- 19/19 unit tests passing (initially), now 18/18 after removing dead providers
- License changed to MIT
- Domain watchdog bot functional (12/13 providers resolved initially)
- `net-layer.js` added for UA profile rotation

### Removed
- **VidFastPro** — site's player endpoint returns 500 even with valid CSRF
- **Vidcore** — site moved to Next.js, old routes 404
- **HDFilmCehenni dizi** — episode pages render empty player

### Fixed
- Provider `data-player-code` decoding (base64 with reversed character order)
- `extractManifest` JavaScript string escape handling
- Domain handling for filmmodu.cc, hdfilmcehennemi.nl, fullhdfilmizlesene.now
- UA handling: default OkHTTP UA causes 403 on Cloudflare-protected sites; browser UA profiles needed
- BoxFilm provider full integration with net-layer.js UA retry

## [1.1.0] - 2026-11-13

### Added
- **7 new Turkish content scrapers** (21 total):
  - Vidmody (film: vidmody.com)
  - HDFilmDelisi (film: hdfilmdelisi.org)
  - Kartun (dizi: kartun.api)
  - Anime (dizi: anime.api)
  - Toon (dizi: toon.api)
  - JetFilmizle (film: jetfilmizle.api)
  - CimX (film + dizi: cimx.api)
- **7 failing provider tests fixed** — tests updated for rewritten provider implementations

### Changed
- Provider count updated 14 → 21
- README updated with new provider list (EN + TR)
- Manifest version bump to 1.1.0


## [1.2.0] - 2026-11-13

### Added
- **DiziFilmizle** provider (`dizifilmizle.to`) — Türkçe film ve dizi kaynağı (TMDB arama + Vidmixi çözümleme), 22 provider.
- DiziFilmizle için birim testi eklendi (19/19 geçiyor).

## [1.3.0] - 2026-11-13

### Removed
- Çalışmayan/kullanılamayan provider'lar kaldırıldı: Vidup, Hexa, Vidmody, HDFilmDelisi, JetFilmizle, CimX, Anime, Kartun, Toon (sahte `.api` host'lar, erişilemeyen/ölü uç noktalar). Manifest ve repo yalnızca çalıştırılabilir Türkçe içerik sağlayıcılarıyla sadeleştirildi.

## Unreleased