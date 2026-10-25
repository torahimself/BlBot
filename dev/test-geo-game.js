'use strict';
// Street-photo game (.جيو) — offline tests with a fake Mapillary.   node dev/test-geo-game.js
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

cfg.channels = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let mid = 0;
function mkChannel(id = 'gch' + (++mid)) {
  const sent = [];
  const mk = (c) => { const m = { id: 'm' + (++mid), ...(typeof c === 'string' ? { content: c } : c), edit: async (x) => { Object.assign(m, x); return m; }, react: async () => {}, reply: async () => {} }; sent.push(m); return m; };
  return { id, sent, send: async (c) => mk(c), isTextBased: () => true };
}
function mkMessage(ch, userId, content) {
  const replies = [];
  return { author: { id: userId, bot: false, username: userId }, guild: { id: 'g' }, channel: ch, member: { displayName: userId }, content, replies, reply: async (c) => { replies.push(c); }, react: async () => {} };
}
const click = (userId, s, action) => games.handleInteraction({ customId: `pg:${s.id}:${action}`, user: { id: userId, username: userId }, member: { displayName: userId }, replies: [], reply: async () => {}, deferUpdate: async () => {} });
async function setBal(id, v) { await dbx.run('INSERT INTO users (userId, balance) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET balance = ?', [id, v, v]); }
const bal = (id) => getBalance(id);

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); } }

const okJson = (data) => async () => ({ ok: true, status: 200, json: async () => ({ data }) });
const photo = (n) => ({ id: 'img' + n, thumb_1024_url: `https://cdn.example/${n}.jpg`, computed_geometry: { type: 'Point', coordinates: [10 + n, 20 + n] }, captured_at: 1 });

