import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';

async function loadProvider(relativePath, fetchImpl) {
  const code = await fs.readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    fetch: fetchImpl,
    console,
    Promise,
    String,
    Array,
    Object,
    RegExp,
    Math,
    JSON,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    Buffer,
    atob: (s) => Buffer.from(s, 'base64').toString('utf8'),
    btoa: (s) => Buffer.from(s, 'utf8').toString('base64'),
    require: (name) => {
      if (name === 'crypto') return crypto;
      throw new Error(`Cannot require ${name}`);
    }
  });
  new vm.Script(code, { filename: relativePath }).runInContext(context);
  return module.exports;
}

function response({ json, text = json != null ? JSON.stringify(json) : '', ok = true, status }) {
  return {
    ok,
    status: status != null ? status : (ok ? 200 : 404),
    json: async () => json,
    text: async () => text
  };
}

test('CastSinema manifest uses the current scraper repository schema', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'CastSinema');
  assert.ok(Array.isArray(manifest.scrapers));
  assert.ok(manifest.scrapers.length >= 5);
  for (const scraper of manifest.scrapers) {
    assert.ok(scraper.id);
    assert.ok(scraper.filename);
    assert.equal(typeof scraper.enabled, 'boolean');
    await fs.access(new URL(`../${scraper.filename}`, import.meta.url));
  }
});

test('ClipBox provider converts TMDB movie response into playable stream', async () => {
  const calls = [];
  const provider = await loadProvider('providers/castsinema-clipbox.js', async (url) => {
    calls.push(String(url));
    if (String(url).includes('/movie/550')) return response({ json: { title: 'Fight Club', original_title: 'Fight Club', imdb_id: 'tt0137523' } });
    if (String(url).includes('/api/search?q=')) {
      return response({ json: [{ id: 42, title: 'Fight Club', slug: 'fight-club-1999', poster_url: '/uploads/posters/tt0137523-poster.webp', language_label: 'DUAL' }] });
    }
    if (String(url).includes('/film/fight-club-1999')) {
      const code = btoa('https://vixsrc.to/boxes/abc').split('').reverse().join('');
      return response({ text: `<div class="box-player-preview" data-player-code="${code}"></div>` });
    }
    if (String(url).includes('/boxes/abc')) {
      const f = 'https://cdn.example/video.m3u8';
      return response({ text: `<script>jwplayer('player').setup(JSON.parse('{"file":"${f}"}'));</script>` });
    }
    return response({ ok: false });
  });
  const streams = await provider.getStreams('550', 'movie', null, null);
  assert.equal(streams.length, 1);
  assert.ok(calls.some((c) => c.includes('/api/search?q=')));
});

test('ClipBox provider uses TV season/episode route', async () => {
  const provider = await loadProvider('providers/castsinema-clipbox.js', async () => {
    return response({ ok: false });
  });
  const streams = await provider.getStreams('1399', 'tv', 2, 3);
  assert.deepEqual(Array.from(streams), []);
});

test('FilmModu provider searches and decrypts Vidmixi player to extract HLS stream', async () => {
  const password = 'secret-hash';
  const salt = crypto.randomBytes(8);
  const passBytes = Buffer.from(password, 'utf8');
  let d = Buffer.alloc(0);
  let di = Buffer.alloc(0);
  while (d.length < 48) {
    di = crypto.createHash('md5').update(Buffer.concat([di, passBytes, salt])).digest();
    d = Buffer.concat([d, di]);
  }
  const cipher = crypto.createCipheriv('aes-256-cbc', d.subarray(0, 32), d.subarray(32, 48));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ video_location: 'https://cdn.example/filmmodu.m3u8', title: 'Fight Club' }), 'utf8'),
    cipher.final()
  ]);
  const setJson = JSON.stringify({ ct: encrypted.toString('base64'), s: salt.toString('hex') });
  const ilkpartkod = btoa('<iframe src="https://vidmixi.example/embed/10"></iframe>');

  const provider = await loadProvider('providers/castsinema-filmmodu.js', async (url, options = {}) => {
    const u = String(url);
    if (u.includes('/movie/550')) return response({ json: { title: 'Fight Club', original_title: 'Fight Club', imdb_id: 'tt0137523' } });
    if (u === 'https://filmmodu.cc/arama/') return response({ text: '<a href="https://filmmodu.cc/film/fight-club">Fight Club</a>' });
    if (u === 'https://filmmodu.cc/film/fight-club') return response({ text: "<script>var ilkpartkod='" + ilkpartkod + "';</script>" });
    if (u === 'https://vidmixi.example/embed/10') return response({ text: `<script>bePlayer('${password}', '${setJson.replace(/\\/g, '\\\\')}');</script>` });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(550, 'movie', null, null);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/filmmodu.m3u8');
});


