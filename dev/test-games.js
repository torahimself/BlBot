'use strict';
// Game-flow tests with mocked Discord interactions. In-memory DB.
//   node dev/test-games.js
process.env.BL_ECONOMY_DB = ':memory:';
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const db = require(path.join(root, 'utils/economy/database.js'));
const dbx = require(path.join(root, 'utils/economy/engine/dbx.js'));
const time = require(path.join(root, 'utils/economy/engine/time.js'));
const betting = require(path.join(root, 'utils/economy/engine/betting.js'));
const { getBalance, updateBalance } = require(path.join(root, 'utils/economy/shopManager.js'));
const gameHandler = require(path.join(root, 'handlers/gameHandler.js'));
const gameManager = require(path.join(root, 'utils/economy/gameManager.js'));
const duelManager = require(path.join(root, 'utils/economy/duelManager.js'));

const CH = '1415933682748751923';
const cmd = (n) => require(path.join(root, 'commands/economy', n + '.js'));

// ── mocks ──────────────────────────────────────────────────────────────────
function world() {
  const msgs = new Map();
  let n = 0;
  const mkMsg = (o) => {
    const m = { id: 'm' + (++n), content: '', components: [], edit: async (x) => { Object.assign(m, x); return m; } };
    Object.assign(m, o); msgs.set(m.id, m); return m;
  };
  const sent = [];
  const channel = { id: CH, messages: { fetch: async (id) => msgs.get(id) || null }, send: async (c) => { sent.push(c); return mkMsg({ content: c }); } };
  const client = {
    channels: { cache: { get: () => channel } },
    guilds: { cache: { get: () => null } },
    users: { fetch: async () => ({ send: async () => {} }) },
  };
  return { msgs, sent, channel, client, mkMsg };
}
function slash(w, userId, opts = {}) {
  let last = null;
  const it = {
    user: { id: userId, tag: userId }, channelId: CH, guildId: 'g', client: w.client, channel: w.channel,
    options: {
      getUser: (k) => (opts[k] ? { id: opts[k], bot: false, tag: opts[k] } : null),
      getInteger: (k) => (opts[k] === undefined ? null : opts[k]),
      getString: (k) => opts[k] ?? null,
    },
    editReply: async (o) => { const c = typeof o === 'string' ? { content: o } : o; last = w.mkMsg(c); it.reply_ = last; return last; },
  };
  it.text = () => (last ? last.content : '');
  return it;
}
function click(w, userId, customId) {
  const it = { customId, user: { id: userId }, channel: w.channel, client: w.client, replies: [],
    reply: async (o) => { it.replies.push(o); }, showModal: async () => {} };
  return it;
}
const bal = (id) => getBalance(id);
async function setBal(id, v) { await dbx.run('INSERT INTO users (userId, balance) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET balance = ?', [id, v, v]); }
async function netOf(id) { return betting.weeklyNet(id); }
async function setNet(id, v) {
  await dbx.run('INSERT INTO bet_net (userId, week, net) VALUES (?, ?, ?) ON CONFLICT(userId, week) DO UPDATE SET net = ?', [id, time.weekStartKey(Date.now()), v, v]);
}
async function reset(...ids) {
  for (const d of [...duelManager.duels.values()]) duelManager.deleteDuel(d.id);
  for (const id of ids) { await setBal(id, 10000); await dbx.run('DELETE FROM bet_net WHERE userId = ?', [id]); } }
const withRandom = async (vals, fn) => {
  const orig = Math.random; let i = 0;
  Math.random = () => (i < vals.length ? vals[i++] : 0.5);
  try { return await fn(); } finally { Math.random = orig; }
};
const NOCOINS = /\*\*\d+\*\* coins|coins\/player|Pot:/i;

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n    ', e.message); }
}

// run a coinflip start→accept→pick
async function playCoinflip(w, bet, rnd) {
  const it = slash(w, 'A', { user: 'B', ...(bet ? { bet } : {}) });
  await cmd('coinflip').execute(it);
  const duel = [...duelManager.duels.values()][0];
  assert(duel, 'duel created: ' + it.text());
  assert.strictEqual(duel.amount, bet || 0);
  await gameHandler.handleButton(click(w, 'B', `coinflip_accept_${duel.id}`));
  const pick = click(w, 'A', `coinflip_heads_${duel.id}`);
  await withRandom([rnd], () => gameHandler.handleButton(pick));
  return w.msgs.get(duel.messageId);
}

