const { handleLinkEmbed } = require('../utils/linkEmbedder.js');
const activity = require('../utils/economy/engine/activity.js');
const partyGames = require('../utils/games/index.js');
const blocklist = require('../utils/blocklist.js');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot) return;
    if (message.content.startsWith('/')) return;

    // Blocked members get nothing from the bot (see /blocked-users.js). Only a game command earns the one "no access" DM.
    if (blocklist.isBlocked(message.author.id)) {
      if (partyGames.parseTrigger(message.content) || partyGames.isStopCommand(message.content) || partyGames.isHelpCommand(message.content)) blocklist.notice(message.client, message.author.id);
      return;
    }

    // ── Party games: triggers (.علم .مافيا .انسان …) and in-game answers ──
    await partyGames.handleMessage(message);

    // ── Link embed (Twitter / TikTok / Instagram) ──────────────────────────
    // If a supported link is found and the user has the embed role,
    // the original message is deleted and reposted with a proxy URL.
    // We return early so the deleted message doesn't earn coins.
    const embedded = await handleLinkEmbed(message);
    if (embedded) return;

    // ── Economy: eligible typing earns coins (filters, caps, boosts, drops,
    // milestones and event points are all handled inside the engine) ───────
    await activity.onMessage(message, message.client);
  },
};
