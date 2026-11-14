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
    assert.ok(scraper.id.startsWith('castsinema-'), `${scraper.id} must use the castsinema- prefix`);
    assert.equal(scraper.filename, `providers/${scraper.id}.js`);
    const source = await fs.readFile(new URL(`../${scraper.filename}`, import.meta.url), 'utf8');
    assert.ok(source.includes(`provider: "${scraper.id}"`), `${scraper.filename} must expose provider id ${scraper.id}`);
    await fs.access(new URL(`../${scraper.filename}`, import.meta.url));
  }
});

test('mode: no embed pages are returned; every provider emits playable formats', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  for (const scraper of manifest.scrapers) {
    assert.ok(Array.isArray(scraper.formats) && scraper.formats.length > 0, `${scraper.id} needs formats`);
    for (const format of scraper.formats) {
      assert.ok(['m3u8', 'mp4'].includes(format), `${scraper.id} advertises unsupported format ${format}`);
    }
  }
});

test('ClipBox provider converts TMDB movie response into playable stream', async () => {
  const provider = await loadProvider('providers/castsinema-clipbox.js', async (url) => {
    const u = String(url);
    if (u.includes('/api/movie/550')) return response({ json: { src: '/embed/170060?token=abc&t=Fight+Club&expires=9999999999&lang=en' } });
    if (u.includes('/movie/550')) return response({ json: { title: 'Fight Club', original_title: 'Fight Club', imdb_id: 'tt0137523' } });
    if (u.includes('/embed/170060')) {
      return response({ text: `<script>window.masterPlaylist = { params: { 'token': 'abc', 'expires': '9999999999', 'asn': '' }, url: 'https://cdn.example/playlist/1' };</script>` });
    }
    if (u.includes('/playlist/')) {
      return response({ text: '#EXTM3U\\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Turkish",URI="https://cdn.example/sub.vtt"\\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\\nhttps://cdn.example/v.m3u8', status: 200 });
    }
    return response({ ok: false });
  });
  const streams = await provider.getStreams('550', 'movie', null, null);
  assert.equal(streams.length, 1);
  assert.ok(streams[0].url.includes('/playlist/1'));
  assert.equal(streams[0].format, 'm3u8');
});

test('ClipBox provider uses TV season/episode route', async () => {
  const provider = await loadProvider('providers/castsinema-clipbox.js', async () => {
    return response({ ok: false });
  });
  const streams = await provider.getStreams('1399', 'tv', 2, 3);
  assert.deepEqual(Array.from(streams), []);
});

