'use strict';
// Arabic party games — tests with mocked Discord objects, in-memory DB.
//   node dev/test-party-games.js
process.env.BL_ECONOMY_DB = ':memory:';
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const db = require(path.join(root, 'utils/economy/database.js'));
const dbx = require(path.join(root, 'utils/economy/engine/dbx.js'));
const betting = require(path.join(root, 'utils/economy/engine/betting.js'));
const { getBalance, updateBalance } = require(path.join(root, 'utils/economy/shopManager.js'));
const cfg = require(path.join(root, 'utils/games/config.js'));
const { normalize, isArabicOnly } = require(path.join(root, 'utils/games/arabic.js'));
const countries = require(path.join(root, 'utils/games/countries.js'));
const games = require(path.join(root, 'utils/games/index.js'));
const session = require(path.join(root, 'utils/games/session.js'));
const stats = require(path.join(root, 'utils/games/stats.js'));
const mafia = require(path.join(root, 'utils/games/mafia.js'));
const cats = require(path.join(root, 'utils/games/categories.js'));
const guess = require(path.join(root, 'utils/games/guess.js'));

cfg.channels = [];                       // anywhere
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── mocks ──────────────────────────────────────────────────────────────────
let mid = 0;
function mkChannel(id = 'ch' + (++mid)) {
  const sent = [];
  const mk = (c) => { const m = { id: 'm' + (++mid), ...(typeof c === 'string' ? { content: c } : c), edit: async (x) => { Object.assign(m, x); return m; }, react: async () => {}, reply: async () => {} }; sent.push(m); return m; };
  return { id, sent, send: async (c) => mk(c), isTextBased: () => true };
}
function mkMessage(ch, userId, content) {
  const replies = [];
  return { author: { id: userId, bot: false, username: userId }, guild: { id: 'g' }, channel: ch, member: { displayName: userId },
    content, replies, reply: async (c) => { replies.push(c); }, react: async () => {} };
}
function mkClick(userId, customId, extra = {}) {
  const it = { customId, user: { id: userId, username: userId }, member: { displayName: userId }, replies: [], replied: false, deferred: false,
    reply: async (o) => { it.replies.push(o); it.replied = true; }, deferUpdate: async () => { it.deferred = true; },
    update: async (o) => { it.updated = o; }, showModal: async (m) => { it.modal = m; }, ...extra };
  return it;
}
const bal = (id) => getBalance(id);
async function setBal(id, v) { await dbx.run('INSERT INTO users (userId, balance) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET balance = ?', [id, v, v]); }
async function resetPlayers(...ids) { for (const id of ids) { await setBal(id, 10000); await dbx.run('DELETE FROM bet_net WHERE userId = ?', [id]); } }

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

const click = (userId, s, action) => games.handleInteraction(mkClick(userId, `pg:${s.id}:${action}`));

// A trivial game to test the lobby/stake machinery on its own.
function fakeGame(winnersFn) {
  return {
    type: 'fake', title: 'تجربة', emoji: '🧪', blurb: 'x', min: 2, max: 3,
    start: async (s) => { await s.finish({ winners: winnersFn(s), active: s.ids }); },
  };
}
async function lobby(def, host, bet, ch) {
  const adapter = { channel: ch, user: { id: host }, member: { displayName: host }, editReply: (p) => ch.send(p) };
  const r = await session.create({ type: def.type, def, interaction: adapter, bet });
  assert(r.ok, 'lobby created: ' + r.error);
  return r.session;
}