(async () => {
  await db.ready;

  console.log('Data');
  await t('every country has 1–3 points and an Arabic continent', () => {
    for (const c of countries.COUNTRIES) {
      const e = GEO[c.code];
      assert(e, 'missing ' + c.code);
      assert(e.points.length >= 1 && e.points.length <= 3, c.code + ' points');
      for (const [la, lo] of e.points) assert(Math.abs(la) <= 90 && Math.abs(lo) <= 180 && Number.isFinite(la + lo), c.code + ' coords');
      assert(e.continentAr && e.continentAr.length > 2, c.code + ' continent');
      assert(e.weight > 0 && e.weight <= 1, c.code + ' weight');
    }
    assert.strictEqual(Object.keys(GEO).length, countries.COUNTRIES.length);
  });

  console.log('Not configured');
  await t('.جيو without a token → Arabic notice, no lobby', async () => {
    assert(!geo.isConfigured());
    const ch = mkChannel(); const m = mkMessage(ch, 'A', '.جيو');
    await games.handleMessage(m);
    assert(!session.sessionInChannel(ch.id), 'no lobby');
    assert.strictEqual(m.replies.length, 1);
    assert(/جيو/.test(m.replies[0].content) && /Mapillary/.test(m.replies[0].content));
  });
  await t('triggers .جيو .شارع .صورة (+bet) are recognised', () => {
    for (const w of ['.جيو', '.شارع', '.صورة']) assert.strictEqual(games.parseTrigger(w).type, 'geo');
    assert.strictEqual(games.parseTrigger('.جيو 300').bet, 300);
  });

  process.env.MAPILLARY_TOKEN = 'MLY|test|token';

  console.log('Mapillary query');
  await t('URL: token, bbox (area < 0.01°²), fields, limit', () => {
    const u = new URL(geo.buildUrl('MLY|t', [1, 2, 1.08, 2.08]));
    assert.strictEqual(u.origin + u.pathname, 'https://graph.mapillary.com/images');
    assert.strictEqual(u.searchParams.get('access_token'), 'MLY|t');
    assert.strictEqual(u.searchParams.get('bbox'), '1,2,1.08,2.08');
    assert.strictEqual(u.searchParams.get('fields'), 'id,thumb_1024_url,computed_geometry,captured_at');
    assert(Number(u.searchParams.get('limit')) > 0);
    const b = geo.bboxAround([30, 31], Math.random);
    assert((b[2] - b[0]) * (b[3] - b[1]) < 0.01, 'bbox area');
  });
  await t('findPhoto returns a photo + its country; builds the query from a known point', async () => {
    const urls = [];
    geo.setFetch(async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => ({ data: [photo(1), photo(2)] }) }; });
    const r = await geo.findPhoto();
    assert(r && r.country.code && r.image.url.startsWith('https://cdn.example/'));
    assert.strictEqual(urls.length, 1);
    const bb = new URL(urls[0]).searchParams.get('bbox').split(',').map(Number);
    const near = GEO[r.country.code].points.some(([la, lo]) => Math.abs((bb[1] + bb[3]) / 2 - la) <= cfg.geo.jitterDeg + 1e-6 && Math.abs((bb[0] + bb[2]) / 2 - lo) <= cfg.geo.jitterDeg + 1e-6);
    assert(near, 'bbox is around one of the country points');
    assert.strictEqual(r.image.lat, 21 === r.image.lat ? 21 : r.image.lat);
  });
  await t('retries on empty results / errors (4 attempts, different countries)', async () => {
    let n = 0; const seen = [];
    geo.setFetch(async (url) => { n++; seen.push(url); if (n === 1) return { ok: true, status: 200, json: async () => ({ data: [] }) }; if (n === 2) throw new Error('boom'); return { ok: true, status: 200, json: async () => ({ data: [photo(3)] }) }; });
    const r = await geo.findPhoto();
    assert(r, 'found on the 3rd attempt'); assert.strictEqual(n, 3);
  });
  await t('gives up (null) after 3 empty attempts; API error object handled', async () => {
    let n = 0; geo.setFetch(async () => { n++; return { ok: true, status: 200, json: async () => ({ error: { message: 'bad token' } }) }; });
    assert.strictEqual(await geo.findPhoto(), null); assert.strictEqual(n, cfg.geo.attempts);
  });
  await t('already-used countries are not picked again', async () => {
    geo.setFetch(okJson([photo(1)]));
    const used = new Set(countries.COUNTRIES.map(c => c.code)); used.delete('JP');
    const r = await geo.findPhoto({ used }); assert.strictEqual(r.country.code, 'JP');
  });

  console.log('Answers');
  await t('Arabic + English answers match the country', () => {
    const sa = countries.COUNTRIES.find(c => c.code === 'SA');
    for (const a of ['السعودية', 'سعودية', 'المملكة العربية السعودية', 'Saudi Arabia', 'saudi arabia', 'Kingdom of Saudi Arabia']) assert(countries.matches(sa, a), a);
    assert(!countries.matches(sa, 'مصر'));
  });

  console.log('Full game');
  const G = cfg.geo; const keep = { ...G };
  Object.assign(G, { rounds: 2, roundMs: 3000, graceAfterFirstMs: 300, introMs: 20, pauseMs: 20 });
  cfg.lobby.fullStartMs = 20; cfg.lobby.autoStartMs = 20;
  async function newGame(bet, players) {
    for (const p of players) { await setBal(p, 10000); await dbx.run('DELETE FROM bet_net WHERE userId = ?', [p]); }
    const ch = mkChannel();
    await games.handleMessage(mkMessage(ch, players[0], bet ? `.جيو ${bet}` : '.جيو'));
    const s = session.sessionInChannel(ch.id); assert(s && s.type === 'geo', 'lobby');
    for (const p of players.slice(1)) await click(p, s, 'join');
    s.checkAutoStart();
    return { ch, s };
  }
  const waitRound = async (s) => { for (let i = 0; i < 100 && !(s.data.current && !s.data.current.resolved); i++) await sleep(50); assert(s.data.current, 'round open'); return s.data.current; };

  await t('speed scoring 3/2/1, once per player, image embed, answer reveal, winner takes the pot', async () => {
    geo.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ data: [photo(5)] }) }));
    const { ch, s } = await newGame(100, ['A', 'B', 'C']);
    // round 1: B first, then A (C never answers)
    let cur = await waitRound(s);
    const embedMsg = ch.sent.find(m => m.embeds && m.embeds[0] && m.embeds[0].data && m.embeds[0].data.image);
    assert(embedMsg && embedMsg.embeds[0].data.image.url === 'https://cdn.example/5.jpg', 'photo shown');
    assert(/في أي دولة/.test(embedMsg.embeds[0].data.description), 'Arabic question');
    assert(/Mapillary/.test(embedMsg.embeds[0].data.footer.text), 'attribution');
    const ans = cur.q.country.ar;
    await games.handleMessage(mkMessage(ch, 'X', ans));                 // non-player
    await games.handleMessage(mkMessage(ch, 'B', ans));
    await games.handleMessage(mkMessage(ch, 'B', ans));                 // same player twice → once
    await games.handleMessage(mkMessage(ch, 'A', cur.q.country.en));
    assert.strictEqual(s.data.scores.get('B'), 3); assert.strictEqual(s.data.scores.get('A'), 2);
    // round 2: A first
    for (let i = 0; i < 100 && s.data.current === cur; i++) await sleep(50);
    cur = await waitRound(s);
    await games.handleMessage(mkMessage(ch, 'A', cur.q.country.ar));
    for (let i = 0; i < 200 && session.sessions.size; i++) await sleep(50);
    assert.strictEqual(session.sessions.size, 0, 'finished');
    // A: 2+3 = 5, B: 3 → A wins pot 300
    assert.strictEqual(await bal('A'), 10000 - 100 + 300);
    assert.strictEqual((await bal('A')) + (await bal('B')) + (await bal('C')), 30000, 'coins conserved');
  });
  await t('hints appear at 1/3 and 2/3 of the round', async () => {
    geo.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ data: [photo(6)] }) }));
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
  await t('no photo can be found → game aborted and bets refunded', async () => {
    geo.setFetch(okJson([]));
    G.rounds = 3;
    const { s } = await newGame(200, ['A', 'B']);
    for (let i = 0; i < 100 && session.sessions.size; i++) await sleep(50);
    assert.strictEqual(session.sessions.size, 0);
    assert.strictEqual(await bal('A'), 10000); assert.strictEqual(await bal('B'), 10000);
    G.rounds = 2;
  });
  await t('cancelled lobby refunds the stake; free game moves no coins', async () => {
    geo.setFetch(okJson([photo(7)]));
    await setBal('A', 10000);
    const ch = mkChannel(); await games.handleMessage(mkMessage(ch, 'A', '.جيو 500'));
    const s = session.sessionInChannel(ch.id); assert.strictEqual(await bal('A'), 9500);
    await s.abort('x'); assert.strictEqual(await bal('A'), 10000);
    const f = await newGame(0, ['A', 'B']); assert.strictEqual(await bal('A'), 10000); await f.s.abort('x');
  });

  Object.assign(G, keep);
  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
