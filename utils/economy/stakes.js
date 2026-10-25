'use strict';
// Shared helpers for OPTIONAL betting in the games.
//
// A game's `amount` / `betAmount` is 0 when it is played for free. Every coin
// movement in the games goes through here, so a free game can never touch a
// balance, and real bets are settled by engine/betting.js (no tax, weekly NET
// profit cap, books kept in bet_net).

const { updateBalance, spendCoins } = require('./shopManager.js');
const betting = require('./engine/betting.js');
const settings = require('./engine/settings.js');

const isBet = (amount) => Number.isFinite(amount) && amount > 0;

// Takes `amount` from every id atomically (each deduction only succeeds if that
// player can afford it right now). If anyone can't pay, everything already
// taken is returned. Free game → { ok: true } and nothing moves.
async function takeStakes(ids, amount) {
  if (!isBet(amount)) return { ok: true };
  const taken = [];
  for (const id of ids) {
    if (await spendCoins(id, amount)) taken.push(id);
    else {
      for (const t of taken) await updateBalance(t, amount);
      return { ok: false, brokeId: id };
    }
  }
  return { ok: true };
}

// Gives stakes back (cancelled / timed-out / errored game). No-op when free.
async function refundStakes(ids, amount) {
  if (!isBet(amount)) return;
  for (const id of ids) {
    try { await updateBalance(id, amount); }
    catch (err) { console.error(`[Stakes] Refund failed for ${id}:`, err); }
  }
}

// Is anyone already at the weekly net-profit cap? → { ok:false, userId } (they
// can still play for free). Free game → ok.
async function canBet(ids, amount) {
  if (!isBet(amount)) return { ok: true };
  return betting.checkCanBet(ids);
}

// Pays out a finished BET game. stakes/payouts are { userId: coins } (payout is
// the gross amount, stake included). Free games (all stakes 0) return an empty
// result and move nothing. `note` is a ready-made line when the cap trimmed a prize.
async function settleBet({ kind = 'pot', stakes = {}, payouts = {} }) {
  const total = Object.values(stakes).reduce((a, b) => a + (b || 0), 0);
  if (total <= 0) return { payouts: {}, nets: {}, capped: [], totalCut: 0, note: '', free: true };
  const r = await betting.settle({ kind, stakes, payouts });
  r.free = false;
  r.note = r.capped.length
    ? `\n⚠️ <@${r.capped.join('>, <@')}> reached the weekly betting profit limit (**${settings.betting.weeklyNetProfitCap}** coins) — the prize was reduced${kind === 'pot' ? ' and the excess went back to the other player(s)' : ''}.`
    : '';
  return r;
}

const betLabel = (amount) => (isBet(amount) ? `Bet: **${amount}** coins/player` : 'Free game — no bet');

const capRefusal = (userId, who) =>
  `❌ ${who ? `<@${userId}> has` : 'You have'} reached the weekly betting profit limit (**${settings.betting.weeklyNetProfitCap}** coins). ` +
  `${who ? 'Play' : 'You can still play'} for free by leaving the bet empty.`;

module.exports = { isBet, takeStakes, refundStakes, canBet, settleBet, betLabel, capRefusal };