(async () => {
  await db.ready;
  await stats.ensure();

  console.log('Arabic normalisation');
  await t('hamza / taa / yaa / ال / tashkeel fold to the same key', () => {
    assert.strictEqual(normalize('الإمارات'), normalize('امارات'));
    assert.strictEqual(normalize('الأردن'), normalize('اردن'));
    assert.strictEqual(normalize('مَصْـــر'), normalize('مصر'));
    assert.strictEqual(normalize('سوريا'), normalize('سورية') === normalize('سوريا') ? normalize('سوريا') : normalize('سوريا'));
    assert.strictEqual(normalize('  Saudi   Arabia! '), normalize('saudi arabia'));
    assert.strictEqual(normalize('The Netherlands'), normalize('netherlands'));
    assert.strictEqual(normalize('على'), normalize('علي'));
  });
  await t('isArabicOnly', () => {
    assert(isArabicOnly('أسد')); assert(isArabicOnly('بيت الله'));
    assert(!isArabicOnly('lion')); assert(!isArabicOnly('أسد lion')); assert(!isArabicOnly('123'));
  });

  console.log('Country aliases');
  const byIso = (iso) => countries.COUNTRIES.find(c => c.iso === iso || c.code === iso);
  await t('at least 185 countries, each with a flag emoji', () => {
    assert(countries.COUNTRIES.length >= 185, 'have ' + countries.COUNTRIES.length);
    assert(countries.COUNTRIES.every(c => c.flag && c.flag.length >= 2));
    assert.strictEqual(countries.flagEmoji('SA'), '🇸🇦');
  });
  const SA = countries.COUNTRIES.find(c => c.ar === 'السعودية');
  await t('Saudi Arabia: every accepted spelling', () => {
    for (const a of ['السعودية', 'سعودية', 'المملكة العربية السعودية', 'المملكه العربيه السعوديه', 'Saudi Arabia', 'saudi arabia', 'Kingdom of Saudi Arabia', 'KSA', 'السعوديه'])
      assert(countries.matches(SA, a), 'should accept: ' + a);
  });
  await t('wrong answers are rejected', () => {
    for (const a of ['مصر', 'قطر', 'Egypt', 'السعودي', 'العربية', 'ا', ''])
      assert(!countries.matches(SA, a), 'should reject: ' + a);
  });
  await t('other spot checks (UAE, Egypt, USA, Syria, Sudan vs South Sudan)', () => {
    const f = (ar) => countries.COUNTRIES.find(c => c.ar === ar);
    assert(countries.matches(f('الإمارات'), 'الامارات العربية المتحدة'));
    assert(countries.matches(f('الإمارات'), 'UAE'));
    assert(countries.matches(f('مصر'), 'egypt'));
    assert(countries.matches(f('سوريا'), 'سورية'));
    assert(!countries.matches(f('السودان'), 'جنوب السودان'));
    assert(countries.matches(f('جنوب السودان'), 'جنوب السودان'));
    assert(countries.isPlace('الرياض') && countries.isPlace('فرنسا') && !countries.isPlace('تفاحة'));
  });

  console.log('Trigger parsing');
  await t('words, aliases, bets, errors', () => {
    const p = (s) => games.parseTrigger(s);
    assert.strictEqual(p('.علم').type, 'guess');
    assert.strictEqual(p('.علم').bet, 0);
    assert.strictEqual(p('.علم 500').bet, 500);
    assert.strictEqual(p('.عاصمة').type, 'capital');
    assert.strictEqual(p('.مافيا').type, 'mafia');
    for (const w of ['.انسان', '.إنسان', '.أنسان']) assert.strictEqual(p(w).type, 'categories', w);
    assert.strictEqual(p('.انسان حيوان').type, 'categories');
    assert.strictEqual(p('.انسان حيوان 200').bet, 200);
    assert.strictEqual(p('.مافيا 5').error !== undefined, true, 'bet below min');
    assert.strictEqual(p('.مافيا 99999999').error !== undefined, true, 'bet above max');
    assert.strictEqual(p('.علم abc').bet, 0);
    assert.strictEqual(p('علم'), null); assert.strictEqual(p('hello'), null); assert.strictEqual(p('.شيء'), null); assert.strictEqual(p('.'), null);
  });

  console.log('Lobby, stakes, refunds');
  await t('free game: no coins move, winner gets nothing extra', async () => {
    await resetPlayers('A', 'B');
    const ch = mkChannel();
    const s = await lobby(fakeGame(() => ['A']), 'A', 0, ch);
    assert((await click('B', s, 'join')) === undefined);
    assert(s.players.has('B'));
    cfg.lobby.autoStartMs = 30; s.checkAutoStart();
    await sleep(150);
    assert.strictEqual(await bal('A'), 10000); assert.strictEqual(await bal('B'), 10000);
    assert.strictEqual(session.sessions.size, 0, 'session released');
    assert.strictEqual(await betting.weeklyNet('A'), 0);
  });
  await t('bet game: stakes taken on join, pot to the winner, coins conserved, no tax', async () => {
    await resetPlayers('A', 'B', 'C');
    const ch = mkChannel();
    const s = await lobby(fakeGame(() => ['B']), 'A', 300, ch);
    await click('B', s, 'join'); await click('C', s, 'join');
    assert.strictEqual(await bal('A'), 9700); assert.strictEqual(await bal('C'), 9700);
    cfg.lobby.fullStartMs = 20; s.checkAutoStart();       // full lobby → near-immediate start
    await sleep(200);
    assert.strictEqual(await bal('B'), 10000 - 300 + 900);
    assert.strictEqual(await bal('A') + await bal('B') + await bal('C'), 30000, 'conserved');
    assert.strictEqual(await betting.weeklyNet('B'), 600);
    assert.strictEqual(await betting.weeklyNet('A'), -300);
  });
  await t('two winners split the pot; remainder goes to the first', async () => {
    await resetPlayers('A', 'B', 'C');
    const ch = mkChannel();
    const s = await lobby(fakeGame(() => ['A', 'B']), 'A', 101, ch);   // pot 303 → 151 + 152
    await click('B', s, 'join'); await click('C', s, 'join');
    cfg.lobby.fullStartMs = 20; s.checkAutoStart(); await sleep(200);
    assert.strictEqual(await bal('A') + await bal('B') + await bal('C'), 30000);
    assert.strictEqual(await bal('C'), 10000 - 101);
  });
  await t('weekly profit cap trims the prize and conserves coins', async () => {
    await resetPlayers('A', 'B');
    await dbx.run('INSERT INTO bet_net (userId, week, net) VALUES (?, ?, 9900) ON CONFLICT(userId, week) DO UPDATE SET net = 9900', ['A', require(path.join(root, 'utils/economy/engine/time.js')).weekStartKey(Date.now())]);
    const ch = mkChannel();
    const s = await lobby(fakeGame(() => ['A']), 'A', 1000, ch);
    await click('B', s, 'join'); cfg.lobby.autoStartMs = 20; s.checkAutoStart(); await sleep(200);
    assert.strictEqual(await bal('A') + await bal('B'), 20000, 'conserved');
    assert.strictEqual(await betting.weeklyNet('A'), 10000);
  });
  await t('player at the cap cannot join a bet game (can still play free)', async () => {
    await resetPlayers('A', 'B');
    await dbx.run('INSERT INTO bet_net (userId, week, net) VALUES (?, ?, 10000) ON CONFLICT(userId, week) DO UPDATE SET net = 10000', ['B', require(path.join(root, 'utils/economy/engine/time.js')).weekStartKey(Date.now())]);
    const ch = mkChannel();
    const s = await lobby(fakeGame(() => ['A']), 'A', 100, ch);
    const it = mkClick('B', `pg:${s.id}:join`); await games.handleInteraction(it);
    assert(!s.players.has('B')); assert.strictEqual(await bal('B'), 10000);
    await s.abort('test'); assert.strictEqual(await bal('A'), 10000);
    const free = await lobby(fakeGame(() => []), 'A', 0, mkChannel());
    await click('B', free, 'join'); assert(free.players.has('B')); await free.abort('x');
  });
  await t('host cancel refunds everyone exactly once', async () => {
    await resetPlayers('A', 'B');
    const ch = mkChannel();
    const s = await lobby(fakeGame(() => ['A']), 'A', 500, ch);
    await click('B', s, 'join');
    assert.strictEqual(await bal('B'), 9500);
    const nonHost = mkClick('B', `pg:${s.id}:cancel`); await games.handleInteraction(nonHost);
    assert.strictEqual(s.status, 'lobby', 'non-host cannot cancel');
    await click('A', s, 'cancel'); await s.abort('again'); await s.abort('and again');
    assert.strictEqual(await bal('A'), 10000); assert.strictEqual(await bal('B'), 10000);
  });
  await t('leaving the lobby refunds; broke player cannot join', async () => {
    await resetPlayers('A', 'B'); await setBal('B', 50);
    const s = await lobby(fakeGame(() => []), 'A', 500, mkChannel());
    await click('B', s, 'join'); assert(!s.players.has('B'));
    await setBal('B', 10000); await click('B', s, 'join'); assert.strictEqual(await bal('B'), 9500);
    await click('B', s, 'leave'); assert.strictEqual(await bal('B'), 10000);
    await s.abort('x');
  });
  await t('lobby timeout (minimum never reached) refunds', async () => {
    await resetPlayers('A');
    const old = cfg.lobby.waitMs; cfg.lobby.waitMs = 60;
    const s = await lobby(fakeGame(() => []), 'A', 700, mkChannel());
    assert.strictEqual(await bal('A'), 9300);
    await sleep(250);
    assert.strictEqual(await bal('A'), 10000); assert.strictEqual(session.sessions.size, 0);
    cfg.lobby.waitMs = old;
  });
  await t('a game that crashes refunds the stakes', async () => {
    await resetPlayers('A', 'B');
    const def = { ...fakeGame(() => []), start: async () => { throw new Error('boom'); } };
    const s = await lobby(def, 'A', 400, mkChannel());
    await click('B', s, 'join'); cfg.lobby.autoStartMs = 20; s.checkAutoStart(); await sleep(250);
    assert.strictEqual(await bal('A'), 10000); assert.strictEqual(await bal('B'), 10000);
  });
  await t('one active game per channel, and per player', async () => {
    await resetPlayers('A', 'B');
    const ch = mkChannel();
    const s = await lobby(fakeGame(() => []), 'A', 0, ch);
    const adapter = { channel: ch, user: { id: 'B' }, member: { displayName: 'B' }, editReply: (p) => ch.send(p) };
    const r = await session.create({ type: 'fake', def: fakeGame(() => []), interaction: adapter, bet: 0 });
    assert(!r.ok);
    const r2 = await session.create({ type: 'fake', def: fakeGame(() => []), interaction: { ...adapter, channel: mkChannel(), user: { id: 'A' } }, bet: 0 });
    assert(!r2.ok, 'A is already in a game');
    await s.abort('x');
  });
  await t('restart recovery hands back orphaned stakes once', async () => {
    await resetPlayers('Z');
    await updateBalance('Z', -500);
    await dbx.run('INSERT INTO party_stakes (sessionId, userId, amount, createdAt) VALUES (?, ?, ?, ?)', ['dead1', 'Z', 500, Date.now()]);
    await session.init(); await session.init();
    assert.strictEqual(await bal('Z'), 10000);
  });

  console.log('Chat trigger → lobby (through index.handleMessage)');
  await t('".علم 250" opens a bet lobby; ".علم" again in the channel is refused', async () => {
    await resetPlayers('A', 'B');
    const ch = mkChannel();
    const m = mkMessage(ch, 'A', '.علم 250');
    assert.strictEqual(await games.handleMessage(m), true);
    const s = session.sessionInChannel(ch.id);
    assert(s && s.bet === 250 && s.type === 'guess');
    assert.strictEqual(await bal('A'), 9750);
    const m2 = mkMessage(ch, 'B', '.مافيا'); await games.handleMessage(m2);
    assert(m2.replies.length === 1, 'refused with a reply');
    await s.abort('x'); assert.strictEqual(await bal('A'), 10000);
  });
  await t('".علم 5" (below the minimum) is refused without opening a lobby', async () => {
    const ch = mkChannel(); const m = mkMessage(ch, 'A', '.علم 5');
    await games.handleMessage(m); assert(!session.sessionInChannel(ch.id)); assert(m.replies.length === 1);
  });
  await t('allowed-channel list is respected', async () => {
    const old = cfg.channels; cfg.channels = ['only-here'];
    const ch = mkChannel('other'); await games.handleMessage(mkMessage(ch, 'A', '.علم'));
    assert(!session.sessionInChannel('other'));
    cfg.channels = old;
  });
  await t('".عاصمة" starts capital mode', async () => {
    const ch = mkChannel(); await games.handleMessage(mkMessage(ch, 'A', '.عاصمة'));
    const s = session.sessionInChannel(ch.id); assert(s && s.options.mode === 'capital'); await s.abort('x');
  });

  console.log('Guess the country — full game');
  await t('3 players, bet, 2 rounds: first correct answer scores, top scorer wins the pot, stats saved', async () => {
    await resetPlayers('A', 'B', 'C');
    const g = cfg.guess; const keep = { ...g };
    g.rounds = 2; g.roundMs = 4000; g.hintAfterMs = 3000; g.min = 2;
    const ch = mkChannel();
    await games.handleMessage(mkMessage(ch, 'A', '.علم 100'));
    const s = session.sessionInChannel(ch.id);
    await click('B', s, 'join'); await click('C', s, 'join');
    cfg.lobby.fullStartMs = 20; s.checkAutoStart();
    const answerRound = async (who, wrongFirst) => {
      for (let i = 0; i < 80 && !(s.data.current && !s.data.current.resolved); i++) await sleep(100);
      const cur = s.data.current; assert(cur, 'a round is open');
      if (wrongFirst) await games.handleMessage(mkMessage(ch, 'C', 'جواب غلط تماما'));
      await games.handleMessage(mkMessage(ch, 'X', cur.q.country.ar));        // not a player → ignored
      assert(!cur.resolved, 'non-player cannot score');
      await games.handleMessage(mkMessage(ch, who, cur.q.country.ar));
      assert.strictEqual(cur.winner, who);
    };
    await answerRound('B', true);
    await answerRound('B', false);
    for (let i = 0; i < 100 && session.sessions.size; i++) await sleep(100);
    Object.assign(g, keep);
    assert.strictEqual(session.sessions.size, 0, 'game finished');
    assert.strictEqual(await bal('B'), 10000 - 100 + 300);
    assert.strictEqual(await bal('A') + await bal('B') + await bal('C'), 30000);
    const st = (await stats.forUser('B')).filter(x => x.game === 'guess'); assert.strictEqual(st.length, 1); assert.strictEqual(st[0].plays, 1, 'plays ' + st[0].plays); assert.strictEqual(st[0].wins, 1, 'wins ' + st[0].wins);
    const stA = (await stats.forUser('A')).filter(x => x.game === 'guess'); assert(stA.length === 0 || stA[0].wins === 0);   // A never answered → not counted as having played
  });

  console.log('Mafia');
  await t('role counts for 5..12 players', () => {
    for (let n = 5; n <= 12; n++) {
      const ids = Array.from({ length: n }, (_, i) => 'p' + i);
      const roles = mafia.assignRoles(ids);
      const c = {}; for (const r of roles.values()) c[r] = (c[r] || 0) + 1;
      assert.strictEqual(roles.size, n);
      assert.strictEqual(c.mafia, mafia.mafiaCount(n)); assert.strictEqual(c.doctor, 1); assert.strictEqual(c.detective, 1);
      assert.strictEqual((c.citizen || 0) + c.mafia + 2, n);
      assert(c.mafia < n - c.mafia, 'mafia is a minority');
    }
    assert.strictEqual(mafia.mafiaCount(5), 1); assert.strictEqual(mafia.mafiaCount(8), 2); assert.strictEqual(mafia.mafiaCount(12), 3);
  });
  await t('roles are shuffled (not always the same player)', () => {
    const seen = new Set();
    for (let i = 0; i < 60; i++) seen.add([...mafia.assignRoles(['a', 'b', 'c', 'd', 'e'])].find(([, r]) => r === 'mafia')[0]);
    assert(seen.size >= 3);
  });
  await t('win conditions', () => {
    const roles = new Map([['a', 'mafia'], ['b', 'doctor'], ['c', 'detective'], ['d', 'citizen'], ['e', 'citizen']]);
    assert.strictEqual(mafia.winner(['a', 'b', 'c', 'd', 'e'], roles), null);
    assert.strictEqual(mafia.winner(['b', 'c', 'd', 'e'], roles), 'town');
    assert.strictEqual(mafia.winner(['a', 'b'], roles), 'mafia', 'equal numbers → mafia');
    assert.strictEqual(mafia.winner(['a', 'b', 'c'], roles), null);
    assert.strictEqual(mafia.winner(['a', 'd'], roles), 'mafia');
    assert.strictEqual(mafia.winner(['a'], roles), 'mafia');
  });
  await t('night resolution and voting', () => {
    assert.deepStrictEqual(mafia.resolveNight({ kill: 'x', save: 'x' }), { dead: null, saved: true });
    assert.deepStrictEqual(mafia.resolveNight({ kill: 'x', save: 'y' }), { dead: 'x', saved: false });
    assert.deepStrictEqual(mafia.resolveNight({ kill: null, save: 'y' }), { dead: null, saved: false });
    assert.strictEqual(mafia.voteResult(['a', 'a', 'b']), 'a');
    assert.strictEqual(mafia.voteResult(['a', 'b']), null, 'tie → nobody out');
    assert.strictEqual(mafia.voteResult(['skip', 'skip', 'a']), 'a' === 'a' ? 'a' : null);
    assert.strictEqual(mafia.voteResult(['skip', 'skip']), null);
    assert.strictEqual(mafia.plurality([], () => 0), null);
    assert.strictEqual(mafia.plurality(['a', 'b', 'b'], () => 0), 'b');
  });
  await t('mafia needs 5 players: ".ابدأ" below minimum is refused, 5 can start', async () => {
    await resetPlayers('A', 'B', 'C', 'D', 'E');
    const ch = mkChannel(); await games.handleMessage(mkMessage(ch, 'A', '.مافيا'));
    const s = session.sessionInChannel(ch.id); assert.strictEqual(s.def.min, 5);
    await click('B', s, 'join'); const it = mkClick('A', `pg:${s.id}:start`); await games.handleInteraction(it);
    assert.strictEqual(s.status, 'lobby'); assert(it.replies.length === 1);
    await s.abort('x');
  });
  await t('full mafia game with bots: runs to a result, pays once, no stake left behind', async () => {
    const ids = ['A', 'B', 'C', 'D', 'E'];
    await resetPlayers(...ids);
    const m = cfg.mafia; const keep = { ...m }; m.nightMs = 400; m.talkMs = 150; m.voteMs = 400;
    const ch = mkChannel(); await games.handleMessage(mkMessage(ch, 'A', '.مافيا 100'));
    const s = session.sessionInChannel(ch.id);
    for (const id of ids.slice(1)) await click(id, s, 'join');
    cfg.lobby.fullStartMs = 20; cfg.lobby.autoStartMs = 20; s.checkAutoStart();
    // Nobody acts: nights pass with no kill, votes with no votes → the game must still end (round cap / timeout).
    const stop = Date.now() + 25000;
    while (session.sessions.size && Date.now() < stop) await sleep(150);
    Object.assign(m, keep);
    if (session.sessions.size) { await s.abort('test stop'); }
    const total = (await Promise.all(ids.map(bal))).reduce((a, b) => a + b, 0);
    assert.strictEqual(total, 50000, 'coins conserved');
    assert.strictEqual((await dbx.all('SELECT * FROM party_stakes WHERE sessionId = ?', [s.id])).length, 0);
  });

  console.log('إنسان حيوان نبات جماد بلاد');
  await t('answer validation (details: dev/test-categories.js)', () => {
    const v = cats.validAnswer;
    assert(v('أحمد', 0, 'ا')); assert(v('احمد', 0, 'ا'));
    assert(!v('محمد', 0, 'ا'), 'wrong letter');
    assert(!v('Ahmed', 0, 'ا'), 'not Arabic');
    assert(!v('', 0, 'ا')); assert(!v('ا', 0, 'ا'), 'single letter');
    assert(!v('اااااا', 0, 'ا'), 'repeated letter');
    assert(v('أسد', 1, 'ا')); assert(v('الأسد', 1, 'ا'), 'ال is ignored');
    assert(v('فرنسا', 4, 'ف'));
    assert(!v('فارنا', 4, 'ف'), 'a word outside the list is not accepted automatically — it goes to a player vote');
    assert(!v('س بطيخ', 2, 'س'), 'letter + space + word');
    assert(!v('سفراولة', 2, 'س'), 'letter glued onto a real word');
    assert(!v('ضصثقفغعه', 3, 'ض'), 'keyboard mashing');
  });
  await t('turn-based design: 5 categories, no modal form, only the quit button exists', async () => {
    assert.strictEqual(cats.CATS.length, 5);
    assert.strictEqual(cfg.categories.rounds, 5, 'five letters');
    assert.strictEqual(cfg.categories.turnMs, 15000, '15 s per turn');
    assert.strictEqual(cfg.categories.pointsCorrect, 10);
    const it = mkClick('A', 'pg:x:answer');
    await cats.onComponent({ players: new Map([['A', {}]]), data: {} }, it, 'answer');
    assert(!it.modal, 'no modal any more');
    assert(it.replies[0] && it.replies[0].flags === 64, 'stale button is refused privately');
  });
  await t('full game through the lobby: bet 200, A answers, B is silent → A scores, wins the pot', async () => {
    await resetPlayers('A', 'B');
    const c = cfg.categories; const keep = JSON.parse(JSON.stringify(c));
    Object.assign(c, { rounds: 1, turnMs: 80, introMs: 0, pauseMs: 0, betweenTurnsMs: 0, roundPauseMs: 0, maxAttempts: null, maxIdleCategories: 99 });
    c.letters.splice(0, c.letters.length, 'م');
    const ch = mkChannel(); await games.handleMessage(mkMessage(ch, 'A', '.انسان 200'));
    const s = session.sessionInChannel(ch.id);
    await click('B', s, 'join'); cfg.lobby.autoStartMs = 20; s.checkAutoStart();
    const bank = ['محمد', 'ماعز', 'موز', 'مفتاح', 'مصر'];
    const seen = new Set();
    for (let i = 0; i < 600 && session.sessions.size; i++) {
      const turn = s.data && s.data.turn;
      if (turn && turn.active && !turn.resolved && !seen.has(turn)) {
        seen.add(turn);
        if (turn.userId === 'A') await games.handleMessage(mkMessage(ch, 'A', bank[turn.ci]));
        else await games.handleMessage(mkMessage(ch, 'B', 'xyz'));      // wrong → another player gets the category
      }
      await sleep(5);
    }
    Object.assign(c, keep); c.letters.splice(0, c.letters.length, ...keep.letters);
    assert.strictEqual(session.sessions.size, 0, 'game finished');
    const a = await bal('A'), b = await bal('B');
    assert.strictEqual(a + b, 20000, 'conserved');
    assert.strictEqual(a, 10200); assert.strictEqual(b, 9800);
  });

  console.log('Stats');
  await t('plays and wins accumulate per game', async () => {
    await stats.record('x', ['U1', 'U2'], ['U1']); await stats.record('x', ['U1', 'U2'], ['U2']);
    const u1 = (await stats.forUser('U1'))[0], u2 = (await stats.forUser('U2'))[0];
    assert.deepStrictEqual([u1.plays, u1.wins, u2.plays, u2.wins], [2, 1, 2, 1]);
  });

  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
