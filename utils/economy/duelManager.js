const duels = new Map();

const DEFAULT_TIMEOUT_MS = 180000; // 3 min to accept / respond

function createDuel(type, initiatorId, targetId, amount, extra = {}) {
  const id = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const duel = {
    id, type, initiatorId, targetId, amount,
    messageId: null, channelId: null,
    // Optional async callback run when the duel TIMES OUT (not when it is
    // deleted normally). Used by games that have already taken the stakes,
    // so they can hand the coins back instead of silently swallowing them.
    onExpire: null,
    ...extra,
  };
  duel._timeout = setTimeout(() => expireDuel(id), DEFAULT_TIMEOUT_MS);
  duels.set(id, duel);
  return duel;
}

function expireDuel(id) {
  const d = duels.get(id);
  if (!d) return;
  duels.delete(id);
  if (typeof d.onExpire === 'function') {
    Promise.resolve()
      .then(() => d.onExpire(d))
      .catch(err => console.error(`[Duel] onExpire failed for duel ${id}:`, err));
  }
}

// Restart a duel's expiry clock with a new length (e.g. once a blackjack
// game has actually started and needs longer than the 3-minute accept window).
function setDuelTimeout(duel, ms) {
  clearTimeout(duel._timeout);
  duel._timeout = setTimeout(() => expireDuel(duel.id), ms);
}

function getDuel(id) {
  return duels.get(id);
}

function deleteDuel(id) {
  const d = duels.get(id);
  if (d) { clearTimeout(d._timeout); duels.delete(id); }
}

function isInDuel(userId) {
  for (const d of duels.values()) {
    if (d.initiatorId === userId || d.targetId === userId) return true;
  }
  return false;
}

module.exports = { createDuel, getDuel, deleteDuel, setDuelTimeout, isInDuel, duels };
