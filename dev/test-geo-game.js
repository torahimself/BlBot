'use strict';
// Photo + country game (.جيو) — offline tests with fake HTTP (Mapillary / Wikimedia).
// Run: node dev/test-geo-game.js
process.env.BL_ECONOMY_DB = ':memory:';
delete process.env.MAPILLARY_TOKEN;
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const db = require(path.join(root, 'utils/economy/database.js'));
const dbx = require(path.join(root, 'utils/economy/engine/dbx.js'));
const { getBalance } = require(path.join(root, 'utils/economy/shopManager.js'));
const cfg = require(path.join(root, 'utils/games/config.js'));
const countries = require(path.join(root, 'utils/games/countries.js'));
const { GEO } = require(path.join(root, 'utils/games/geoPoints.js'));
const games = require(path.join(root, 'utils/games/index.js'));
const session = require(path.join(root, 'utils/games/session.js'));
const geo = require(path.join(root, 'utils/games/geo.js'));
const photos = require(path.join(root, 'utils/games/geoPhotos.js'));
const guessMod = require(path.join(root, 'utils/games/geoGuess.js'));
const score = require(path.join(root, 'utils/games/geoScore.js'));
const geoMap = require(path.join(root, 'utils/games/geoMap.js'));

cfg.channels = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let mid = 0;
function mkChannel(id = 'gch' + (++mid)) {
  const sent = [];
  const mk = (c) => { const m = { id: 'm' + (++mid), ...(typeof c === 'string' ? { content: c } : c), edit: async (x) => { Object.assign(m, x); return m; }, react: async () => {}, reply: async () => {}, delete: async () => { m.deleted = true; } }; sent.push(m); return m; };
  return { id, sent, send: async (c) => mk(c), isTextBased: () => true };
}
function mkMessage(ch, userId, content) {
  const replies = [], reacts = [];
  return { author: { id: userId, bot: false, username: userId }, guild: { id: 'g' }, channel: ch, member: { displayName: userId }, content, replies, reacts,
    reply: async (c) => { replies.push(c); return { delete: async () => {} }; }, react: async (e) => { reacts.push(e); } };
}
const click = (userId, s, action) => games.handleInteraction({ customId: `pg:${s.id}:${action}`, user: { id: userId, username: userId }, member: { displayName: userId }, replies: [], reply: async () => {}, deferUpdate: async () => {} });
async function setBal(id, v) { await dbx.run('INSERT INTO users (userId, balance) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET balance = ?', [id, v, v]); }
const bal = (id) => getBalance(id);

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); } }

// ── fake network ─────────────────────────────────────────────────────────────
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const PARIS = { lat: 48.8566, lon: 2.3522 };   // = wherever the last search was (router updates it) so photos are always 'in' the searched country
const wikiPage = (n, over = {}) => ({ pageid: 100 + n, title: `File:Street ${n}.jpg`, coordinates: [{ lat: PARIS.lat, lon: PARIS.lon }],
  imageinfo: [{ thumburl: `https://upload.example/${n}.jpg`, mime: 'image/jpeg', width: 1600, height: 1000 }], ...over });
const mlyPhoto = (n) => ({ id: 'img' + n, thumb_1024_url: `https://cdn.example/${n}.jpg`, computed_geometry: { type: 'Point', coordinates: [PARIS.lon, PARIS.lat] }, captured_at: 1 });
const PLACES = { london: [51.5072, -0.1276, 'لندن', 'المملكة المتحدة'], 'نيويورك': [40.7128, -74.006, 'نيويورك', 'الولايات المتحدة'], jeddah: [21.5433, 39.1728, 'جدة', 'السعودية'], 'جدة': [21.5433, 39.1728, 'جدة', 'السعودية'] };

