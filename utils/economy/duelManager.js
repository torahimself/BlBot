const duels = new Map();

function createDuel(type, initiatorId, targetId, amount, extra = {}) {
  const id = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const duel = {
    id, type, initiatorId, targetId, amount,
    messageId: null, channelId: null,
    ...extra,
  };
  duel._timeout = setTimeout(() => duels.delete(id), 180000); // 3 min timeout
  duels.set(id, duel);
  return duel;
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

module.exports = { createDuel, getDuel, deleteDuel, isInDuel, duels };
