'use strict';
// .توقف works for every game (host or staff, any time) and a stop always refunds every bet.
//   node dev/test-stop-bets.js
process.env.BL_ECONOMY_DB = ':memory:';
const path = require('path');
const root = path.join(__dirname, '..');
const db = require(path.join(root, 'utils/economy/database.js'));
const dbx = require(path.join(root, 'utils/economy/engine/dbx.js'));
const { getBalance } = require(path.join(root, 'utils/economy/shopManager.js'));
const cfg = require(path.join(root, 'utils/games/config.js'));
const games = require(path.join(root, 'utils/games/index.js'));
const session = require(path.join(root, 'utils/games/session.js'));
const gm = require(path.join(root, 'utils/economy/gameManager.js'));
const dm = require(path.join(root, 'utils/economy/duelManager.js'));

cfg.channels = [];
cfg.eventCredit.minDurationMs = 1e9;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let mid = 0, passed = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${a} !== ${b}`); };

function mkChannel() {
  const sent = [];
  const mk = (c) => { const m = { id: 'm' + (++mid), ...(typeof c === 'string' ? { content: c } : c), edit: async (x) => { Object.assign(m, x); return m; }, react: async () => {}, reply: async () => {}, delete: async () => {} }; sent.push(m); return m; };
  const ch = { id: 'ch' + (++mid), sent, send: async (c) => mk(c), isTextBased: () => true };
  ch.messages = { fetch: async (id) => sent.find(m => m.id === id) || null };
  return ch;
}
const client = (ch) => ({ channels: { cache: { get: () => ch }, fetch: async () => ch } });
function msg(ch, userId, content, { staff = false } = {}) {
  const replies = [];
  const m = { author: { id: userId, bot: false, username: userId }, guild: { id: 'g' }, channel: ch, client: client(ch),
    member: { displayName: userId, permissions: { has: (p) => staff && p === 'ManageMessages' }, roles: { cache: { has: () => false } } },
    content, replies, reply: async (c) => { replies.push(c); return { delete: async () => {} }; }, react: async () => {} };
  return m;
}
const click = (userId, cid) => { const it = { customId: cid, user: { id: userId, username: userId }, member: { displayName: userId }, replies: [], replied: false, deferred: false,
  reply: async (o) => { it.replies.push(o); it.replied = true; }, deferUpdate: async () => { it.deferred = true; }, update: async () => {}, showModal: async () => {}, channel: null }; return it; };
const setBal = (id, v) => dbx.run('INSERT INTO users (userId,balance) VALUES (?,?) ON CONFLICT(userId) DO UPDATE SET balance=?', [id, v, v]);
const BET = 500;

// [trigger word, players]
const SESSION_GAMES = [['كتابة', 2], ['حساب', 2], ['سلسلة', 2], ['علم', 2], ['عاصمة', 2], ['جيو', 2], ['ريبليكا', 2], ['روليت', 3], ['مافيا', 5]];

(async () => {
  await db.ready;
  for (const [word, n] of SESSION_GAMES) {
    for (const phase of ['lobby', 'running']) {
      await t(`${word}: host stops in the ${phase} → everyone refunded`, async () => {
        const ch = mkChannel();
        const ids = Array.from({ length: n }, (_, i) => 'P' + (i + 1));
        for (const id of ids) await setBal(id, 5000);
        const trig = games.parseTrigger(`.${word} ${BET}`);
        if (!trig || trig.error) throw new Error('trigger: ' + JSON.stringify(trig));
        await games.handleMessage(msg(ch, 'P1', `.${word} ${BET}`));
        const s = session.sessionInChannel(ch.id);
        if (!s) { throw new Error('no lobby created: ' + JSON.stringify(ch.sent.map(m => m.content || m.embeds)).slice(0, 200)); }
        for (const id of ids.slice(1)) await games.handleInteraction(click(id, `pg:${s.id}:join`));
        eq(await getBalance('P1'), 5000 - BET, 'host stake taken');
        if (phase === 'running') { s.start(); await sleep(120); }
        const outsider = msg(ch, 'X9', '.توقف'); await games.handleMessage(outsider);
        if (!session.sessionInChannel(ch.id)) throw new Error('an outsider stopped the game');
        await games.handleMessage(msg(ch, 'P1', '.توقف'));
        await sleep(100);
        if (session.sessionInChannel(ch.id)) throw new Error('game still running after stop');
        for (const id of ids) eq(await getBalance(id), 5000, 'refund ' + id);
      });
    }
    await t(`${word}: staff (not the host) can stop it`, async () => {
      const ch = mkChannel();
      const ids = Array.from({ length: n }, (_, i) => 'Q' + (i + 1));
      for (const id of ids) await setBal(id, 5000);
      await games.handleMessage(msg(ch, 'Q1', `.${word} ${BET}`));
      const s = session.sessionInChannel(ch.id);
      if (!s) throw new Error('no lobby: ' + JSON.stringify(ch.sent.map(m => m.content || (m.embeds && 1))).slice(0,200));
      for (const id of ids.slice(1)) await games.handleInteraction(click(id, `pg:${s.id}:join`));
      s.start(); await sleep(100);
      await games.handleMessage(msg(ch, 'MOD', '.توقف', { staff: true }));
      await sleep(100);
      if (session.sessionInChannel(ch.id)) throw new Error('staff stop failed');
      for (const id of ids) eq(await getBalance(id), 5000, 'refund ' + id);
    });
  }

  // slash lobby games (Last Man Standing / Russian Roulette / Hot Potato) share gameManager
  for (const type of ['lms', 'rr', 'hotpotato']) {
    for (const who of ['host', 'staff']) {
      await t(`slash ${type}: ${who} stops → stakes refunded, nothing paid later`, async () => {
        const ch = mkChannel();
        await setBal('H', 5000); await setBal('J', 5000);
        const g = gm.createGame(type, 'H', BET);
        g.channelId = ch.id; g.guildId = 'g';
        const m0 = await ch.send('lobby'); g.messageId = m0.id;
        const stakes = require(path.join(root, 'utils/economy/stakes.js'));
        await stakes.takeStakes(['H'], BET); await stakes.takeStakes(['J'], BET); g.players.push('J');
        if (type === 'lms') { g.allPlayers = [...g.players]; g.status = 'active'; }
        eq(await getBalance('H'), 5000 - BET, 'taken');
        await games.handleMessage(msg(ch, who === 'host' ? 'H' : 'MOD', '.توقف', { staff: who === 'staff' }));
        await sleep(50);
        eq(await getBalance('H'), 5000, 'host refunded'); eq(await getBalance('J'), 5000, 'joiner refunded');
        eq(gm.games.size, 0, 'game removed');
      });
    }
  }
  await t('slash blackjack duel in progress: stop refunds both stakes', async () => {
    const ch = mkChannel();
    await setBal('A', 5000 - BET); await setBal('B', 5000 - BET);
    const d = dm.createDuel('blackjack', 'A', 'B', BET); d.channelId = ch.id; d.started = true; const m0 = await ch.send('bj'); d.messageId = m0.id;
    await games.handleMessage(msg(ch, 'MOD', '.توقف', { staff: true })); await sleep(50);
    eq(await getBalance('A'), 5000, 'A'); eq(await getBalance('B'), 5000, 'B'); eq(dm.duels.size, 0, 'duel gone');
  });


  // Every game played to its natural end with a bet and passive players: it must finish by itself and conserve coins.
  Object.assign(cfg.typing, { introMs: 5, pauseMs: 5, rounds: 1, minMsPerChar: 0, roundMs: 150 });
  Object.assign(cfg.math, { introMs: 5, pauseMs: 5, rounds: 1, roundMs: 150 });
  Object.assign(cfg.chain, { introMs: 5, turnMs: 120, minTurnMs: 120 });
  Object.assign(cfg.guess, { rounds: 1, roundMs: 150, hintAfterMs: 60 });
  Object.assign(cfg.roulette, { pickMs: 60, pauseMs: 5, revealPadMs: 5 });
  Object.assign(cfg.mafia, { nightMs: 30, talkMs: 30, voteMs: 30 });
  Object.assign(cfg.categories, { turnMs: 30, voteMs: 30 });
  for (const [word, n] of SESSION_GAMES) {
    await t(`${word}: plays to the end with a bet and conserves every coin`, async () => {
      const ch = mkChannel();
      const ids = Array.from({ length: n }, (_, i) => 'Z' + (i + 1));
      for (const id of ids) await setBal(id, 5000);
      await games.handleMessage(msg(ch, 'Z1', `.${word} ${BET}`));
      const s = session.sessionInChannel(ch.id);
      if (!s) throw new Error('no lobby');
      for (const id of ids.slice(1)) await games.handleInteraction(click(id, `pg:${s.id}:join`));
      s.start();
      for (let i = 0; i < 700 && session.sessionInChannel(ch.id); i++) await sleep(50);
      if (session.sessionInChannel(ch.id)) { const x = session.sessionInChannel(ch.id); await x.abort('test timeout'); throw new Error('game never finished by itself'); }
      await sleep(150);
      let total = 0; for (const id of ids) total += await getBalance(id);
      eq(total, 5000 * n, 'coins conserved');
      const left = await dbx.all('SELECT * FROM party_stakes');
      eq(left.length, 0, 'no stake rows left behind');
    });
  }

  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
