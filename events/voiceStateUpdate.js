const { onVoiceJoin, onVoiceLeave, AFK_CHANNEL_IDS } = require('../utils/economy/voiceTracker.js');
const { updateBalance } = require('../utils/economy/shopManager.js');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const userId = member.id;
    const oldChannel = oldState.channelId;
    const newChannel = newState.channelId;

    // Joined voice from nothing
    if (!oldChannel && newChannel) {
      onVoiceJoin(userId, newChannel);
      return;
    }

    // Left voice entirely
    if (oldChannel && !newChannel) {
      const result = onVoiceLeave(userId);
      if (result) {
        await updateBalance(userId, result.earned);
        try {
          await member.send(`🎤 You earned **${result.earned}** coins for spending **${result.minutesInVoice}** minutes in voice!`);
        } catch (_) {
          // DMs disabled — silently skip
        }
      }
      return;
    }

    // Switched channels
    if (oldChannel && newChannel && oldChannel !== newChannel) {
      if (AFK_CHANNEL_IDS.includes(newChannel)) {
        // Moving into AFK — treat as leave
        const result = onVoiceLeave(userId);
        if (result) {
          await updateBalance(userId, result.earned);
          try {
            await member.send(`🎤 You earned **${result.earned}** coins for spending **${result.minutesInVoice}** minutes in voice!`);
          } catch (_) {}
        }
      } else if (AFK_CHANNEL_IDS.includes(oldChannel)) {
        // Moving out of AFK — treat as join
        onVoiceJoin(userId, newChannel);
      }
      // Normal channel switch — do nothing, keep original join timestamp
    }
  },
};