(async () => {
  await db.ready;
  console.log('Optional betting — game flow tests');

  await t('free coinflip moves no coins, no coin text, no bet_net', async () => {
    const w = world(); await reset('A', 'B');
    const m = await playCoinflip(w, 0, 0.1);
    assert.strictEqual(await bal('A'), 10000); assert.strictEqual(await bal('B'), 10000);
    assert.strictEqual(await netOf('A'), 0);
    assert(!NOCOINS.test(m.content), m.content);
  });

  await t('bet coinflip: stakes + payout conserve coins, winner +bet, no tax', async () => {
    const w = world(); await reset('A', 'B');
    await playCoinflip(w, 500, 0.1);            // heads → A wins
    assert.strictEqual(await bal('A'), 10500); assert.strictEqual(await bal('B'), 9500);
    assert.strictEqual(await netOf('A'), 500); assert.strictEqual(await netOf('B'), -500);
  });

  await t('weekly cap clamps pot prize and refunds the excess to the loser', async () => {
    const w = world(); await reset('A', 'B'); await setNet('A', 9800);
    const m = await playCoinflip(w, 1000, 0.1); // A would win 1000 profit, room 200
    assert.strictEqual(await bal('A'), 10200); assert.strictEqual(await bal('B'), 9800);
    assert.strictEqual(await bal('A') + await bal('B'), 20000, 'coins conserved');
    assert.strictEqual(await netOf('A'), 10000);
    assert(/limit/.test(m.content), m.content);
  });

  await t('net (not gross) tracking: a loss makes room to win it back', async () => {
    const w = world(); await reset('A', 'B'); await setNet('A', 10000);
    const refused = slash(w, 'A', { user: 'B', bet: 100 });
    await cmd('coinflip').execute(refused);
    assert(/limit/.test(refused.text()) && duelManager.duels.size === 0, refused.text());
    await setNet('A', 9000);                    // room of 1000
    await playCoinflip(w, 600, 0.1);
    assert.strictEqual(await netOf('A'), 9600);
  });

  await t('a player at the cap can still play FREE', async () => {
    const w = world(); await reset('A', 'B'); await setNet('A', 10000);
    await playCoinflip(w, 0, 0.1);
    assert.strictEqual(await bal('A'), 10000);
  });

  await t('declined bet duel moves nothing', async () => {
    const w = world(); await reset('A', 'B');
    await cmd('coinflip').execute(slash(w, 'A', { user: 'B', bet: 700 }));
    const duel = [...duelManager.duels.values()][0];
    await gameHandler.handleButton(click(w, 'B', `coinflip_decline_${duel.id}`));
    assert.strictEqual(await bal('A'), 10000); assert.strictEqual(await bal('B'), 10000);
    assert.strictEqual(duelManager.duels.size, 0);
  });

  await t('number duel: free win moves nothing; bet win pays; tie refunds nothing taken', async () => {
    for (const [bet, expectA] of [[0, 10000], [300, 10300]]) {
      const w = world(); await reset('A', 'B');
      await cmd('numberduel').execute(slash(w, 'A', { user: 'B', ...(bet ? { bet } : {}) }));
      const duel = [...duelManager.duels.values()][0];
      await gameHandler.handleButton(click(w, 'B', `numberduel_accept_${duel.id}`));
      const modal = (role, uid, n) => ({ customId: `numberduel_pick_${duel.id}_${role}`, user: { id: uid }, channel: w.channel, client: w.client,
        fields: { getTextInputValue: () => String(n) }, reply: async () => {} });
      await gameHandler.handleModal(modal('target', 'B', 1));
      await withRandom([0.49], () => gameHandler.handleModal(modal('initiator', 'A', 5))); // bot picks 5 → A wins
      assert.strictEqual(await bal('A'), expectA); assert.strictEqual(await bal('B'), 20000 - expectA);
      if (!bet) assert(!NOCOINS.test(w.msgs.get(duel.messageId).content));
    }
    // tie
    const w = world(); await reset('A', 'B');
    await cmd('numberduel').execute(slash(w, 'A', { user: 'B', bet: 300 }));
    const duel = [...duelManager.duels.values()][0];
    await gameHandler.handleButton(click(w, 'B', `numberduel_accept_${duel.id}`));
    const modal = (role, uid, n) => ({ customId: `numberduel_pick_${duel.id}_${role}`, user: { id: uid }, channel: w.channel, client: w.client, fields: { getTextInputValue: () => String(n) }, reply: async () => {} });
    await gameHandler.handleModal(modal('target', 'B', 4));
    await withRandom([0.49], () => gameHandler.handleModal(modal('initiator', 'A', 6))); // diffs 1 and 1
    assert.strictEqual(await bal('A'), 10000); assert.strictEqual(await bal('B'), 10000);
  });

  await t('blackjack: bet timeout refunds both; free timeout moves nothing', async () => {
    for (const bet of [400, 0]) {
      const w = world(); await reset('A', 'B');
      await cmd('blackjack').execute(slash(w, 'A', { user: 'B', ...(bet ? { bet } : {}) }));
      const duel = [...duelManager.duels.values()][0];
      await gameHandler.handleButton(click(w, 'B', `bj_accept_${duel.id}`));
      assert.strictEqual(await bal('A'), 10000 - bet); assert.strictEqual(await bal('B'), 10000 - bet);
      await duel.onExpire(duel);
      assert.strictEqual(await bal('A'), 10000); assert.strictEqual(await bal('B'), 10000);
      duelManager.deleteDuel(duel.id);
    }
  });

  await t('blackjack resolve: bet winner paid', async () => {
    const w = world(); await reset('A', 'B');
    await cmd('blackjack').execute(slash(w, 'A', { user: 'B', bet: 250 }));
    const duel = [...duelManager.duels.values()][0];
    await gameHandler.handleButton(click(w, 'B', `bj_accept_${duel.id}`));
    duel.hands.A = [{ display: '10♠', value: 10 }, { display: 'K♠', value: 10 }];
    duel.hands.B = [{ display: '2♠', value: 2 }, { display: '3♠', value: 3 }];
    await gameHandler.handleButton(click(w, 'A', `bj_stand_${duel.id}_A`));
    await gameHandler.handleButton(click(w, 'B', `bj_stand_${duel.id}_B`));
    assert.strictEqual(await bal('A'), 10250); assert.strictEqual(await bal('B'), 9750);
  });

  await t('dice: free no coins; bet win pays 3x profit; loss recorded; cap clamp', async () => {
    const w = world(); await reset('A');
    let it = slash(w, 'A', { guess: 2 });
    await withRandom([0.3], () => cmd('dice').execute(it));   // roll 2 → win (free)
    assert.strictEqual(await bal('A'), 10000); assert(!NOCOINS.test(it.text()), it.text());
    it = slash(w, 'A', { guess: 2, bet: 100 });
    await withRandom([0.3], () => cmd('dice').execute(it));
    assert.strictEqual(await bal('A'), 10300); assert.strictEqual(await netOf('A'), 300);
    it = slash(w, 'A', { guess: 1, bet: 100 });
    await withRandom([0.9], () => cmd('dice').execute(it));
    assert.strictEqual(await bal('A'), 10200); assert.strictEqual(await netOf('A'), 200);
    await setNet('A', 9900);
    it = slash(w, 'A', { guess: 2, bet: 1000 });
    await withRandom([0.3], () => cmd('dice').execute(it));   // profit 3000, room 100
    assert.strictEqual(await netOf('A'), 10000);
    assert.strictEqual(await bal('A'), 10200 - 1000 + 1000 + 100);
    it = slash(w, 'A', { guess: 2, bet: 10 });
    await cmd('dice').execute(it);                            // at cap → refused, nothing taken
    assert(/limit/.test(it.text())); assert.strictEqual(await bal('A'), 10300);
  });

  await t('roulette: free no coins; bet win/lose; insufficient funds refused', async () => {
    const w = world(); await reset('A');
    let it = slash(w, 'A', { color: 'red' });
    await withRandom([0.1], () => cmd('roulette').execute(it));
    assert.strictEqual(await bal('A'), 10000); assert(!NOCOINS.test(it.text()), it.text());
    it = slash(w, 'A', { color: 'red', bet: 500 });
    await withRandom([0.1], () => cmd('roulette').execute(it));
    assert.strictEqual(await bal('A'), 10500);
    it = slash(w, 'A', { color: 'red', bet: 500 });
    await withRandom([0.9], () => cmd('roulette').execute(it));
    assert.strictEqual(await bal('A'), 10000);
    await setBal('A', 50);
    it = slash(w, 'A', { color: 'red', bet: 500 });
    await cmd('roulette').execute(it);
    assert.strictEqual(await bal('A'), 50);
  });

  // lobby games ------------------------------------------------------------
  const realST = global.setTimeout;
  async function startLobby(name, w, host, bet) {
    const captured = [];
    global.setTimeout = (fn, ms, ...a) => { if (ms === 30000) { captured.push(fn); return 0; } return realST(fn, ms, ...a); };
    try { await cmd(name).execute(slash(w, host, bet ? { bet } : {})); } finally { global.setTimeout = realST; }
    return { game: [...gameManager.games.values()].pop(), fire: captured[0] };
  }
  const fast = async (fn) => { global.setTimeout = (f, ms, ...a) => realST(f, 0, ...a); try { return await fn(); } finally { global.setTimeout = realST; } };

  await t('lobby with <2 players refunds the host (bet) / nothing (free)', async () => {
    for (const bet of [200, 0]) {
      const w = world(); await reset('A'); gameManager.games.clear();
      const { game, fire } = await startLobby('hotpotato', w, 'A', bet);
      assert.strictEqual(await bal('A'), 10000 - bet);
      await fire();
      assert.strictEqual(await bal('A'), 10000); assert.strictEqual(gameManager.games.size, 0);
    }
  });

  await t('last man standing: bet pot conserved, free moves nothing', async () => {
    for (const bet of [100, 0]) {
      const w = world(); await reset('A', 'B', 'C'); gameManager.games.clear();
      const { game } = await startLobby('lastmanstanding', w, 'A', bet);
      for (const u of ['B', 'C']) await gameHandler.handleButton(click(w, u, `lms_join_${game.id}`));
      assert.strictEqual(game.players.length, 3);
      assert.strictEqual(await bal('B'), 10000 - bet);
      await fast(() => gameManager.runLMS(game, w.client));
      const total = (await bal('A')) + (await bal('B')) + (await bal('C'));
      assert.strictEqual(total, 30000);
      const winner = w.sent[w.sent.length - 1];
      if (bet) assert(/wins \*\*300\*\* coins/.test(winner), winner); else assert(!NOCOINS.test(winner), winner);
      assert.strictEqual(gameManager.games.size, 0);
    }
  });

  await t('lobby join refused for someone at the weekly cap (bet game only)', async () => {
    const w = world(); await reset('A', 'B'); await setNet('B', 10000); gameManager.games.clear();
    const { game } = await startLobby('russianroulette', w, 'A', 100);
    const j = click(w, 'B', `rr_join_${game.id}`);
    await gameHandler.handleButton(j);
    assert.strictEqual(game.players.length, 1); assert.strictEqual(await bal('B'), 10000);
    assert(/limit/.test(j.replies[0].content));
    gameManager.deleteGame(game.id);
  });

  await t('lobby pot cap: winner clamped, excess returned to losers, coins conserved', async () => {
    const w = world(); await reset('A', 'B', 'C'); await setNet('A', 9500); gameManager.games.clear();
    const g = gameManager.createGame('lms', 'A', 1000);
    g.players = ['A', 'B', 'C']; g.allPlayers = ['A', 'B', 'C'];
    for (const u of ['A', 'B', 'C']) await dbx.run('UPDATE users SET balance = balance - 1000 WHERE userId = ?', [u]);
    const res = await gameManager.payWinner(g, 'A', 3000);       // profit 2000, room 500
    assert.strictEqual(res.prize, 1500);
    const total = (await bal('A')) + (await bal('B')) + (await bal('C'));
    assert.strictEqual(total, 30000);
    assert.strictEqual(await netOf('A'), 10000);
    assert.strictEqual(await gameManager.payWinner(g, 'B', 3000), null, 'second payout refused');
    assert.strictEqual((await bal('A')) + (await bal('B')) + (await bal('C')), 30000);
  });

  await t('refundGame: bet returns stakes once; free game moves nothing', async () => {
    for (const bet of [150, 0]) {
      const w = world(); await reset('A', 'B'); gameManager.games.clear();
      const g = gameManager.createGame('rr', 'A', bet);
      g.players = ['A', 'B']; g.allPlayers = ['A', 'B']; g.channelId = CH;
      for (const u of ['A', 'B']) await dbx.run('UPDATE users SET balance = balance - ? WHERE userId = ?', [bet, u]);
      await gameManager.refundGame(g, w.client, 'boom');
      await gameManager.refundGame(g, w.client, 'boom');          // second call is a no-op
      assert.strictEqual(await bal('A'), 10000); assert.strictEqual(await bal('B'), 10000);
      assert(bet ? /refunded/.test(w.sent[0]) : !/refund/.test(w.sent[0]), w.sent[0]);
    }
  });

  await t('hot potato / russian roulette free: payWinner moves nothing', async () => {
    const w = world(); await reset('A', 'B'); gameManager.games.clear();
    const g = gameManager.createGame('rr', 'A', 0); g.players = ['A', 'B']; g.allPlayers = ['A', 'B'];
    const r = await gameManager.payWinner(g, 'A', 0);
    assert(r.free); assert.strictEqual(await bal('A'), 10000); assert.strictEqual(await netOf('A'), 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
