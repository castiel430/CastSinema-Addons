// CastSinema addon — gizli kurulum Worker'ı.
//
// Repo private olduğunda raw.githubusercontent.com URL'leri 404 döndüğü için,
// addon dosyaları (manifest + providers + logo) bu Worker'ın arkasındaki
// Cloudflare KV'de tutulur ve yalnızca gizli yol segmenti ile sunulur.
//
//   https://<worker>/<SECRET_PATH>/manifest.json
//   https://<worker>/<SECRET_PATH>/providers/castsinema-dizibox.js
//
// /assets/logo.png herkese açıktır (addon picker logosu seçilebilir —
// içerik zaten açık kaynaklı marka öğesidir). Geri kalan her şey
// SECRET_PATH olmadan 404 verir.
//
// Kurulum: docs/PRIVATE-HOSTING.md

const TYPES = [
  ['.json', 'application/json; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.vtt', 'text/vtt; charset=utf-8'],
];

function contentType(key) {
  for (const [ext, type] of TYPES) {
    if (key.toLowerCase().endsWith(ext)) return type;
  }
  return 'application/octet-stream';
}

function serve(env, key) {
  if (!key || key.includes('..') || key.startsWith('/')) {
    return new Response('Not Found', { status: 404 });
  }
  return env.ADDON_FILES.get(key, { type: 'arrayBuffer' }).then(function (value) {
    if (value === null || value === undefined) {
      return new Response('Not Found', { status: 404 });
    }
    return new Response(value, {
      status: 200,
      headers: {
        'Content-Type': contentType(key),
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);

    // Logo açık (picker'da görünmesi gereken marka öğesi)
    if (path === '/assets/logo.png') {
      return serve(env, 'assets/logo.png');
    }

    const secret = String(env.SECRET_PATH || '');
    const prefix = `/${secret}/`;
    if (!secret || !path.startsWith(prefix)) {
      return new Response('Not Found', { status: 404 });
    }
    return serve(env, path.slice(prefix.length));
  },
};