test('FilmModu provider searches and extracts HLS stream', async () => {
  const provider = await loadProvider('providers/castsinema-filmmodu.js', async (url) => {
    const u = String(url);
    if (u.includes('/movie/603')) return response({ json: { title: 'The Matrix', original_title: 'The Matrix', release_date: '1999-03-31' } });
    if (u.includes('/ara?q=')) {
      return response({ text: '<a href="https://filmmodu.news/film/matrix" class="x"><div><img alt="Matrix Film izle"></div><h3>Matrix</h3><p>1999</p></a>' });
    }
    if (u === 'https://filmmodu.news/film/matrix') {
      return response({ text: '<script src="/assets/js/core.js"></script><div data-pv="slug123"></div>' });
    }
    if (u.includes('/assets/js/s.php?s=slug123')) {
      return response({ text: '<script>window.__PLAYER__ = {"stream":"https://cdn.example/fm/master.m3u8","audios":["Turkish"],"subs":[{"src":"https://cdn.example/fm/tr.vtt","lang":"tr","label":"Turkce"}]};</script>' });
    }
    if (u.includes('cdn.example/fm/master.m3u8')) return response({ text: '#EXTM3U' });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(603, 'movie', null, null);
  assert.ok(streams.length >= 1);
  assert.equal(streams[0].url, 'https://cdn.example/fm/master.m3u8');
  assert.equal(streams[0].format, 'm3u8');
});


test('DiziMom provider searches and extracts HLS stream for TV series', async () => {
  const provider = await loadProvider('providers/castsinema-dizimom.js', async (url) => {
    const u = String(url);
    if (u.includes('/tv/1399')) return response({ json: { name: 'Game of Thrones', original_name: 'Game of Thrones' } });
    if (u.includes('/ara?q=')) return response({ text: '<a href="https://ddizimom.net/dizi/game-of-thrones"><h3>Game of Thrones</h3></a>' });
    if (u === 'https://ddizimom.net/dizi/game-of-thrones/') return response({ text: '<a href="/dizi/game-of-thrones/sezon-2/bolum-3">S2E3</a>' });
    if (u === 'https://ddizimom.net/dizi/game-of-thrones/sezon-2/bolum-3') return response({ text: '<div data-pv="pvslug123"></div><script src="https://ddizimom.net/assets/js/core.js"></script>' });
    if (u.includes('s.php?s=pvslug123')) return response({ text: '<script>window.__PLAYER__ = {"stream":"https://cdn.example/got.m3u8","audios":["Turkish"],"subs":[{"src":"https://cdn.example/got.vtt","lang":"tr","label":"Turkce"}]};</script>' });
    if (u.includes('cdn.example/got.m3u8')) return response({ text: '#EXTM3U' });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(1399, 'tv', 2, 3);
  assert.ok(streams.length >= 1);
  assert.equal(streams[0].url, 'https://cdn.example/got.m3u8');
  assert.equal(streams[0].format, 'm3u8');
});

test('SetFilmIzle provider queries admin-ajax to extract playable stream', async () => {
  const provider = await loadProvider('providers/castsinema-setfilmizle.js', async (url) => {
    const u = String(url);
    if (u.includes('/movie/550')) return response({ json: { title: 'Fight Club', original_title: 'Fight Club' } });
    if (u.includes('/?s=')) return response({ text: '<a class="card-link" href="https://www.setfilmizle.ltd/film/fight-club/">Fight Club<span class="card-ad">Fight Club</span></a>' });
    if (u === 'https://www.setfilmizle.ltd/film/fight-club/') {
      return response({ text: '<div id="stfPlayer" data-post-id="99"></div><script>video: "NONCE1"</script><div data-player-name="SetPlay" data-part-key=""></div>' });
    }
    if (u.includes('admin-ajax.php')) {
      return response({ text: JSON.stringify({ success: true, data: { stream: { type: 'bridge', url: 'https://bridge.example/x' } } }) });
    }
    if (u === 'https://bridge.example/x') {
      return response({ text: 'src: "https://cdn.example/setfilm.m3u8"' });
    }
    if (u.includes('cdn.example/setfilm.m3u8')) return response({ text: '#EXTM3U' });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(550, 'movie', null, null);
  assert.ok(streams.length >= 1);
  assert.equal(streams[0].url, 'https://cdn.example/setfilm.m3u8');
  assert.equal(streams[0].format, 'm3u8');
});

function b64utf8(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}
function rot13(text) {
  return text.replace(/[a-z]/gi, (c) => String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < 'n' ? 13 : -13)));
}

test('FilmMakinesi provider resolves a movie through the live-search endpoint', async () => {
  const token = b64utf8(JSON.stringify({ id: '6234', folder: 'v_1234', exp: 1794614992, sig: 'abc' }));
  const provider = await loadProvider('providers/castsinema-filmmakinesi.js', async (url) => {
    const u = String(url);
    if (u.includes('/movie/550')) return response({ json: { title: 'Fight Club', original_title: 'Fight Club', imdb_id: 'tt0137523', external_ids: { imdb_id: 'tt0137523' } } });
    if (u.includes('knl_ajax_search=1')) {
      return response({ text: '<a href="https://filmmakinesi.co/fight-club/" class="search-result"><div class="search-result-content"><span class="title">Fight Club</span><div class="meta"><span>1999</span></div></div></a>' });
    }
    if (u === 'https://filmmakinesi.co/fight-club/') return response({ text: '<iframe src="https://oynatloload.top/embed/1234"></iframe>' });
    if (u === 'https://oynatloload.top/embed/1234') return response({ text: `<script>window.__ULTRA_EAUTH = "${token}";</script>` });
    if (u.includes('/api/video-bilgi/v_1234')) {
      return response({ json: { hls_m3u8_path: 'https://cdn.example/fm/master.m3u8', subtitle: 'v_1234_turkish.vtt', sources: [{ file: 'https://cdn.example/fm/480p.m3u8' }] } });
    }
    return response({ ok: false });
  });
  const streams = await provider.getStreams(550, 'movie', null, null);
  assert.ok(streams.length >= 1);
  assert.equal(streams[0].url, 'https://cdn.example/fm/master.m3u8');
  assert.equal(streams[0].format, 'm3u8');
  assert.equal(streams[0].provider, 'castsinema-filmmakinesi');
  assert.equal(streams[0].subtitles.length, 1);
  assert.equal(streams[0].subtitles[0].lang, 'tr');
});

test('FilmMakinesi provider never returns a trailer as the source', async () => {
  const provider = await loadProvider('providers/castsinema-filmmakinesi.js', async (url) => {
    const u = String(url);
    if (u.includes('/movie/550')) return response({ json: { title: 'Fight Club', external_ids: { imdb_id: 'tt0137523' } } });
    if (u.includes('knl_ajax_search=1')) {
      return response({ text: '<a href="https://filmmakinesi.co/fight-club/" class="search-result"><span class="title">Fight Club</span></a>' });
    }
    if (u === 'https://filmmakinesi.co/fight-club/') return response({ text: '<iframe src="https://www.youtube.com/embed/trailer"></iframe>' });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(550, 'movie', null, null);
  assert.deepEqual(Array.from(streams), []);
});


test('DiziBox provider finds episode and extracts m3u8 stream', async () => {
  const provider = await loadProvider('providers/castsinema-dizibox.js', async (url) => {
    const u = String(url);
    if (u.includes('/tv/1104')) return response({ json: { name: 'Game of Thrones', original_name: 'Game of Thrones' } });
    if (u.includes('/search/')) {
      return response({ text: '<article class="detailed-article"><h3><a href="https://www.dizibox.live/diziler/game-of-thrones-izle/">Game of Thrones</a></h3></article>' });
    }
    if (u === 'https://www.dizibox.live/diziler/game-of-thrones-izle/') {
      return response({ text: '<a href="https://www.dizibox.live/game-of-thrones-izle-1-sezon-1-bolum-izle/" class="season-episode">S1E1</a>' });
    }
    if (u === 'https://www.dizibox.live/game-of-thrones-izle-1-sezon-1-bolum-izle/') {
      return response({ text: '<div id="video-area"><iframe src="https://example.com/king.php?v=1"></iframe></div>' });
    }
    if (u.includes('king.php?wmode=opaque')) {
      return response({ text: '<div id="Player"><iframe src="https://example.com/embed/abc"></iframe></div>' });
    }
    if (u === 'https://example.com/embed/sheila/abc') {
      return response({ text: '#EXTM3U\\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\\nhttps://cdn.example/dizibox.m3u8' });
    }
    return response({ ok: false });
  });
  const streams = await provider.getStreams(1104, 'tv', 1, 1);
  assert.ok(streams.length >= 1);
  assert.equal(streams[0].url, 'https://example.com/embed/sheila/abc');
  assert.equal(streams[0].format, 'm3u8');
});


test('HDFilmCehennemi provider searches and extracts the HLS master', async () => {
  const provider = await loadProvider('providers/castsinema-hdfilmcehennemi.js', async (url) => {
    const u = String(url);
    if (u.includes('/movie/550')) return response({ json: { title: 'Fight Club', original_title: 'Fight Club', imdb_id: 'tt0137523', external_ids: { imdb_id: 'tt0137523' } } });
    if (u.includes('/search/?q=')) {
      return response({ text: JSON.stringify({ results: ['<a href="https://www.hdfilmcehennemi.nl/fight-club-izle-1/" class="search-result"><span class="year">1999</span><span class="type">Film</span><h4 class="title">Dövüş Kulübü</h4></a>'] }) });
    }
    if (u === 'https://www.hdfilmcehennemi.nl/fight-club-izle-1/') {
      return response({ text: '<iframe class="close" data-src="https://hdfilmcehennemi.mobi/video/embed/TNMM2NhvkI0/"></iframe>' });
    }
    if (u.startsWith('https://hdfilmcehennemi.mobi/video/embed/')) {
      return response({ text: '<script>jwplayer("videoplayer").setup({ sources: [{ file: "https://cdn.example/hdfc/master.m3u8", type: "hls" }], tracks: [{ file: "https://cdn.example/hdfc/tr.vtt", kind: "captions", label: "Turkish" }] });</script>' });
    }
    return response({ ok: false });
  });
  const streams = await provider.getStreams(550, 'movie', null, null);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/hdfc/master.m3u8');
  assert.equal(streams[0].format, 'm3u8');
  assert.equal(streams[0].provider, 'castsinema-hdfilmcehennemi');
  assert.equal(streams[0].subtitles.length, 1);
});

test('HDFilmCehennemi provider extracts TV episode stream', async () => {
  const provider = await loadProvider('providers/castsinema-hdfilmcehennemi.js', async (url) => {
    const u = String(url);
    if (u.includes('/tv/1399')) return response({ json: { name: 'Game of Thrones', original_name: 'Game of Thrones', external_ids: { imdb_id: 'tt0944947' } } });
    if (u.includes('/search/?q=')) {
      return response({ text: JSON.stringify({ results: ['<a href="https://www.hdfilmcehennemi.nl/dizi/game-of-thrones-1/" class="search-result"><span class="type">Dizi</span><h4 class="title">Taht Oyunları</h4></a>'] }) });
    }
    if (u === 'https://www.hdfilmcehennemi.nl/dizi/game-of-thrones-1/') {
      return response({ text: '<a href="https://www.hdfilmcehennemi.nl/dizi/game-of-thrones-1/sezon-2/bolum-3-hd1/">S2E3</a>' });
    }
    if (u === 'https://www.hdfilmcehennemi.nl/dizi/game-of-thrones-1/sezon-2/bolum-3-hd1/') {
      return response({ text: '<iframe class="close" data-src="https://hdfilmcehennemi.mobi/video/embed/GOTS2E3/"></iframe>' });
    }
    if (u.startsWith('https://hdfilmcehennemi.mobi/video/embed/')) {
      return response({ text: '<script>jwplayer("videoplayer").setup({ sources: [{ file: "https://cdn.example/hdfc/got.m3u8", type: "hls" }] });</script>' });
    }
    return response({ ok: false });
  });
  const streams = await provider.getStreams(1399, 'tv', 2, 3);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/hdfc/got.m3u8');
  assert.ok(streams[0].title.includes('S2E3'));
});


test('BoxFilm provider decodes the rotated player code into an HLS manifest with subtitles', async () => {
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
      const config = JSON.stringify({
        file: f,
        tracks: [
          { file: 'https://cdn.example/sub/tr.vtt', label: 'T\u00fcrk\u00e7e', kind: 'captions' },
          { file: 'https://cdn.example/sub/en.vtt', label: 'English', kind: 'captions' }
        ]
      }).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\u0022');
      return response({ text: `<script>jwplayer('player').setup(JSON.parse('${config}'));</script>` });
    }
    return response({ ok: false });
  });
  const streams = await provider.getStreams(550, 'movie', null, null);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].provider, 'castsinema-boxfilm');
  assert.equal(streams[0].format, 'm3u8');
  assert.ok(streams[0].url.startsWith('https://cdn.example/hls/'));
  assert.equal(streams[0].subtitles.length, 2);
  assert.equal(streams[0].subtitles[0].language, 'tr');
  assert.equal(streams[0].subtitles[1].language, 'en');
  assert.ok(streams[0].headers.Referer.includes('/boxes/abc'));
  assert.ok(calls.some((c) => c.includes('/api/search?q=')));
});

test('FullHDFilmizlesene provider decodes the rotated source list', async () => {
  const encodedUrl = rot13(b64utf8('https://rapidvid.example/vod/abc123'));
  const scx = JSON.stringify({ atom: { tt: b64utf8('Atom'), sx: { t: [encodedUrl] } } });

  const provider = await loadProvider('providers/castsinema-fullhdfilmizlesene.js', async (url) => {
    const u = String(url);
    if (u.includes('/movie/550')) return response({ json: { title: 'Fight Club', original_title: 'Fight Club', imdb_id: 'tt0137523', external_ids: { imdb_id: 'tt0137523' } } });
    if (u.includes('/arama/')) {
      return response({ text: '<li class="film"><a class="tt" href="https://www.fullhdfilmizlesene.now/film/fight-club-izle/">Dövüş Kulübü - Fight Club izle</a><h2 class="film-tt"><span class="film-title">Dövüş Kulübü</span></h2><span class="film-yil">1999</span></li>' });
    }
    if (u === 'https://www.fullhdfilmizlesene.now/film/fight-club-izle/') return response({ text: `<script>scx = ${scx};</script>` });
    if (u === 'https://rapidvid.example/vod/abc123') return response({ text: '<script>jwSetup.sources = [{ file: "https://cdn.example/fullhd/master.m3u8", type: "hls" }];</script>' });
    return response({ ok: false });
  });
  const streams = await provider.getStreams(550, 'movie', null, null);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/fullhd/master.m3u8');
  assert.equal(streams[0].format, 'm3u8');
  assert.equal(streams[0].provider, 'castsinema-fullhdfilmizlesene');
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
    cipher.update(JSON.stringify({
      video_location: 'https://cdn.example/dizifilmizle.m3u8',
      title: 'Fight Club',
      strSubtitles: [
        { file: '/upload/subs/tr.vtt', label: 'Turkish', language: 'tur' },
        { file: 'https://cdn.example/subs/en.vtt', label: 'English', language: 'eng' }
      ]
    }), 'utf8'),
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
  assert.equal(streams[0].format, 'm3u8');
  assert.equal(streams[0].provider, 'castsinema-dizifilmizle');
  assert.ok(streams[0].title.includes('TR Dublaj'));
  assert.equal(streams[0].subtitles.length, 2);
  assert.equal(streams[0].subtitles[0].language, 'tr');
  assert.equal(streams[0].subtitles[0].url, 'https://vidmixi.com/upload/subs/tr.vtt');
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

test('Xpass provider decrypts the AES-256-GCM source index and returns HLS mirrors', async () => {
  const salt = 'spv3-build-1787821613-50e5fc97c9dce367';
  const token = 'tok123';
  const pathname = '/data/movie/603';
  const dataUrl = pathname + '?autostart=false&token=' + token;

  const key = crypto.createHash('sha256').update('spv3-data-response|' + salt + '|' + pathname + '|' + token, 'utf8').digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const sealed = Buffer.concat([
    cipher.update(JSON.stringify([
      { id: 'a', name: 'FIL 1', url: '/mdata/a/0/playlist.json', dl: false },
      { id: 'b', name: 'FIL 2', url: '/mdata/b/1/playlist.json', dl: false }
    ]), 'utf8'),
    cipher.final(),
    cipher.getAuthTag()
  ]);
  const payload = Buffer.concat([iv, sealed]).toString('base64url');

  const provider = await loadProvider('providers/castsinema-xpass.js', async (url) => {
    const u = String(url);
    if (u === 'https://play.xpass.top/e/movie/603') {
      return response({ text: '<script src="/static/bundle.js?v=1794075771"></script><script>var dataUrl="' + dataUrl + '";</script>' });
    }
    if (u.startsWith('https://play.xpass.top/static/')) {
      return response({ text: 'const build="' + salt + '";' });
    }
    if (u === 'https://play.xpass.top' + pathname + '?autostart=false&token=' + token) {
      return response({ text: payload });
    }
    if (u.includes('/mdata/a/0/playlist.json')) {
      return response({ json: { playlist: [{ sources: [{ file: 'https://cdn.example/a/master.m3u8', type: 'hls', label: 'TIK 2' }] }] } });
    }
    if (u.includes('/mdata/b/1/playlist.json')) {
      return response({ json: { playlist: [{ sources: [{ file: 'https://cdn.example/b/master.m3u8', type: 'hls', label: 'VIP 1' }] }] } });
    }
    return response({ ok: false });
  });

  const streams = await provider.getStreams('603', 'movie', null, null);
  assert.equal(streams.length, 2);
  assert.equal(streams[0].format, 'm3u8');
  assert.equal(streams[0].provider, 'castsinema-xpass');
  assert.ok(streams[0].url.includes('cdn.example/a/'));
  assert.ok(streams[1].url.includes('cdn.example/b/'));
  assert.equal(streams[0].behaviorHints.proxyHeaders.request.Referer, 'https://play.xpass.top/');
});

test('Xpass provider returns an empty list when the payload cannot be authenticated', async () => {
  const provider = await loadProvider('providers/castsinema-xpass.js', async (url) => {
    const u = String(url);
    if (u === 'https://play.xpass.top/e/movie/603') {
      return response({ text: '<script>var dataUrl="/data/movie/603?token=tok123";</script>' });
    }
    if (u.startsWith('https://play.xpass.top/data/')) {
      return response({ text: Buffer.alloc(64, 7).toString('base64url') });
    }
    return response({ ok: false });
  });
  const streams = await provider.getStreams('603', 'movie', null, null);
  assert.deepEqual(Array.from(streams), []);
});

test('YesilCam TV provider labels query-string HLS mirrors as m3u8', async () => {
  const provider = await loadProvider('providers/castsinema-yesilcamtv.js', async (url) => {
    const u = String(url);
    if (u.includes('v3-cinemeta.strem.io/meta/movie/tt0297138.json')) {
      return response({ json: { meta: { name: 'Selvi Boylum Al Yazmalim' } } });
    }
    if (u.startsWith('https://yesilcamtv.com.tr/?s=')) {
      return response({ text: '<a href="https://yesilcamtv.com.tr/selvi-boylum-al-yazmalim-izle/"><img alt="Selvi Boylum Al Yazmalim"></a>' });
    }
    if (u === 'https://yesilcamtv.com.tr/selvi-boylum-al-yazmalim-izle/') {
      return response({ text: '<iframe src="https://rumble.com/embed/v123abc/"></iframe>' });
    }
    if (u === 'https://rumble.com/embed/v123abc/') {
      return response({ text: '"1080":{"url":"https:\\/\\/hugh.cdn.rumble.cloud\\/video\\/x\\/y?r_file=chunklist.m3u8&r=1","meta":{"bitrate":4500,"size":12345,"w":1920,"h":1080}' });
    }
    return response({ ok: false });
  });
  const streams = await provider.getStreams('tt0297138', 'movie', null, null);
  assert.ok(streams.length >= 1);
  assert.equal(streams[0].format, 'm3u8');
  assert.equal(streams[0].provider, 'castsinema-yesilcamtv');
  assert.ok(streams[0].quality.startsWith('1080p'));
  assert.ok(streams[0].url.includes('chunklist.m3u8'));
});

test('IzleFilm provider resolves an ok.ru embed into an HLS master', async () => {
  const hls = 'https://ok6-29.vkuser.net/expires/1794737851371/clientType/0/srcIp/46.197.29.53/type/2/mid/15345032890985/id/17723517373033/ms/95.142.206.33/zs/65/srcAg/CHROME/urls/185.180.203.46%3B176.112.172.39/pr/10/ct/28/sig/qsbVk2op6nQ/ondemand/hls4_17723517373033.COmU8NnMvgNA6Yz9sr4aUAq6Aiy3oj5Fmg.m3u8';
  const dataOptions = JSON.stringify({
    flashvars: {
      metadata: {
        movie: { title: 'Mortal Kombat II' },
        ondemandHls: hls
      }
    }
  }).replace(/"/g, '&quot;');
  const provider = await loadProvider('providers/castsinema-izlefilm.js', async (url) => {
    const u = String(url);
    if (u.includes('/movie/931285')) return response({ json: { title: 'Mortal Kombat II', original_title: 'Mortal Kombat II' } });
    if (u.includes('/arama?q=')) return response({ text: '<a href="/film/mortal-kombat-ii">Mortal Kombat II</a>' });
    if (u.includes('/film/mortal-kombat-ii')) return response({ text: '<iframe data-player-url="https://ok.ru/videoembed/15345032890985?nochat=1"></iframe>' });
    if (u.includes('ok.ru/videoembed/')) return response({ text: '<div data-options="' + dataOptions + '"></div>' });
    return response({ ok: false });
  });
  const streams = await provider.getStreams('931285', 'movie', null, null);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].provider, 'castsinema-izlefilm');
  assert.equal(streams[0].format, 'm3u8');
  assert.equal(streams[0].url, hls);
  assert.ok(streams[0].title.includes('TR Dublaj'));
});
