'use strict';
// Ten-tier milestone tracks for typing (eligible characters) and voice
// (eligible minutes). Each tier pays coins AND unlocks a profile title.
//
// A tier is claimed exactly once: the claim row, the coins and the title are
// written in one transaction (dbx.bundleSql with a claim), so a crash or a
// double-check can never pay a milestone twice or half-pay it.

const settings = require('./settings');
const dbx = require('./dbx');
const notify = require('./notify');

const titleId = (track, tier) => `ms_${track}_${tier}`;

// userId:track -> index of the next unclaimed tier (0–10). Avoids a database
// read on every message; reloaded from the claims table after a restart.
const nextIndex = new Map();

async function loadNext(userId, track) {
  const rows = await dbx.all('SELECT tier FROM milestone_claims WHERE userId = ? AND track = ?', [userId, track]);
  const have = new Set(rows.map(r => r.tier));
  let i = 0;
  while (i < settings.milestones[track].tiers.length && have.has(i + 1)) i++;
  return i;
}

function formatThreshold(track, value) {
  if (track === 'voice') {
    const hours = value / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  }
  return value.toLocaleString('en-US');
}

/**
 * Awards every tier the new total has reached. Caller holds the per-user lock.
 * @returns {Promise<Array>} the tiers granted by this call
 */
async function checkLocked(userId, track, total, { now = Date.now(), client = null } = {}) {
  const def = settings.milestones[track];
  const key = `${userId}:${track}`;
  let idx = nextIndex.get(key);
  if (idx === undefined) {
    idx = await loadNext(userId, track);
    nextIndex.set(key, idx);
  }
  if (idx >= def.tiers.length || total < def.tiers[idx].threshold) return [];

  const granted = [];
  while (idx < def.tiers.length && total >= def.tiers[idx].threshold) {
    const tier = def.tiers[idx];
    const n = idx + 1;
    await dbx.atomic(dbx.bundleSql({
      userId,
      coins: tier.coins,
      titles: [{ id: titleId(track, n), category: 'milestone' }],
      claim: { table: 'milestone_claims', cols: { userId, track, tier: n, claimedAt: now } },
      now,
    }));
    granted.push({ track, tier: n, ...tier });
    idx++;
  }
  nextIndex.set(key, idx);

  if (settings.notifications.milestoneDm) {
    for (const g of granted) {
      notify.dm(client, userId,
        `🏆 **Milestone unlocked!** ${g.emoji} **${g.name}** — ${def.label} tier ${g.tier}/${def.tiers.length}\n` +
        `Reward: **+${g.coins.toLocaleString('en-US')}** coins and a new title. See **/profile**.`,
        { now }).catch(() => {});
    }
  }
  return granted;
}

// For tests / the simulator: forget cached positions.
function resetCache() { nextIndex.clear(); }

module.exports = { checkLocked, titleId, formatThreshold, resetCache };