function router({ wiki, mly, meteo, nom } = {}) {
  const calls = [];
  const f = async (url) => {
    const u = new URL(url); calls.push(url);
    if (u.host === 'graph.mapillary.com' && u.searchParams.get('bbox')) { const b = u.searchParams.get('bbox').split(',').map(Number); PARIS.lon = (b[0] + b[2]) / 2; PARIS.lat = (b[1] + b[3]) / 2; }
    if (u.host === 'commons.wikimedia.org' && u.searchParams.get('ggscoord')) { const c = u.searchParams.get('ggscoord').split('|').map(Number); PARIS.lat = c[0]; PARIS.lon = c[1]; }
    if (u.host === 'graph.mapillary.com') return mly ? mly(u) : json({}, 500);
    if (u.host === 'commons.wikimedia.org') return json(wiki ? wiki(u) : { query: { pages: [wikiPage(1), wikiPage(2)] } });
    if (u.host === 'geocoding-api.open-meteo.com') {
      if (meteo) return meteo(u);
      const p = PLACES[u.searchParams.get('name').toLowerCase()];
      return json(p ? { results: [{ name: p[2], latitude: p[0], longitude: p[1], country: p[3], country_code: 'XX', population: 1e6 }] } : {});
    }
    if (u.host === 'nominatim.openstreetmap.org') return nom ? nom(u) : json([]);
    throw new Error('unexpected host ' + u.host);
  };
  f.calls = calls;
  return f;
}
const hostCalls = (f, host) => f.calls.filter(u => new URL(u).host === host).length;

