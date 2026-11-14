# Markalama ve kimlik bilgileri rehberi

Bu depoyu yayınlamadan önce yapmanız gereken değişiklikler.

---

## 1. Zorunlu: GitHub koordinatları

`manifest.json` içindeki logo URL'leri şu formdadır:

```json
"logo": "https://raw.githubusercontent.com/castiel430/CastSinema-Addons/main/assets/logo.png"
```

Bunu tek komutla doldurun:

```bash
node scripts/set-repo.mjs <github-user> <repo-name>
npm test
```

Betik `manifest.json`, `README.md` ve `docs/*.md` içindeki tüm URL'leri
günceller. `npm run validate` placeholder kaldığında **hata verir** — yani
yanlışlıkla placeholder'lı manifest'i yayınlayamazsınız.

---

## 2. Gömülü üçüncü taraf kimlik bilgileri

### 2.1 TMDB API anahtarı

Çoğu provider'da gömülü (**32** dosya). Ortak değer:

```text
4e44d9029b1270a757cddc766a1bcb63
```

Bu anahtar upstream'e aittir ve herkese açıktır. İki seçenek:

**A) CastSinema'nun kendi anahtarını kullanın (önerilen).**
CastSinema uygulaması `globalThis.TMDB_API_KEY` inject eder. `dizibox` zaten bu
zinciri uygular:

```js
var key = String(saved.tmdbApiKey || root.TMDB_API_KEY || '4e44d9029b1270a757cddc766a1bcb63').trim();
```

Diğer provider'larda da aynı deseni uygulayın:

```js
function tmdbKey() {
  var root = typeof globalThis !== 'undefined' ? globalThis : {};
  var saved = root.SCRAPER_SETTINGS || {};
  return String(saved.tmdbApiKey || root.TMDB_API_KEY || '<KENDİ_ANAHTARINIZ>').trim();
}
```

**B) Kendi TMDB v3 anahtarınızı kullanın.**
<https://www.themoviedb.org/settings/api> adresinden alın. 40 karakterden
uzunsa v4 Read Access Token (`Authorization: Bearer`), değilse v3 API key
(`?api_key=`) olarak kullanılır.

> `validate.mjs` yalnızca **Google** API anahtarlarını (`AIza…`) reddeder,
> TMDB anahtarlarını reddetmez — yani unutursanız fark edilmez.

### 2.2 BoxFilm parmak izi

```js
"X-Fingerprint-Lite": "e9136c41504646444"
```

**Konum:** `providers/castsinema-boxfilm.js`. BoxFilm API'nin beklediği sabit değerdir.
Değiştirmek provider'ı bozar.

---

## 3. Marka metni

### 3.1 Stream görünen adları

Her provider'da:

```js
name: "CastSinema • FilmModu",
```

`validate.mjs` bunu zorunlu kılar — `CastSinema • ` önekiyle başlamayan bir
stream adı hata verir.

### 3.2 Provider kimlikleri

```js
provider: "castsinema-filmmodu",
```

Manifest `id` ile **birebir** eşleşmelidir. `validate.mjs` kontrol eder.

### 3.3 Log önekleri

```js
console.error("[CastSinema FilmModu] " + (error && error.message ? error.message : String(error)));
```

Kullanıcıya görünmez ama hata ayıklamada işe yarar.

### 3.4 Korunması gereken satırlar

İki satır **kasıtlı olarak** telif bildirimi taşır ve **değiştirilmemelidir**
(GPL-3.0 §5(c) atıf yükümlülüğü):

`validate.mjs` artık eski marka adlarını tek tek aramak yerine **her provider id'sinin
`castsinema-` önekiyle başlamasını** zorunlu kılar; bu, eski addan kalmış herhangi
bir kalıntıyı da yakalar.

### 3.5 `author` alanı

Manifest'teki `author: "CastSinema"` marka adını gösterir.
Kendi adınızı göstermek isterseniz değiştirebilirsiniz, ancak `providers/*.js`
içindeki telif satırlarını silmemelisiniz.

---

## 4. Logo

```text
assets/logo.png   (512×512, CastSinema "CS" logosu)
```

Kendi logonuzu koymak için: aynı dosya adıyla `assets/logo.png` yazın.
Boyut önerisi: 512×512 PNG, kare, şeffaf arka plan.

Kontrol için: `manifest.json`'daki `logo` alanı
`https://raw.githubusercontent.com/castiel430/CastSinema-Addons/main/assets/logo.png`
olmalıdır.

---

## 5. Kontrol listesi

```text
[ ] node scripts/set-repo.mjs <user> <repo>  çalıştırıldı
[ ] Logo URL'si kendi raw.githubusercontent.com adresinize bakıyor
[ ] TMDB anahtarı: kendi anahtarınız veya globalThis.TMDB_API_KEY zinciri
[ ] npm test geçiyor
[ ] npm run validate geçiyor (provider id önekleri `castsinema-` ile başlıyor)
[ ] GitHub'a push edildi ve manifest URL'si tarayıcıda açılıyor
```

Doğrulama:

```bash
npm test
npm run validate
curl -s https://raw.githubusercontent.com/castiel430/CastSinema-Addons/main/manifest.json | head -5
```

---

## 6. Lisans

MIT License. Lisans metni için [`LICENSE`](../LICENSE) dosyasına bakın.

Lisansı değiştirmek istiyorsanız `package.json`'daki `license` alanını güncelleyin.
Ancak GPL-3.0'ün kaynak kodunu yayımlama yükümlülüğünü gözden geçirin.