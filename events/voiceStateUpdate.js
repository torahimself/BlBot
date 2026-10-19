const { onVoiceJoin, onVoiceLeave, AFK_CHANNEL_IDS } = require('../utils/economy/voiceTracker.js');
const { updateBalance } = require('../utils/economy/shopManager.js');

// Voice coins are still earned exactly as before — the "you earned X coins for
// Y minutes" DM was removed on request (it fired on every short join/leave).
// Coins are credited silently; use /balance to check.

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
        try {
          await updateBalance(userId, result.earned);
        } catch (err) {
          console.error(`[Voice] Could not credit ${result.earned} coins to ${userId}:`, err);
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
          try {
            await updateBalance(userId, result.earned);
          } catch (err) {
            console.error(`[Voice] Could not credit ${result.earned} coins to ${userId}:`, err);
          }
        }
      } else if (AFK_CHANNEL_IDS.includes(oldChannel)) {
        // Moving out of AFK — treat as join
        onVoiceJoin(userId, newChannel);
      }
      // Normal channel switch — do nothing, keep original join timestamp
    }
  },
};
