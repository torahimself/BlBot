'use strict';
// Optional betting. Every game is free to play; a bet is only ever placed when
// the player chooses an amount. There is NO tax or fee on winnings.
//
// The one rule: a member's NET betting profit (winnings minus losses) in a
// Sunday→Saturday week may not exceed settings.betting.weeklyNetProfitCap.
//   • Losing first creates room to win it back (net, not gross).
//   • At the cap, bets can no longer win extra coins until Sunday.
//
// All payouts go through settle(), which enforces the cap and keeps the books
// (bet_net) in the same transaction as the balance changes. Stakes are taken up
// front by the game itself (spendCoins); settle() pays out what is owed.

const settings = require('./settings');
const time = require('./time');
const dbx = require('./dbx');

const cap = () => settings.betting.weeklyNetProfitCap;

async function weeklyNetOn(userId, week) {
  const row = await dbx.get('SELECT net FROM bet_net WHERE userId = ? AND week = ?', [userId, week]);
  return row ? row.net : 0;
}

async function weeklyNet(userId, now = Date.now()) {
  return weeklyNetOn(userId, time.weekStartKey(now));
}

// How much more NET profit this member may still make this week (0 = at cap).
async function headroom(userId, now = Date.now()) {
  return Math.max(0, cap() - (await weeklyNet(userId, now)));
}

// Used when a bet is placed: refuses a bet from someone who is already at the
// cap (they can still play for free). Returns { ok:true } or { ok:false, userId }.
async function checkCanBet(userIds, now = Date.now()) {
  for (const id of userIds) {
    if ((await headroom(id, now)) <= 0) return { ok: false, userId: id };
  }
  return { ok: true };
}

/**
 * Pays out a finished bet.
 *
 *   kind     'pot'   — players' stakes make up the prizes (duels, lobby games).
 *                      Anything cut by the cap is handed back to the losers, so
 *                      coins are neither created nor destroyed.
 *            'house' — the bot is the opponent (dice, roulette). A cut is simply
 *                      not paid.
 *   stakes   { userId: coins staked }   (already taken from their balances)
 *   payouts  { userId: gross coins the game says they receive } (stake included)
 *
 * Returns { payouts, nets, capped:[userId], totalCut } with the amounts that
 * were REALLY paid.
 */
async function settle({ kind = 'pot', stakes = {}, payouts = {}, now = Date.now() }) {
  const ids = [...new Set([...Object.keys(stakes), ...Object.keys(payouts)])];
  const stake = (id) => Math.max(0, Math.floor(stakes[id] || 0));

  return dbx.exclusive('bets', async () => {
    const week = time.weekStartKey(now);
    const net = {};
    for (const id of ids) net[id] = await weeklyNetOn(id, week);

    const gross = {};
    const cut = {};
    let totalCut = 0;
    for (const id of ids) {
      const s = stake(id);
      const g = Math.max(0, Math.floor(payouts[id] || 0));
      const profit = g - s;
      if (profit > 0) {
        const room = Math.max(0, cap() - net[id]);
        const allowed = Math.min(profit, room);
        gross[id] = s + allowed;
        cut[id] = profit - allowed;
        totalCut += cut[id];
      } else {
        gross[id] = g;
        cut[id] = 0;
      }
    }

    // Pot games: return what the cap cut to the players who lost, in proportion
    // to what each lost.
    if (kind === 'pot' && totalCut > 0) {
      const losers = ids
        .filter(id => gross[id] < stake(id))
        .sort((a, b) => (stake(b) - gross[b]) - (stake(a) - gross[a]));
      const lossSum = losers.reduce((a, id) => a + (stake(id) - gross[id]), 0);
      if (lossSum > 0) {
        const pool = Math.min(totalCut, lossSum);
        let left = pool;
        for (const id of losers) {
          const loss = stake(id) - gross[id];
          const share = Math.min(loss, Math.floor((pool * loss) / lossSum));
          gross[id] += share;
          left -= share;
        }
        for (const id of losers) {            // hand out rounding leftovers
          while (left > 0 && gross[id] < stake(id)) { gross[id]++; left--; }
        }
      }
    }

    const parts = [];
    const nets = {};
    for (const id of ids) {
      const n = gross[id] - stake(id);
      nets[id] = n;
      const u = dbx.lit(id);
      if (gross[id] > 0) {
        parts.push(`INSERT INTO users (userId, balance) VALUES (${u}, ${gross[id]}) ON CONFLICT(userId) DO UPDATE SET balance = balance + ${gross[id]};`);
      }
      if (n !== 0) {
        parts.push(`INSERT INTO bet_net (userId, week, net) VALUES (${u}, ${dbx.lit(week)}, ${n}) ON CONFLICT(userId, week) DO UPDATE SET net = net + ${n};`);
      }
    }
    if (parts.length) await dbx.atomic(parts.join('\n'));

    return { payouts: gross, nets, capped: ids.filter(id => cut[id] > 0), totalCut };
  });
}

module.exports = { weeklyNet, headroom, checkCanBet, settle };
