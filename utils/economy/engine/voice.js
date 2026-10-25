'use strict';
// Voice activity. Instead of tracking join/leave events (which break on restarts
// and let people stack sessions), the bot looks at the voice channels once a
// minute and credits every member who is eligible RIGHT NOW.
//
// Eligible = in a voice channel that holds at least `minEligibleMembers`
// non-deafened humans, and not deafened themselves. Muting is irrelevant.
//
//   one person alone                      → nobody earns
//   two people, both muted                → both earn
//   two people, one deafened              → nobody earns (only one eligible)
//   three people, one deafened            → the other two earn
//
// The check is rebuilt from live Discord state every minute, so a restart loses
// at most one minute and nothing needs to be saved.

const settings = require('./settings');
const activity = require('./activity');

/**
 * Pure function (also used by the tests).
 * @param {Array<{userId:string, channelId:string|null, deaf?:boolean, selfDeaf?:boolean, bot?:boolean}>} states
 * @returns {Map<string, string[]>} channelId → eligible member ids (only channels that qualify)
 */
function eligibleByChannel(states, minMembers = settings.voice.minEligibleMembers) {
  const groups = new Map();
  for (const s of states) {
    if (!s.channelId || s.bot || s.deaf || s.selfDeaf) continue;
    if (!groups.has(s.channelId)) groups.set(s.channelId, []);
    const list = groups.get(s.channelId);
    if (!list.includes(s.userId)) list.push(s.userId);
  }
  for (const [ch, ids] of groups) if (ids.length < minMembers) groups.delete(ch);
  return groups;
}

class VoiceTicker {
  constructor(client) {
    this.client = client;
    this.timer = null;
    this.last = null;
    this.running = false;
    this.isBotCache = new Map();   // userId -> boolean
  }

  start() {
    if (this.timer) return;
    this.last = Date.now();
    this.timer = setInterval(() => {
      this.tick().catch(err => console.error('[Voice] tick failed:', err));
    }, settings.voice.tickMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async isBot(guild, vs) {
    if (vs.member && vs.member.user) return !!vs.member.user.bot;
    if (this.isBotCache.has(vs.id)) return this.isBotCache.get(vs.id);
    const m = await guild.members.fetch(vs.id).catch(() => null);
    const bot = m && m.user ? !!m.user.bot : false;
    if (this.isBotCache.size > 5000) this.isBotCache.clear();
    this.isBotCache.set(vs.id, bot);
    return bot;
  }

  async collect() {
    const states = [];
    for (const guild of this.client.guilds.cache.values()) {
      for (const vs of guild.voiceStates.cache.values()) {
        if (!vs.channelId) continue;
        if (guild.afkChannelId && vs.channelId === guild.afkChannelId) continue;
        states.push({
          userId: vs.id,
          channelId: vs.channelId,
          deaf: !!vs.deaf,
          selfDeaf: !!vs.selfDeaf,
          bot: await this.isBot(guild, vs),
        });
      }
    }
    return states;
  }

  /** One sampling pass. Returns the number of members credited. */
  async tick(now = Date.now()) {
    if (this.running) return 0;
    this.running = true;
    try {
      const elapsed = now - this.last;
      if (elapsed < 30 * 1000) return 0;                          // spurious early tick
      // A long stall (host asleep, restart) is credited as a single minute.
      const minutes = elapsed > 5 * 60 * 1000 ? 1 : Math.max(1, Math.round(elapsed / 60000));
      this.last = now;

      const groups = eligibleByChannel(await this.collect());
      let credited = 0;
      for (const ids of groups.values()) {
        for (const id of ids) {
          try {
            await activity.credit(id, 'voice', minutes, { now, client: this.client });
            credited++;
          } catch (err) {
            console.error(`[Voice] credit failed for ${id}:`, err.message);
          }
        }
      }
      return credited;
    } finally {
      this.running = false;
    }
  }
}

module.exports = { VoiceTicker, eligibleByChannel };
