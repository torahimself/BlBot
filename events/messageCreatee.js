const { processMessage } = require('../utils/economy/wordTracker.js');
const { handleLinkEmbed } = require('../utils/linkEmbedder.js');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot) return;
    if (message.content.startsWith('/')) return;

    // ── Link embed (Twitter / TikTok / Instagram) ──────────────────────────
    // If a supported link is found and the user has the embed role,
    // the original message is deleted and reposted with a proxy URL.
    // We return early so the deleted message doesn't hit word tracking.
    const embedded = await handleLinkEmbed(message);
    if (embedded) return;

    // ── Economy: word/attachment tracking ─────────────────────────────────
    await processMessage(message);
  },
};
