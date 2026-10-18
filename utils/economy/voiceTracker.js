const db = require('./database.js');

// userId -> join timestamp (ms)
// This map is the fast in-memory copy. Every change is mirrored into the
// `voice_sessions` table so a restart or redeploy doesn't wipe everyone's
// current voice time (it used to — each deploy reset all running sessions).
const voiceSessions = new Map();

const MIN_COINS_PER_HOUR = 50;
const MAX_COINS_PER_HOUR = 120;

// Add your AFK channel IDs here to exclude them from earning
const AFK_CHANNEL_IDS = [];

function persistJoin(userId, joinedAt) {
  db.run('INSERT OR REPLACE INTO voice_sessions (userId, joinedAt) VALUES (?, ?)', [userId, joinedAt], (err) => {
    if (err) console.error('[Voice] Could not save voice session:', err.message);
  });
}

function persistLeave(userId) {
  db.run('DELETE FROM voice_sessions WHERE userId = ?', [userId], (err) => {
    if (err) console.error('[Voice] Could not clear voice session:', err.message);
  });
}

function onVoiceJoin(userId, channelId) {
  if (AFK_CHANNEL_IDS.includes(channelId)) return;
  const now = Date.now();
  voiceSessions.set(userId, now);
  persistJoin(userId, now);
}

// Returns { earned, minutesInVoice } or null if nothing to award
function onVoiceLeave(userId) {
  const joinTime = voiceSessions.get(userId);
  if (!joinTime) return null;

  voiceSessions.delete(userId);
  persistLeave(userId);

  const minutesInVoice = (Date.now() - joinTime) / 60000;
  if (minutesInVoice < 1) return null;

  const coinsPerHour = Math.floor(Math.random() * (MAX_COINS_PER_HOUR - MIN_COINS_PER_HOUR + 1)) + MIN_COINS_PER_HOUR;
  const earned = Math.floor((minutesInVoice / 60) * coinsPerHour);

  if (earned <= 0) return null;
  return { earned, minutesInVoice: Math.floor(minutesInVoice) };
}

function loadSavedSessions() {
  return new Promise((resolve) => {
    db.all('SELECT userId, joinedAt FROM voice_sessions', [], (err, rows) => {
      if (err) {
        console.error('[Voice] Could not load saved voice sessions:', err.message);
        return resolve(new Map());
      }
      resolve(new Map(rows.map(r => [r.userId, r.joinedAt])));
    });
  });
}

// Call this on bot startup. For everyone currently in a voice channel it
// keeps their ORIGINAL join time if one was saved before the restart (so
// the time already spent isn't lost), otherwise starts counting from now.
// Saved sessions for people who are no longer in voice are discarded — we
// can't know when they left, so no coins are guessed for them.
async function seedVoiceUsers(client) {
  try {
    const saved = await loadSavedSessions();
    const now = Date.now();
    const stillInVoice = new Set();

    for (const guild of client.guilds.cache.values()) {
      for (const [, vs] of guild.voiceStates.cache) {
        if (!vs.member?.user?.bot && vs.channelId && !AFK_CHANNEL_IDS.includes(vs.channelId)) {
          const savedAt = saved.get(vs.id);
          const joinedAt = (savedAt && savedAt <= now) ? savedAt : now;
          voiceSessions.set(vs.id, joinedAt);
          persistJoin(vs.id, joinedAt);
          stillInVoice.add(vs.id);
        }
      }
    }

    for (const userId of saved.keys()) {
      if (!stillInVoice.has(userId)) persistLeave(userId);
    }

    const resumed = [...stillInVoice].filter(id => saved.has(id)).length;
    console.log(`🎤 Voice tracker seeded with ${voiceSessions.size} active voice users (${resumed} resumed from before the restart)`);
  } catch (err) {
    console.error('[Voice] Seeding failed:', err.message);
  }
}

module.exports = { onVoiceJoin, onVoiceLeave, seedVoiceUsers, AFK_CHANNEL_IDS };