test('DiziMom provider searches and extracts HLS stream for TV series', async () => {
  const provider = await loadProvider('providers/castsinema-dizimom.js', async (url) => {
    const u = String(url);
    if (u.includes('/tv/1399')) return response({ json: { name: 'Game of Thrones', original_name: 'Game of Thrones' } });
    if (u.includes('/ara?q=')) return response({ text: '<a href="https://ddizimom.net/dizi/game-of-thrones">GoT</a>' });
    if (u === 'https://ddizimom.net/dizi/game-of-thrones/sezon-2/bolum-3') return response({ text: '<div data-pv="got-s2e3"></div>' });
    if (u.includes('pilavyerplay.top/assets/js/s.php')) return response({ text: '<script>window.__PLAYER__ = {"stream":"https://cdn.example/got.m3u8"};</script>' });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(1399, 'tv', 2, 3);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/got.m3u8');
});

test('SetFilmIzle provider queries admin-ajax to extract playable stream', async () => {
  const provider = await loadProvider('providers/castsinema-setfilmizle.js', async (url) => {
    const u = String(url);
    if (u.includes('/movie/550')) return response({ json: { title: 'Fight Club', original_title: 'Fight Club' } });
    if (u.includes('/?s=')) return response({ text: '<a href="https://www.setfilmizle.ltd/film/fight-club/">Fight Club</a>' });
    if (u === 'https://www.setfilmizle.ltd/film/fight-club/') return response({ text: '<script>var cfg = { nonces: { video: "NONCE1" }, post_id: 99 };</script><div data-player-name="SetPlay"></div>' });
    if (u.includes('admin-ajax.php')) return response({ text: JSON.stringify({ success: true, data: { stream: { provider: 'SetPlay', url: 'https://cdn.example/setfilm.m3u8' } } }) });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(550, 'movie', null, null);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/setfilm.m3u8');
});

test('FilmMakinesi provider searches and extracts iframe stream', async () => {
  const provider = await loadProvider('providers/castsinema-filmmakinesi.js', async (url) => {
    const u = String(url);
    if (u.includes('/movie/550')) return response({ json: { title: 'Fight Club', imdb_id: 'tt0137523', external_ids: { imdb_id: 'tt0137523' } } });
    if (u.includes('/?s=') || u.includes('/arama/')) return response({ text: '<a class="mini-poster" href="https://filmmakinesi.tv/film/fight-club-1999/"></a>' });
    if (u === 'https://filmmakinesi.tv/film/fight-club-1999/') return response({ text: '<iframe data-src="https://closeload.filmmakinesi.to/video/embed/abc"></iframe>' });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(550, 'movie', null, null);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://closeload.filmmakinesi.to/video/embed/abc');
});

test('FilmMakinesi provider resolves a TV episode from the series page', async () => {
  const provider = await loadProvider('providers/castsinema-filmmakinesi.js', async (url) => {
    const u = String(url);
    if (u.includes('/tv/1399')) return response({ json: { name: 'Game of Thrones', external_ids: { imdb_id: 'tt0944947' } } });
    if (u.includes('/?s=') || u.includes('/arama/')) return response({ text: '<a class="mini-poster" href="https://filmmakinesi.tv/dizi/game-of-thrones/"></a>' });
    if (u === 'https://filmmakinesi.tv/dizi/game-of-thrones/sezon-2-bolum-3/') return response({ text: '<iframe src="https://closeload.filmmakinesi.to/video/embed/got23"></iframe>' });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(1399, 'tv', 2, 3);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://closeload.filmmakinesi.to/video/embed/got23');
});

test('FilmMakinesi provider never returns a trailer as the episode source', async () => {
  const provider = await loadProvider('providers/castsinema-filmmakinesi.js', async (url) => {
    const u = String(url);
    if (u.includes('/movie/550')) return response({ json: { title: 'Fight Club', external_ids: { imdb_id: 'tt0137523' } } });
    if (u.includes('/?s=') || u.includes('/arama/')) return response({ text: '<a class="mini-poster" href="https://filmmakinesi.tv/film/fight-club-1999/"></a>' });
    if (u === 'https://filmmakinesi.tv/film/fight-club-1999/') return response({ text: '<iframe src="https://www.youtube.com/embed/trailer"></iframe>' });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(550, 'movie', null, null);
  assert.equal(streams.length, 0);
});


test('DiziBox provider finds episode and extracts m3u8 stream', async () => {
  const provider = await loadProvider('providers/castsinema-dizibox.js', async (url) => {
    const u = String(url);
    if (u.includes('/tv/1104')) return response({ json: { name: 'Game of Thrones', original_name: 'Game of Thrones', external_ids: { imdb_id: 'tt0944947' } } });
    if (u.includes('/ara?q=')) return response({ json: [{ slug: 'game-of-thrones-izle', title: 'Game of Thrones', poster_url: '/tt0944947.jpg' }] });
    if (u === 'https://www.dizibox.live/diziler/game-of-thrones-izle/') return response({ text: '<a href="/game-of-thrones-izle-1-sezon-1-bolum-izle/">S1E1</a>' });
    if (u === 'https://www.dizibox.live/game-of-thrones-izle-1-sezon-1-bolum-izle/') return response({ text: '<iframe src="https://player.example/king.php?v=1"></iframe>' });
    if (u === 'https://player.example/king.php?v=1') return response({ text: 'var x="https://cdn.example/dizibox.m3u8";' });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(1104, 'tv', 1, 1);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/dizibox.m3u8');
});


test('HDFilmCehennemi provider searches and extracts embed stream', async () => {
  const provider = await loadProvider('providers/castsinema-hdfilmcehennemi.js', async (url) => {
    const u = String(url);
    if (u.includes('/movie/550')) return response({ json: { title: 'Fight Club', imdb_id: 'tt0137523', external_ids: { imdb_id: 'tt0137523' } } });
    if (u.includes('/search')) return response({ text: JSON.stringify({ results: ['<a href="https://hdfilmcehennemi.la/fight-club-izle/">Fight Club</a>'] }) });
    if (u === 'https://hdfilmcehennemi.la/fight-club-izle/') return response({ text: '<iframe class="close" data-src="https://hdfilmcehennemi.mobi/video/embed/fc25/?rapidrame_id=abc"></iframe>' });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(550, 'movie', null, null);
  assert.equal(streams.length, 1);
  assert.ok(streams[0].url.includes('hdfilmcehennemi.mobi/video/embed/fc25'));
});

test('HDFilmCehennemi provider extracts TV episode embed stream', async () => {
  const provider = await loadProvider('providers/castsinema-hdfilmcehennemi.js', async (url) => {
    const u = String(url);
    if (u.includes('/tv/1399')) return response({ json: { name: 'Game of Thrones', external_ids: { imdb_id: 'tt0944947' } } });
    if (u.includes('/search')) return response({ text: JSON.stringify({ results: ['<a href="https://hdfilmcehennemi.la/dizi/game-of-thrones/">GoT</a>'] }) });
    if (u === 'https://hdfilmcehennemi.la/dizi/game-of-thrones/sezon-2-bolum-3/') return response({ text: '<iframe src="https://close.example/embed/got23"></iframe>' });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(1399, 'tv', 2, 3);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://close.example/embed/got23');
});


test('BoxFilm provider decodes the rotated player code into an HLS manifest', async () => {
  const calls = [];
  const provider = await loadProvider('providers/castsinema-boxfilm.js', async (url) => {
    calls.push(String(url));
    if (String(url).includes('/movie/550')) return response({ json: { title: 'Fight Club', original_title: 'Fight Club', imdb_id: 'tt0137523' } });
    if (String(url).includes('/api/search?q=')) return response({ json: [{ id: 42, title: 'Fight Club', slug: 'fight-club-1999', poster_url: '/uploads/posters/tt0137523-poster.webp', language_label: 'DUAL' }] });
    if (String(url).includes('/film/fight-club-1999')) {
      const code = btoa('https://boxload.xyz/boxes/abc').split('').reverse().join('');
      return response({ text: `<div class="box-player-preview" data-player-code="${code}"></div>` });
    }
    if (String(url).includes('/boxes/abc')) {
      const f = 'https://cdn.example/hls/abc_master.m3u8';
      return response({ text: `<script>jwplayer('player').setup(JSON.parse('{"file":"${f}"}'));</script>` });
    }
    return response({ ok: false });
  });
  const streams = await provider.getStreams(550, 'movie', null, null);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].provider, 'castsinema-boxfilm');
  assert.equal(streams[0].format, 'm3u8');
  assert.ok(streams[0].url.startsWith('https://cdn.example/hls/'));
  assert.ok(calls.some((c) => c.includes('/api/search?q=')));
});

test('FullHDFilmizlesene provider decodes the rotated source list', async () => {
  const rot13 = (s) => s.replace(/[a-z]/gi, (c) => String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < 'n' ? 13 : -13)));
  const encodedUrl = rot13(btoa('https://cdn.example/fullhd/embed'));
  const scx = JSON.stringify({ du: { tt: btoa('Türkçe Dublaj'), sx: { t: [encodedUrl] } } });

  const provider = await loadProvider('providers/castsinema-fullhdfilmizlesene.js', async (url) => {
    const u = String(url);
    if (u.includes('/movie/550')) return response({ json: { title: 'Fight Club', imdb_id: 'tt0137523', external_ids: { imdb_id: 'tt0137523' } } });
    if (u.includes('/arama/')) return response({ text: '<li class="film"><a href="https://www.fullhdfilmizlesene.now/film/fight-club-izle/"><img src="/tt0137523.jpg"></a></li>' });
    if (u === 'https://www.fullhdfilmizlesene.now/film/fight-club-izle/') return response({ text: `<script>var scx = ${scx};</script>` });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(550, 'movie', null, null);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/fullhd/embed');
});

test('FullHDFilmizlesene provider refuses TV entries', async () => {
  const provider = await loadProvider('providers/castsinema-fullhdfilmizlesene.js', async () => {
    return response({ ok: false });
  });
  const streams = await provider.getStreams(1399, 'tv', 2, 3);
  assert.deepEqual(Array.from(streams), []);
});

test('DiziFilmizle provider searches and extracts Vidmixi stream for movie', async () => {
  const password = 'secret-hash';
  const salt = crypto.randomBytes(8);
  const passBytes = Buffer.from(password, 'utf8');
  let d = Buffer.alloc(0);
  let di = Buffer.alloc(0);
  while (d.length < 48) {
    di = crypto.createHash('md5').update(Buffer.concat([di, passBytes, salt])).digest();
    d = Buffer.concat([d, di]);
  }
  const cipher = crypto.createCipheriv('aes-256-cbc', d.subarray(0, 32), d.subarray(32, 48));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ video_location: 'https://cdn.example/dizifilmizle.m3u8', title: 'Fight Club' }), 'utf8'),
    cipher.final()
  ]);
  const setJson = JSON.stringify({ ct: encrypted.toString('base64'), s: salt.toString('hex') });

  const provider = await loadProvider('providers/castsinema-dizifilmizle.js', async (url) => {
    const u = String(url);
    if (u.includes('/movie/550')) return response({ json: { title: 'Fight Club', original_title: 'Fight Club', release_date: '1999-10-15' } });
    if (u.startsWith('https://dizifilmizle.to/api/search?q=')) return response({ json: { success: true, results: [{ id: 'x1', title: 'Dövüş Kulübü', original_title: 'Fight Club', slug: 'dovus-kulubu-filmi-hd-izle', content_type: 'movie', year: 1999 }] } });
    if (u === 'https://dizifilmizle.to/film/dovus-kulubu-filmi-hd-izle') return response({ text: '<html><body>player https://vidmixi.com/embed/abc123 here</body></html>' });
    if (u === 'https://vidmixi.com/embed/abc123') return response({ text: `<script>bePlayer('${password}', '${setJson.replace(/\\/g, '\\\\')}');</script>` });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(550, 'movie', null, null);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/dizifilmizle.m3u8');
  assert.equal(streams[0].provider, 'castsinema-dizifilmizle');
});

test('Dizilla provider finds episode via slug/search and extracts pichive master stream', async () => {
  const provider = await loadProvider('providers/castsinema-dizilla.js', async (url) => {
    const u = String(url);
    if (u.includes('/tv/1396')) return response({ json: { name: 'Breaking Bad', original_name: 'Breaking Bad' } });
    if (u.includes('/ara?q=')) return response({ text: '<a href="/dizi/breaking-bad">Breaking Bad</a>' });
    if (u === 'https://dizilla.la/dizi/breaking-bad') return response({ text: '<a href="/breaking-bad-1-sezon-1-bolum">S1E1</a>' });
    if (u === 'https://dizilla.la/breaking-bad-1-sezon-1-bolum') return response({ text: '<script>var src="https://four.pichive.online/iframe.php?v=abc";</script>' });
    if (u === 'https://four.pichive.online/iframe.php?v=abc') return response({ text: '<script>var NP_CONFIG = {"sources":[{"kind":"sub","master":"https://cdn.pichive.online/nm.php?id=1"}],"subtitles":[{"label":"Türkçe","lang":"tr","url":"https://cdn.pichive.online/nsub.php?id=1"}]};</script>' });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(1396, 'tv', 1, 1);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.pichive.online/nm.php?id=1');
  assert.equal(streams[0].format, 'm3u8');
  assert.equal(streams[0].headers.Referer, 'https://four.pichive.online/iframe.php?v=abc');
  assert.equal(streams[0].headers['User-Agent'], 'okhttp/4.9.2');
  assert.equal(streams[0].provider, 'castsinema-dizilla');
});