(async () => {
  await db.ready;
  const G = cfg.geo; const keep = { ...G, providers: [...G.providers] };
  Object.assign(G, { httpTimeoutMs: 2000 });

  console.log('Data');
  await t('every country has 1–3 points and an Arabic continent', () => {
    for (const c of countries.COUNTRIES) {
      const e = GEO[c.code];
      assert(e, 'missing ' + c.code);
      assert(e.points.length >= 1 && e.points.length <= 3, c.code + ' points');
      for (const [la, lo] of e.points) assert(Math.abs(la) <= 90 && Math.abs(lo) <= 180 && Number.isFinite(la + lo), c.code + ' coords');
      assert(e.continentAr && e.continentAr.length > 2, c.code + ' continent');
    }
    assert.strictEqual(Object.keys(GEO).length, countries.COUNTRIES.length);
  });
  await t('triggers .جيو .شارع .صورة (+bet) are recognised', () => {
    for (const w of ['.جيو', '.شارع', '.صورة']) assert.strictEqual(games.parseTrigger(w).type, 'geo');
    assert.strictEqual(games.parseTrigger('.جيو 300').bet, 300);
  });

  console.log('Distance scoring (max 40)');
  await t('haversine: Paris–London ≈ 344 km, Riyadh–Jeddah ≈ 850 km, same point 0', () => {
    assert(Math.abs(score.haversineKm(48.8566, 2.3522, 51.5072, -0.1276) - 344) < 5);
    assert(Math.abs(score.haversineKm(24.71, 46.68, 21.54, 39.17) - 850) < 25);
    assert.strictEqual(score.haversineKm(10, 10, 10, 10), 0);
  });
  await t('pinpoint = 40; 20–100 km = 38…35; farther = fewer; very far = 0', () => {
    assert.strictEqual(score.pointsFor(0), 40); assert.strictEqual(score.pointsFor(0.4), 40);
    assert.strictEqual(score.pointsFor(20), 38); assert.strictEqual(score.pointsFor(25), 38);
    assert.strictEqual(score.pointsFor(60), 37); assert.strictEqual(score.pointsFor(100), 35);
    assert.strictEqual(score.pointsFor(300), 28); assert.strictEqual(score.pointsFor(1000), 18);
    assert.strictEqual(score.pointsFor(2500), 8); assert.strictEqual(score.pointsFor(5000), 2);
    assert.strictEqual(score.pointsFor(8000), 0); assert.strictEqual(score.pointsFor(19000), 0);
  });
  await t('points never increase with distance (closest always scores most) and never exceed 40', () => {
    let prev = 41;
    for (let km = 0; km <= 20000; km += 0.5) { const p = score.pointsFor(km); assert(p <= prev && p <= 40 && p >= 0, `${km} km → ${p}`); prev = p; }
  });
  await t('distance text is Arabic: م below 1 km, كم above', () => {
    assert.strictEqual(score.formatKm(0.35), '350 م'); assert.strictEqual(score.formatKm(3.14), '3.1 كم'); assert.strictEqual(score.formatKm(1234.5), '1,235 كم');
  });

  console.log('Photo providers');
  await t('Mapillary box stays under 0.01° on each side (its API refuses larger ones)', () => {
    for (let i = 0; i < 200; i++) { const b = photos.bboxAround([30, 31], Math.random); assert(b[2] - b[0] < 0.01 && b[3] - b[1] < 0.01, 'bbox ' + b); }
    const u = new URL(photos.buildUrl('MLY|t', [1, 2, 1.008, 2.008]));
    assert.strictEqual(u.origin + u.pathname, 'https://graph.mapillary.com/images');
    assert.strictEqual(u.searchParams.get('access_token'), 'MLY|t'); assert.strictEqual(u.searchParams.get('bbox'), '1,2,1.008,2.008');
    assert.strictEqual(u.searchParams.get('fields'), 'id,thumb_1024_url,computed_geometry,captured_at');
  });
  await t('without a token Mapillary is skipped; Wikimedia photo comes with coordinates and credit', async () => {
    photos.resetHealth();
    const f = router(); geo.setFetch(f);
    const r = await photos.findPhoto();
    assert(r && r.image.source === 'wikimedia' && r.image.lat === PARIS.lat && /^https:\/\/upload\.example\//.test(r.image.url), JSON.stringify(r));
    assert(/Wikimedia/.test(r.credit)); assert(/commons\.wikimedia\.org\/wiki\/File:/.test(r.image.page));
    assert.strictEqual(hostCalls(f, 'graph.mapillary.com'), 0);
    const w = new URL(f.calls[0]).searchParams;
    assert.strictEqual(w.get('generator'), 'geosearch'); assert.strictEqual(w.get('ggsnamespace'), '6'); assert.strictEqual(w.get('iiurlwidth'), '1024');
    assert(GEO[r.country.code].points.some(([la, lo]) => Math.abs(Number(w.get('ggscoord').split('|')[0]) - la) <= G.jitterDeg + 1e-6 && Math.abs(Number(w.get('ggscoord').split('|')[1]) - lo) <= G.jitterDeg + 1e-6), 'searched around one of the country points');
  });
  await t('Wikimedia: maps, flags, drawings, tiny images and non-JPEGs are not used', async () => {
    photos.resetHealth();
    const bad = [
      wikiPage(1, { title: 'File:Map of Paris.jpg' }), wikiPage(2, { title: 'File:Flag of France.jpg' }), wikiPage(3, { title: 'File:Plan.svg' }),
      wikiPage(4, { imageinfo: [{ thumburl: 'https://u/4.png', mime: 'image/png', width: 2000, height: 1000 }] }),
      wikiPage(5, { imageinfo: [{ thumburl: 'https://u/5.jpg', mime: 'image/jpeg', width: 300, height: 200 }] }),
      wikiPage(6, { coordinates: undefined }),
    ];
    geo.setFetch(router({ wiki: () => ({ query: { pages: [...bad, wikiPage(7)] } }) }));
    const r = await photos.findPhoto(); assert.strictEqual(r.image.id, '107');
  });
  await t('Wikimedia: space, satellite and aerial images are never used (title, description or category)', async () => {
    photos.resetHealth();
    const meta = (desc, cats) => [{ thumburl: 'https://u/x.jpg', mime: 'image/jpeg', width: 1600, height: 1000, extmetadata: { ImageDescription: { value: desc }, Categories: { value: cats } } }];
    const bad = [
      wikiPage(1, { title: 'File:Nicaragua satellite image.jpg' }),
      wikiPage(2, { title: 'File:Managua from space.jpg' }),
      wikiPage(3, { title: 'File:IMG 123.jpg', imageinfo: meta('<b>Nicaragua seen from the ISS</b> by an astronaut', 'Nicaragua') }),
      wikiPage(4, { title: 'File:IMG 124.jpg', imageinfo: meta('A view', 'Photographs from space|Nicaragua') }),
      wikiPage(5, { title: 'File:Aerial view of Muscat.jpg' }),
      wikiPage(6, { title: 'File:Landsat 8 Lake Nicaragua.jpg' }),
      wikiPage(7, { title: 'File:Strip.jpg', imageinfo: [{ thumburl: 'https://u/s.jpg', mime: 'image/jpeg', width: 6000, height: 1000 }] }),   // panorama strip
    ];
    geo.setFetch(router({ wiki: () => ({ query: { pages: [...bad, wikiPage(8, { title: 'File:Corniche road.jpg', imageinfo: meta('A road along the sea', 'Roads in Oman') })] } }) }));
    const r = await photos.findPhoto(); assert.strictEqual(r.image.id, '108');
    geo.setFetch(router({ wiki: () => ({ query: { pages: bad } }) }));
    photos.resetHealth(); assert.strictEqual(await photos.findPhoto(), null, 'only unsuitable images → no photo rather than a bad one');
  });
  await t('a photo geotagged far from the place the round picked is thrown away', async () => {
    photos.resetHealth();
    geo.setFetch(router({ wiki: () => ({ query: { pages: [wikiPage(1, { coordinates: [{ lat: 0, lon: -150 }] }), wikiPage(2)] } }) }));
    const r = await photos.findPhoto(); assert.strictEqual(r.image.id, '102');
    geo.setFetch(router({ wiki: () => ({ query: { pages: [wikiPage(1, { coordinates: [{ lat: 0, lon: -150 }] })] } }) }));
    photos.resetHealth(); assert.strictEqual(await photos.findPhoto(), null);
  });
  await t('with a token: Mapillary first; photo carries its own coordinates', async () => {
    process.env.MAPILLARY_TOKEN = 'MLY|test|token'; photos.resetHealth();
    const f = router({ mly: () => json({ data: [mlyPhoto(1), mlyPhoto(2)] }) }); geo.setFetch(f);
    const r = await photos.findPhoto();
    assert(r.image.source === 'mapillary' && /^https:\/\/cdn\.example\//.test(r.image.url) && r.image.lat === PARIS.lat && /Mapillary/.test(r.credit));
    assert.strictEqual(hostCalls(f, 'commons.wikimedia.org'), 0, 'Wikimedia not needed');
  });
  await t('Mapillary HTTP 500 (the owner\'s error) → the same round falls back to Wikimedia; no failed round', async () => {
    photos.resetHealth();
    const f = router({ mly: () => json({}, 500) }); geo.setFetch(f);
    const r = await photos.findPhoto();
    assert(r && r.image.source === 'wikimedia'); assert.strictEqual(hostCalls(f, 'graph.mapillary.com'), 1);
  });
  await t('a provider that fails twice in a row is parked: no more slow calls to it', async () => {
    photos.resetHealth();
    const f = router({ mly: () => json({}, 500), wiki: () => ({ query: { pages: [] } }) }); geo.setFetch(f);
    assert.strictEqual(await photos.findPhoto(), null);          // all attempts empty
    assert.strictEqual(hostCalls(f, 'graph.mapillary.com'), 2, 'tried twice, then parked');
    assert(photos.parked('mapillary'));
    photos.resetHealth();
  });
  await t('network exception on one provider is survived; all providers down → null', async () => {
    photos.resetHealth();
    const rt = router(); geo.setFetch(async (url) => { if (/mapillary/.test(url)) throw new Error('boom'); return rt(url); });
    assert((await photos.findPhoto()).image.source === 'wikimedia');
    photos.resetHealth();
    geo.setFetch(async () => { throw new Error('offline'); });
    assert.strictEqual(await photos.findPhoto(), null);
    photos.resetHealth();
  });
  await t('already-used countries are not picked again', async () => {
    photos.resetHealth(); geo.setFetch(router());
    const used = new Set(countries.COUNTRIES.map(c => c.code)); used.delete('JP');
    assert.strictEqual((await photos.findPhoto({ used })).country.code, 'JP');
  });
  delete process.env.MAPILLARY_TOKEN;

  console.log('Reading a guess (countries only)');
  const code = (x) => { const c = guessMod.parseGuess(x); return c && c.code; };
  await t('no country name is shared by two countries', () => { assert.deepStrictEqual(guessMod.CLASHES, []); });
  await t('Germany in Arabic and English, with harmless spelling differences', () => {
    for (const x of ['ألمانيا', 'المانيا', 'ألمانيا.', ' Germany ', 'germany', 'GERMANY', 'الدولة ألمانيا', "it's Germany", 'the country is Germany']) assert.strictEqual(code(x), 'DE', x);
  });
  await t('Oman is Oman — never Jordan because of Amman', () => {
    for (const x of ['عمان', 'عُمان', 'سلطنة عمان', 'Oman', 'أعتقد أنها عمان']) assert.strictEqual(code(x), 'OM', x);
    assert.strictEqual(code('الأردن'), 'JO'); assert.strictEqual(code('Jordan'), 'JO');
    assert.strictEqual(code('Amman'), null, 'the capital in English is not a guess');
  });
  await t('capitals alone are not guesses', () => {
    for (const x of ['برلين', 'Berlin', 'باريس', 'Paris', 'مسقط', 'Muscat', 'الرياض', 'Tokyo']) assert.strictEqual(code(x), null, x);
  });
  await t('conversation, questions and random text are not guesses', () => {
    for (const x of ['شكلها اوروبا', 'ما أدري', 'مدري', 'هههههه', 'هذي ألمانيا ولا فرنسا؟', 'is it germany?', 'ألمانيا؟', 'شفت ألمانيا مرة وكانت حلوة',
      'I think the street looks like germany but not sure', 'asdfgh', '😂', '', 'ا', 'https://germany.example']) assert.strictEqual(code(x), null, x);
  });
  await t('common aliases work', () => {
    assert.strictEqual(code('السعودية'), 'SA'); assert.strictEqual(code('Saudi Arabia'), 'SA'); assert.strictEqual(code('USA'), 'US');
    assert.strictEqual(code('الولايات المتحدة'), 'US'); assert.strictEqual(code('بريطانيا'), 'GB'); assert.strictEqual(code('UK'), 'GB');
  });
  await t('a country pin is on that country (its first listed city)', () => {
    const de = guessMod.parseGuess('Germany'); const pin = guessMod.pinOf(de);
    assert(pin.code === 'DE' && Math.abs(pin.lat - GEO.DE.points[0][0]) < 1e-9 && /ألمانيا/.test(pin.label));
  });

  console.log('Result map');
  await t('renders a PNG with the real spot and numbered pins (when the canvas module is present)', () => {
    if (!geoMap.canvas()) return console.log('    (canvas module not installed — skipped)');
    const png = geoMap.render(PARIS, [{ lat: 48.9, lon: 2.4 }, { lat: 51.5, lon: -0.1 }, { lat: 40.7, lon: -74 }]);
    assert(Buffer.isBuffer(png) && png.slice(0, 4).toString('hex') === '89504e47' && png.length > 5000);
    assert(geoMap.render(PARIS, []) !== undefined);
  });
  await t('view always contains every pin and never exceeds the world', () => {
    const v = geoMap.viewFor([{ lat: -80, lon: -170 }, { lat: 80, lon: 170 }]);
    assert(v.k > 0 && v.x0 >= -180 && v.y1 <= 90);
    const z = geoMap.viewFor([{ lat: 24.71, lon: 46.68 }]); assert(z.k * 360 > 960, 'zoomed in for a single point');
  });

  // ── full games ──────────────────────────────────────────────────────────────
  console.log('Without a token');
  await t('default setup works without any token (Wikimedia); Mapillary-only without a token shows the Arabic notice', async () => {
    assert(geo.isConfigured());
    G.providers = ['mapillary'];
    assert(!geo.isConfigured());
    const ch = mkChannel(); const m = mkMessage(ch, 'A', '.جيو');
    await games.handleMessage(m);
    assert(!session.sessionInChannel(ch.id), 'no lobby'); assert(/جيو/.test(m.replies[0].content));
    G.providers = [...keep.providers];
    const ch2 = mkChannel(); await games.handleMessage(mkMessage(ch2, 'A', '.جيو'));
    const s2 = session.sessionInChannel(ch2.id); assert(s2 && s2.type === 'geo'); await s2.abort('x');
  });

  console.log('Full game');
  Object.assign(G, { rounds: 2, roundMs: 3000, allGuessedGraceMs: 200, introMs: 20, pauseMs: 20 });
  cfg.lobby.fullStartMs = 20; cfg.lobby.autoStartMs = 20;
  async function newGame(bet, players) {
    for (const x of [...session.sessions.values()]) await x.abort('test reset').catch(() => {});   // a failed test must not block the next one
    for (const p of players) { await setBal(p, 10000); await dbx.run('DELETE FROM bet_net WHERE userId = ?', [p]); }
    const ch = mkChannel();
    await games.handleMessage(mkMessage(ch, players[0], bet ? `.جيو ${bet}` : '.جيو'));
    const s = session.sessionInChannel(ch.id); assert(s && s.type === 'geo', 'lobby');
    for (const p of players.slice(1)) await click(p, s, 'join');
    s.checkAutoStart();
    return { ch, s };
  }
  const waitRound = async (s) => { for (let i = 0; i < 100 && !(s.data.current && !s.data.current.resolved); i++) await sleep(30); assert(s.data.current, 'round open'); return s.data.current; };
  const say = async (ch, uid, text) => { const m = mkMessage(ch, uid, text); await games.handleMessage(m); await sleep(40); return m; };
  const resultMsg = (ch, n) => ch.sent.filter(m => m.embeds && m.embeds[0] && m.embeds[0].data && /الجواب/.test(m.embeds[0].data.title || ''))[n];

  const other = (code) => countries.COUNTRIES.find(c => c.code !== code && c.code !== 'US' && GEO[c.code]);
  const noteTexts = (m) => m.replies.map(r => r.content).join(' ');

  await t('right country +40 · wrong country by distance · first guess final · taken (even in another language) · chatter ignored · winner takes the pot', async () => {
    photos.resetHealth(); geo.setFetch(router());
    G.rounds = 1; G.roundMs = 1200;
    const { ch, s } = await newGame(100, ['A', 'B', 'C', 'D']);
    const cur = await waitRound(s);
    const T = cur.q.country, X = other(T.code), truth = cur.q.image;
    const roundMsg = ch.sent.find(m => m.embeds && m.embeds[0] && m.embeds[0].data && m.embeds[0].data.image);
    assert(/اسم الدولة/.test(roundMsg.embeds[0].data.description) && /40/.test(roundMsg.embeds[0].data.description), 'asks for the country, mentions 40');
    assert(!/المدينة/.test(roundMsg.embeds[0].data.description), 'no more cities');
    assert(/Wikimedia/.test(roundMsg.embeds[0].data.footer.text), 'attribution');

    // conversation never reacts, never replies, never pins
    for (const talk of ['شكلها اوروبا', 'ما أدري', 'هذي ' + X.ar + ' ولا ' + T.ar + '؟', 'اظن الطريق حلو', 'هههههه', T.capAr + ' ؟']) {
      const m = await say(ch, 'B', talk); assert(m.reacts.length === 0 && m.replies.length === 0, `no reaction to «${talk}»`);
    }
    assert.strictEqual(cur.guesses.size, 0, 'nothing pinned from chatter');
    const nonPlayer = await say(ch, 'Z', T.ar); assert(nonPlayer.reacts.length === 0 && cur.guesses.size === 0, 'not a player');

    const a = await say(ch, 'A', T.ar);                                   // right country (Arabic)
    assert(a.reacts.includes('📍') && /تم تثبيت اختيارك/.test(noteTexts(a)), 'locked');
    const b1 = await say(ch, 'B', T.en);                                  // same country, other language → taken
    assert(/اختارها لاعب آخر/.test(noteTexts(b1)) && b1.reacts.length === 0 && !cur.guesses.has('B'), 'taken: ' + noteTexts(b1));
    const b2 = await say(ch, 'B', X.en);                                  // B may still choose another country
    assert(b2.reacts.includes('📍') && cur.guesses.get('B').code === X.code);
    const b3 = await say(ch, 'B', T.ar);                                  // a locked player cannot change
    assert(b3.reacts.length === 0 && b3.replies.length === 0 && cur.guesses.get('B').code === X.code, 'first guess is final');
    const c1 = await say(ch, 'C', T.ar);                                  // taken again
    assert(/اختارها لاعب آخر/.test(noteTexts(c1)) && !cur.guesses.has('C'));
    assert.strictEqual(cur.taken.get(T.code), 'A');
    // D is silent; the round runs to its time limit
    for (let i = 0; i < 200 && session.sessions.size; i++) await sleep(50);
    assert.strictEqual(session.sessions.size, 0, 'finished');
    const text = resultMsg(ch, 0).embeds[0].data.description;
    const kmB = score.haversineKm(truth.lat, truth.lon, ...GEO[X.code].points[0]);
    const ptsB = Math.min(39, score.pointsFor(kmB));
    assert(/\+40/.test(text) && text.indexOf('<@A>') < text.indexOf('<@B>'), 'A first with +40: ' + text);
    assert(new RegExp('\\+' + ptsB + '(\\*\\*|\\s|$)').test(text.split('\n').find(l => l.includes('<@B>'))), `B gets ${ptsB}: ` + text);
    assert(/لم يختاروا دولة/.test(text) && text.includes('<@C>') && text.includes('<@D>'), 'silent players listed with +0');
    assert.strictEqual(s.data.scores.get('A'), 40); assert.strictEqual(s.data.scores.get('B'), ptsB); assert(ptsB < 40);
    assert.strictEqual(s.data.scores.get('C'), 0); assert.strictEqual(s.data.scores.get('D'), 0);
    if (geoMap.canvas()) assert(resultMsg(ch, 0).files && resultMsg(ch, 0).files[0], 'map attached');
    assert.strictEqual(await bal('A'), 10000 - 100 + 400, 'A wins the pot of 4 × 100');
    assert.strictEqual((await bal('A')) + (await bal('B')) + (await bal('C')) + (await bal('D')), 40000, 'coins conserved');
    G.rounds = 2; G.roundMs = 3000;
  });
  await t('two players name the same country at the same instant → exactly one gets it', async () => {
    photos.resetHealth(); geo.setFetch(router());
    G.rounds = 1; G.roundMs = 600;
    const { ch, s } = await newGame(0, ['A', 'B', 'C']);
    const cur = await waitRound(s);
    const T = cur.q.country;
    const ms = [mkMessage(ch, 'B', T.ar), mkMessage(ch, 'A', T.en), mkMessage(ch, 'C', 'Germany')];
    await Promise.all(ms.map(m => games.handleMessage(m)));
    await sleep(50);
    assert.strictEqual(cur.taken.get(T.code), 'B', 'first to arrive wins');
    assert.strictEqual(ms[0].reacts.includes('📍'), true);
    assert(!cur.guesses.has('A') && /اختارها لاعب آخر/.test(noteTexts(ms[1])), 'second is told it is taken');
    if (T.code !== 'DE') assert(cur.guesses.get('C') && cur.guesses.get('C').code === 'DE');
    assert.strictEqual([...cur.guesses.values()].filter(p => p.code === T.code).length, 1, 'one pin for that country');
    for (let i = 0; i < 100 && session.sessions.size; i++) await sleep(50);
    G.rounds = 2; G.roundMs = 3000;
  });
  await t('everyone has chosen → the round closes at once; a guess after the round does nothing', async () => {
    photos.resetHealth(); geo.setFetch(router());
    G.rounds = 1; G.roundMs = 8000;
    const { ch, s } = await newGame(0, ['A', 'B']);
    const cur = await waitRound(s);
    const T = cur.q.country, X = other(T.code);
    const t0 = Date.now();
    await say(ch, 'A', T.ar); await say(ch, 'B', X.ar);
    for (let i = 0; i < 100 && session.sessions.size; i++) await sleep(50);
    assert(Date.now() - t0 < 4000, 'closed long before the 8 s limit');
    const late = await say(ch, 'A', T.ar); assert(late.reacts.length === 0 && late.replies.length === 0, 'after the game nothing counts');
    G.rounds = 2; G.roundMs = 3000;
  });
  await t('a country that was taken in round 1 is free again in round 2; the same country as the photo is never reused', async () => {
    photos.resetHealth(); geo.setFetch(router());
    G.rounds = 2; G.roundMs = 900;
    const { ch, s } = await newGame(0, ['A', 'B']);
    const c1 = await waitRound(s); const T1 = c1.q.country;
    await say(ch, 'A', 'Germany');
    for (let i = 0; i < 100 && (s.data.current === c1 || !s.data.current); i++) await sleep(30);
    const c2 = await waitRound(s); assert(c2 !== c1 && c2.q.country.code !== T1.code, 'new round, other photo country');
    assert(!c2.taken.has('DE') && c2.guesses.size === 0, 'reservations start empty each round');
    await say(ch, 'B', 'Germany'); assert.strictEqual(c2.taken.get('DE'), 'B');
    for (let i = 0; i < 100 && session.sessions.size; i++) await sleep(50);
    G.rounds = 2; G.roundMs = 3000;
  });
  await t('.توقف — only the player who started the game can stop it (running or lobby); stakes come back; others are told no', async () => {
    photos.resetHealth(); geo.setFetch(router());
    G.rounds = 3; G.roundMs = 5000;
    const { ch, s } = await newGame(100, ['A', 'B', 'C']);
    await waitRound(s);
    const no = await say(ch, 'B', '.توقف');
    assert(/فقط من بدأ اللعبة/.test(noteTexts(no)), 'a non-starter is refused'); assert.strictEqual(s.status, 'running', 'game continues');
    const bye = await say(ch, 'Z', '.توقف'); assert.strictEqual(s.status, 'running', 'a stranger cannot stop it either');
    assert.strictEqual(await bal('A'), 9900);
    await say(ch, 'A', '.توقف');
    assert.strictEqual(s.status, 'done', 'stopped'); assert.strictEqual(session.sessions.size, 0);
    assert(ch.sent.some(m => /أوقفها <@A>/.test(m.content || '')), 'announced');
    assert.strictEqual(await bal('A'), 10000); assert.strictEqual(await bal('B'), 10000); assert.strictEqual(await bal('C'), 10000, 'all stakes refunded');
    await sleep(300); assert.strictEqual(s.timers.size, 0, 'no timers left running');
    // lobby
    await setBal('A', 10000);
    const ch2 = mkChannel(); await games.handleMessage(mkMessage(ch2, 'A', '.جيو 500'));
    const l = session.sessionInChannel(ch2.id); assert(l && l.status === 'lobby'); assert.strictEqual(await bal('A'), 9500);
    await say(ch2, 'A', '.إيقاف');
    assert.strictEqual(session.sessionInChannel(ch2.id), undefined); assert.strictEqual(await bal('A'), 10000);
    // nothing running → ignored
    const idle = await say(ch2, 'A', '.توقف'); assert.strictEqual(idle.replies.length, 0);
    G.rounds = 2; G.roundMs = 3000;
  });
  await t('hints appear at 1/3 and 2/3 of the round', async () => {
    photos.resetHealth(); geo.setFetch(router());
    G.rounds = 1; G.roundMs = 900;
    const { ch, s } = await newGame(0, ['A', 'B']);
    const cur = await waitRound(s);
    await sleep(1000);
    const m = ch.sent.find(x => x.embeds && x.embeds[0] && x.embeds[0].data && x.embeds[0].data.image);
    const fields = (m.embeds[0].data.fields || []).map(f => f.name).join('|');
    assert(/١/.test(fields) && /٢/.test(fields), 'both hints: ' + fields);
    assert(m.embeds[0].data.fields[0].value.includes(cur.q.country.continentAr));
    for (let i = 0; i < 100 && session.sessions.size; i++) await sleep(50);
    G.rounds = 2; G.roundMs = 3000;
  });
  await t('no photo can be found anywhere → game aborted and bets refunded', async () => {
    photos.resetHealth(); geo.setFetch(router({ wiki: () => ({ query: { pages: [] } }) }));
    G.rounds = 3;
    await newGame(200, ['A', 'B']);
    for (let i = 0; i < 200 && session.sessions.size; i++) await sleep(50);
    assert.strictEqual(session.sessions.size, 0);
    assert.strictEqual(await bal('A'), 10000); assert.strictEqual(await bal('B'), 10000);
    G.rounds = 2;
  });
  await t('cancelled lobby refunds the stake; free game moves no coins; no stale timers after a game', async () => {
    photos.resetHealth(); geo.setFetch(router());
    await setBal('A', 10000);
    const ch = mkChannel(); await games.handleMessage(mkMessage(ch, 'A', '.جيو 500'));
    const s = session.sessionInChannel(ch.id); assert.strictEqual(await bal('A'), 9500);
    await s.abort('x'); assert.strictEqual(await bal('A'), 10000);
    G.rounds = 1; G.roundMs = 400;
    const f = await newGame(0, ['A', 'B']);
    await waitRound(f.s); await say(f.ch, 'A', 'باريس');
    for (let i = 0; i < 100 && session.sessions.size; i++) await sleep(50);
    assert.strictEqual(await bal('A'), 10000); assert.strictEqual(f.s.timers.size === 0 || [...f.s.timers].length <= 1, true);
  });

  Object.assign(G, keep);
  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
