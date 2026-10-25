'use strict';
// Best-effort direct messages. A failed DM (closed DMs, deleted account, ...)
// never affects the reward it was announcing — the reward is always saved first.

const settings = require('./settings');

const lastSent = new Map();   // "kind:userId" -> timestamp

function pruneCooldowns(now) {
  if (lastSent.size < 5000) return;
  for (const [k, t] of lastSent) if (now - t > 24 * 60 * 60 * 1000) lastSent.delete(k);
}

/**
 * @param {object|null} client
 * @param {string} userId
 * @param {string|object} content   text or a discord.js message payload
 * @param {{cooldownKey?:string, cooldownMs?:number, now?:number}} [opts]
 * @returns {Promise<boolean>} true if a DM was actually delivered
 */
async function dm(client, userId, content, opts = {}) {
  if (!client || !client.users) return false;
  const now = opts.now ?? Date.now();
  if (opts.cooldownKey) {
    const k = `${opts.cooldownKey}:${userId}`;
    if (now - (lastSent.get(k) || 0) < (opts.cooldownMs || 0)) return false;
    lastSent.set(k, now);
    pruneCooldowns(now);
  }
  try {
    const user = await client.users.fetch(userId);
    await user.send(content);
    return true;
  } catch (_) {
    return false;
  }
}

// Sends a message to the developer (settings.devUserId, DEV_USER_ID, or the
// bot application's owner / team owner).
async function notifyDeveloper(client, content) {
  // Preferred: post in the developer channel and ping the developer role.
  const dn = settings.devNotify;
  if (client && dn && dn.channelId) {
    try {
      const ch = await client.channels.fetch(dn.channelId);
      if (ch && ch.isTextBased()) {
        const ping = dn.roleId ? `<@&${dn.roleId}> ` : '';
        await ch.send({ content: (ping + content).slice(0, 1990), allowedMentions: { roles: dn.roleId ? [dn.roleId] : [] } });
        return true;
      }
    } catch (err) {
      console.error('[Economy] Dev channel post failed, falling back to DM:', err.message);
    }
  }
  try {
    if (!client || !client.users) return false;
    let userId = settings.devUserId;
    if (!userId && client.application) {
      const app = await client.application.fetch();
      const owner = app.owner;
      if (owner) userId = owner.id && owner.username ? owner.id : (owner.ownerId || (owner.owner && owner.owner.user && owner.owner.user.id));
    }
    if (!userId) {
      console.warn('[Economy] No developer to notify (set DEV_USER_ID in .env).');
      return false;
    }
    const user = await client.users.fetch(userId);
    await user.send(content);
    return true;
  } catch (err) {
    console.error('[Economy] Could not DM the developer:', err.message);
    return false;
  }
}

module.exports = { dm, notifyDeveloper };
