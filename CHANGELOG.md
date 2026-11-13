# Changelog

All notable changes to CastSinema-Addons will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/tr/).

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


## Unreleased