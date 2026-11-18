'use strict';
// A bet must pay the pot to the real winner in every game (not just refund when nobody answers).
process.env.BL_ECONOMY_DB = ':memory:';
const path = require('path'); const root = path.join(__dirname, '..');
const db = require(path.join(root, 'utils/economy/database.js'));
const dbx = require(path.join(root, 'utils/economy/engine/dbx.js'));
const { getBalance } = require(path.join(root, 'utils/economy/shopManager.js'));
const cfg = require(path.join(root, 'utils/games/config.js'));
const games = require(path.join(root, 'utils/games/index.js'));
const session = require(path.join(root, 'utils/games/session.js'));
cfg.channels = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let mid = 0, passed = 0, failed = 0;
const t = async (n, f) => { try { await f(); passed++; console.log('  ✓', n); } catch (e) { failed++; console.log('  ✗', n, '\n     ', e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${a} !== ${b}`); };
const mkChannel = () => { const sent = []; const mk = (c) => { const m = { id: 'm' + (++mid), ...(typeof c === 'string' ? { content: c } : c), edit: async (x) => { Object.assign(m, x); return m; }, react: async () => {}, reply: async () => {}, delete: async () => {} }; sent.push(m); return m; }; const ch = { id: 'ch' + (++mid), sent, send: async (c) => mk(c), isTextBased: () => true }; ch.messages = { fetch: async (id) => sent.find(m => m.id === id) || null }; return ch; };
const client = (ch) => ({ channels: { cache: { get: () => ch }, fetch: async () => ch } });
const msg = (ch, userId, content) => ({ author: { id: userId, bot: false, username: userId }, guild: { id: 'g' }, channel: ch, client: client(ch), member: { displayName: userId, permissions: { has: () => false }, roles: { cache: { has: () => false } } }, content, reply: async () => ({ delete: async () => {} }), react: async () => {} });
const click = (userId, cid) => ({ customId: cid, user: { id: userId, username: userId }, member: { displayName: userId }, reply: async () => {}, deferUpdate: async () => {}, update: async () => {} });
const setBal = (id, v) => dbx.run('INSERT INTO users (userId,balance) VALUES (?,?) ON CONFLICT(userId) DO UPDATE SET balance=?', [id, v, v]);
const BET = 500;

(async () => {
  await db.ready;
  Object.assign(cfg.typing, { introMs: 5, pauseMs: 5, rounds: 1, minMsPerChar: 0, roundMs: 2000 });
  Object.assign(cfg.math, { introMs: 5, pauseMs: 5, rounds: 1, roundMs: 2000 });
  Object.assign(cfg.guess, { introMs: 5, pauseMs: 5, rounds: 1 });

  for (const word of ['كتابة', 'حساب']) {
    await t(`${word}: the player who answers first wins the whole pot`, async () => {
      const ch = mkChannel(); await setBal('A', 5000); await setBal('B', 5000);
      await games.handleMessage(msg(ch, 'A', `.${word} ${BET}`));
      const s = session.sessionInChannel(ch.id); if (!s) throw new Error('no lobby');
      await games.handleInteraction(click('B', `pg:${s.id}:join`));
      eq(await getBalance('A'), 4500, 'A stake'); eq(await getBalance('B'), 4500, 'B stake');
      s.start();
      for (let i = 0; i < 100 && !(s.data.current && s.data.current.q); i++) await sleep(20);
      const q = s.data.current.q;
      // answer exactly as a player would see it
      const answer = word === 'كتابة' ? q.reveal.replace(/^.*\*\*(.*)\*\*.*$/, '$1') : String(q.reveal.match(/\*\*(.+?)\*\*/)[1]).replace(/[^\d-]/g, '');
      const m = msg(ch, 'B', answer); await games.handleMessage(m);
      for (let i = 0; i < 100 && session.sessionInChannel(ch.id); i++) await sleep(30);
      await sleep(100);
      eq(await getBalance('B'), 5500, 'B wins +500'); eq(await getBalance('A'), 4500, 'A loses 500');
      const last = ch.sent[ch.sent.length - 1]; const txt = JSON.stringify(last.embeds || last.content);
      if (!/ربح/.test(txt)) throw new Error('result message does not say who won coins: ' + txt.slice(0, 300));
    });
  }
  await t('amounts: Arabic-Indic / Persian digits, separators, k / ك suffix all become real bets', () => {
    const cases = [['.كتابة 100', 100], ['.كتابة ١٠٠', 100], ['.حساب ۲۵۰', 250], ['.سلسلة 1,000', 1000], ['.علم 2k', 2000], ['.علم 1.5k', 1500], ['.روليت ٣ك', 3000], ['.مافيا 50000000', 50000000]];
    for (const [text, want] of cases) { const r = games.parseTrigger(text); if (!r || r.error || r.bet !== want) throw new Error(`${text} → ${JSON.stringify(r)} (wanted ${want})`); }
    eq(games.parseTrigger('.علم').bet, 0, 'no amount = free');
    eq(games.parseTrigger('.علم سهل').bet, 0, 'a stray word stays free');
    if (!games.parseTrigger('.علم 5').error) throw new Error('below the minimum must say so');
    if (!games.parseTrigger('.علم ٠').error) throw new Error('zero must say so');
  });
  await t('typing an Arabic-digit bet really takes the stake and pays the pot', async () => {
    const ch = mkChannel(); await setBal('A', 5000); await setBal('B', 5000);
    await games.handleMessage(msg(ch, 'A', '.كتابة ٣٠٠'));
    const s = session.sessionInChannel(ch.id); if (!s) throw new Error('no lobby'); eq(s.bet, 300, 'bet read');
    eq(await getBalance('A'), 4700, 'stake taken from the host');
    await s.abort('test'); await sleep(50); eq(await getBalance('A'), 5000, 'refunded');
  });
  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
