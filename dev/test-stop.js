'use strict';
// «.توقف» — the member who started a game (or a moderator) stops it. In-memory DB, mocked Discord.
//   node dev/test-stop.js
process.env.BL_ECONOMY_DB = ':memory:';
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const db = require(path.join(root, 'utils/economy/database.js'));
const dbx = require(path.join(root, 'utils/economy/engine/dbx.js'));
const { getBalance } = require(path.join(root, 'utils/economy/shopManager.js'));
const cfg = require(path.join(root, 'utils/games/config.js'));
const games = require(path.join(root, 'utils/games/index.js'));
const session = require(path.join(root, 'utils/games/session.js'));

cfg.channels = [];
cfg.lobby.fullStartMs = 20; cfg.lobby.autoStartMs = 20;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let mid = 0;
function mkChannel(id = 'sch' + (++mid)) {
  const sent = [];
  const mk = (c) => { const m = { id: 'm' + (++mid), ...(typeof c === 'string' ? { content: c } : c), edit: async (x) => { Object.assign(m, x); return m; }, react: async () => {}, reply: async () => {}, delete: async () => {} }; sent.push(m); return m; };
  return { id, sent, send: async (c) => mk(c), isTextBased: () => true };
}
function mkMessage(ch, userId, content, perms = []) {
  const replies = [];
  return { author: { id: userId, bot: false, username: userId }, guild: { id: 'g' }, channel: ch,
    member: { displayName: userId, permissions: { has: (p) => perms.includes(p) } },
    content, replies, reply: async (c) => { replies.push(c); return { delete: async () => {} }; }, react: async () => {} };
}
const click = (userId, s, action) => games.handleInteraction({ customId: `pg:${s.id}:${action}`, user: { id: userId, username: userId }, member: { displayName: userId }, replies: [], reply: async () => {}, deferUpdate: async () => {} });
async function setBal(id, v) { await dbx.run('INSERT INTO users (userId, balance) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET balance = ?', [id, v, v]); }
const bal = (id) => getBalance(id);
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); } }
const texts = (ch) => ch.sent.map(m => (m.content || '') + ' ' + JSON.stringify(m.embeds || [])).join('\n');

async function running(bet, players = ['A', 'B', 'C']) {
  for (const s of [...session.sessions.values()]) await s.abort('reset').catch(() => {});
  for (const p of players) await setBal(p, 10000);
  const ch = mkChannel();
  await games.handleMessage(mkMessage(ch, players[0], bet ? `.علم ${bet}` : '.علم'));
  const s = session.sessionInChannel(ch.id); assert(s, 'lobby');
  for (const p of players.slice(1)) await click(p, s, 'join');
  s.checkAutoStart();
  for (let i = 0; i < 100 && s.status !== 'running'; i++) await sleep(20);
  assert.strictEqual(s.status, 'running'); return { ch, s };
}

(async () => {
  await db.ready;
  console.log('.توقف');
  await t('only exact «.توقف» (and its aliases) is the stop command', () => {
    for (const x of ['.توقف', '.ايقاف', '.إيقاف', '.وقف', '.ستوب', '.توقّف']) assert.strictEqual(games.isStopCommand(x), true, x);
    for (const x of ['توقف', '.توقف الان', '.توقفوا', '.علم', 'قف', '', null, '. ']) assert.strictEqual(games.isStopCommand(x), false, String(x));
  });
  await t('the host stops a RUNNING game: it ends at once, every stake comes back, no timers are left', async () => {
    const { ch, s } = await running(100);
    assert.strictEqual(await bal('B'), 9900, 'stake taken');
    const m = mkMessage(ch, 'A', '.توقف'); assert.strictEqual(await games.handleMessage(m), true);
    assert.strictEqual(s.status, 'done'); assert.strictEqual(session.sessionInChannel(ch.id), undefined);
    for (const p of ['A', 'B', 'C']) assert.strictEqual(await bal(p), 10000, p + ' refunded');
    const out = texts(ch); assert(/أوقفها <@A>/.test(out) && /تم إرجاع الرهانات/.test(out));
    await sleep(60); assert.strictEqual(s.timers.size, 0, 'no stale timers');
    // the channel is free again
    await games.handleMessage(mkMessage(ch, 'B', '.علم')); assert(session.sessionInChannel(ch.id), 'a new game can start');
    await session.sessionInChannel(ch.id).abort('x');
  });
  await t('another player cannot stop it: a short refusal, the game goes on, nobody is refunded', async () => {
    const { ch, s } = await running(100);
    const m = mkMessage(ch, 'B', '.توقف'); assert.strictEqual(await games.handleMessage(m), true);
    assert.strictEqual(s.status, 'running'); assert(/فقط من بدأ اللعبة/.test(m.replies[0].content) && m.replies[0].content.includes('<@A>'));
    assert.strictEqual(await bal('B'), 9900);
    await s.abort('cleanup');
  });
  await t('a moderator (Manage Messages / Administrator) can stop any game', async () => {
    for (const perm of ['ManageMessages', 'Administrator']) {
      const { ch, s } = await running(50);
      await games.handleMessage(mkMessage(ch, 'MOD', '.توقف', [perm]));
      assert.strictEqual(s.status, 'done', perm); assert.strictEqual(await bal('A'), 10000);
    }
  });
  await t('a LOBBY is cancelled by the host too, and the stake returns', async () => {
    for (const s of [...session.sessions.values()]) await s.abort('reset');
    await setBal('A', 10000); const ch = mkChannel();
    await games.handleMessage(mkMessage(ch, 'A', '.علم 300'));
    const s = session.sessionInChannel(ch.id); assert.strictEqual(await bal('A'), 9700);
    await games.handleMessage(mkMessage(ch, 'A', '.توقف'));
    assert.strictEqual(s.status, 'done'); assert.strictEqual(await bal('A'), 10000);
    assert(/أوقفها <@A>/.test(texts(ch)));
  });
  await t('no game in the channel → silence (nothing is sent, nothing starts)', async () => {
    for (const s of [...session.sessions.values()]) await s.abort('reset');
    const ch = mkChannel(); const m = mkMessage(ch, 'A', '.توقف');
    assert.strictEqual(await games.handleMessage(m), true); assert.strictEqual(m.replies.length, 0); assert.strictEqual(ch.sent.length, 0);
    assert.strictEqual(session.sessionInChannel(ch.id), undefined);
  });
  await t('stopping twice is harmless; a game in ANOTHER channel is untouched', async () => {
    const a = await running(0); const other = mkChannel();
    await setBal('Z', 10000); await games.handleMessage(mkMessage(other, 'Z', '.علم'));
    const sz = session.sessionInChannel(other.id);
    await Promise.all([games.handleMessage(mkMessage(a.ch, 'A', '.توقف')), games.handleMessage(mkMessage(a.ch, 'A', '.توقف'))]);
    assert.strictEqual(a.s.status, 'done'); assert.strictEqual(sz.status, 'lobby', 'other channel untouched');
    assert.strictEqual(texts(a.ch).split("أوقفها").length - 1, 1, 'announced once');
    await sz.abort('x');
  });

  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
