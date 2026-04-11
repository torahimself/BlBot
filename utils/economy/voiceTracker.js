// userId -> join timestamp (ms)
const voiceSessions = new Map();

const MIN_COINS_PER_HOUR = 50;
const MAX_COINS_PER_HOUR = 120;

// Add your AFK channel IDs here to exclude them from earning
const AFK_CHANNEL_IDS = [];

function onVoiceJoin(userId, channelId) {
  if (AFK_CHANNEL_IDS.includes(channelId)) return;
  voiceSessions.set(userId, Date.now());
}

// Returns { earned, minutesInVoice } or null if nothing to award
function onVoiceLeave(userId) {
  const joinTime = voiceSessions.get(userId);
  if (!joinTime) return null;

  voiceSessions.delete(userId);

  const minutesInVoice = (Date.now() - joinTime) / 60000;
  if (minutesInVoice < 1) return null;

  const coinsPerHour = Math.floor(Math.random() * (MAX_COINS_PER_HOUR - MIN_COINS_PER_HOUR + 1)) + MIN_COINS_PER_HOUR;
  const earned = Math.floor((minutesInVoice / 60) * coinsPerHour);

  if (earned <= 0) return null;
  return { earned, minutesInVoice: Math.floor(minutesInVoice) };
}

// Call this on bot startup to seed users already in voice
function seedVoiceUsers(client) {
  for (const guild of client.guilds.cache.values()) {
    for (const [, vs] of guild.voiceStates.cache) {
      if (!vs.member?.user?.bot && vs.channelId && !AFK_CHANNEL_IDS.includes(vs.channelId)) {
        voiceSessions.set(vs.id, Date.now());
      }
    }
  }
  console.log(`🎤 Voice tracker seeded with ${voiceSessions.size} active voice users`);
}

module.exports = { onVoiceJoin, onVoiceLeave, seedVoiceUsers, AFK_CHANNEL_IDS };
