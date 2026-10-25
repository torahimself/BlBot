'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// BL economy engine — ALL tunable numbers live here.
//
// Nothing else in the engine hard-codes a rate, cap, threshold, drop chance,
// potion duration or event rule, so balancing never means touching logic.
// The simulator (dev/simulate.js) reads this same object.
// ─────────────────────────────────────────────────────────────────────────────

const config = require('../../../config.js');

// Channels that never earn text coins / event points. Defaults to the channels
// you already exclude from the attachment counter and statp scans (reports,
// logs, command channels). Add more IDs here if needed.
const excludedChannelIds = [...new Set([
  ...((config.attachmentCounter && config.attachmentCounter.excludedChannels) || []),
  ...((config.statp && config.statp.excludedChannels) || []),
])];

const settings = {
  // Weeks start on Sunday 00:00 in this timezone; "days" for the 30-day
  // rolling window are days in this timezone too. (Riyadh has no DST.)
  timezone: 'Asia/Riyadh',

  // Random source. The simulator swaps this for a seeded generator.
  rng: Math.random,

  // ── Typing ────────────────────────────────────────────────────────────────
  text: {
    // Coins per ELIGIBLE character (letters and digits that survive the spam
    // filter). The old system paid ~0.43 per character.
    coinsPerChar: 0.20,
    // Max coins typing can pay per week (Sunday→Saturday) and per rolling 30
    // days. Boosted coins count toward both.
    weeklyCoinCap: 20000,
    rolling30CoinCap: 80000,
    // Max eligible characters credited per week. Characters beyond this earn
    // nothing and do not count toward milestones or events.
    weeklyCharCeiling: 100000,
    // Per-message / per-minute limits on credited characters (anti-spam).
    maxCharsPerMessage: 300,
    maxCharsPerMinute: 400,
    // The same message from the same person within this window earns nothing.
    duplicateWindowMs: 60 * 1000,
    excludedChannelIds,
  },

  // ── Voice ─────────────────────────────────────────────────────────────────
  voice: {
    // Each eligible minute pays a random rate in this range (coins per hour).
    coinsPerHourMin: 200,
    coinsPerHourMax: 350,
    weeklyCoinCap: 12000,
    rolling30CoinCap: 48000,
    // Max eligible minutes credited per week (42 h).
    weeklyMinuteCeiling: 42 * 60,
    // A channel counts only when it holds at least this many non-deafened
    // human members. Muted is fine; deafened (self or server) is not.
    minEligibleMembers: 2,
    tickMs: 60 * 1000,
  },

  // ── Boost potions ─────────────────────────────────────────────────────────
  potions: {
    multiplier: 2,
    // [hours, weight] — a potion's duration is rolled when it is created.
    durations: [[3, 40], [4, 30], [5, 20], [6, 10]],
    // A Typing Boost and a Voice Boost don't conflict (they multiply different
    // income), so both may run at the same time. Two potions of the SAME type
    // can never run together. Set to false to allow only one boost at a time.
    allowConcurrentTypes: true,
    // false = a potion drop is a random Typing or Voice Boost (50/50), whatever
    // activity triggered it. true = it matches the triggering activity.
    dropMatchesActivity: false,
  },

  // ── Direct messages ───────────────────────────────────────────────────────
  notifications: {
    // DM a member when they unlock a milestone (rare: at most 20 ever).
    milestoneDm: true,
  },

  // Who gets the "event ended" message. Falls back to the bot application's
  // owner when empty. (You can also set DEV_USER_ID in .env.)
  devUserId: process.env.DEV_USER_ID || null,

  // Where the "event ended — delete the event files" notice is posted (the role
  // is pinged). If the channel can't be reached the developer gets a DM instead.
  devNotify: {
    channelId: '1449813798146932874',
    roleId: '1563466848069095425',
  },

  // ── Random drops ──────────────────────────────────────────────────────────
  drops: {
    // One roll per eligible voice minute and one per `charsPerRoll` credited
    // typed characters.
    chancePerRoll: 0.0019,
    charsPerRoll: 70,
    // Hard limit so drops can never become a side income.
    maxPerWeek: 2,
    // At most one drop DM per user in this window (the reward is always saved).
    dmCooldownMs: 30 * 60 * 1000,
    // Weights must add up to exactly 100 (checked on startup). Your original
    // 50/45/5/1 added up to 101; 1,000 coins was reduced by one point.
    table: [
      { kind: 'potion', weight: 50 },
      { kind: 'coins', amount: 1000, weight: 44 },
      { kind: 'coins', amount: 3000, weight: 5 },
      { kind: 'coins', amount: 5000, weight: 1 },
    ],
  },

  // ── Betting ───────────────────────────────────────────────────────────────
  betting: {
    // Max NET profit a member can make from bets per week. Net = winnings
    // minus losses, so losing first gives room to win it back.
    weeklyNetProfitCap: 10000,
  },

  // ── Milestones (10 tiers per track) ───────────────────────────────────────
  // threshold: text = eligible characters, voice = eligible MINUTES.
  milestones: {
    text: {
      label: 'Typing',
      icon: '⌨️',
      unit: 'characters',
      tiers: [
        { threshold: 10000,   coins: 800,   name: 'Ink Rookie',       emoji: '✒️' },
        { threshold: 30000,   coins: 1500,  name: 'Keyboard Knight',  emoji: '⌨️' },
        { threshold: 75000,   coins: 2500,  name: 'Wordsmith',        emoji: '📝' },
        { threshold: 150000,  coins: 9500,  name: 'Story Spinner',    emoji: '📖' },
        { threshold: 300000,  coins: 15000,  name: 'Prose Paladin',    emoji: '🗡️' },
        { threshold: 500000,  coins: 11000, name: 'Quill Master',     emoji: '🪶' },
        { threshold: 800000,  coins: 18000, name: 'Lorekeeper',       emoji: '📜' },
        { threshold: 1200000, coins: 28000, name: 'Epic Scribe',      emoji: '🖋️' },
        { threshold: 1800000, coins: 42000, name: 'Grand Chronicler', emoji: '🏛️' },
        { threshold: 2500000, coins: 65000, name: 'Eternal Inkwell',  emoji: '🌌' },
      ],
    },
    voice: {
      label: 'Voice',
      icon: '🎧',
      unit: 'hours',
      tiers: [
        { threshold: 5 * 60,    coins: 1000,   name: 'Echo Rookie',         emoji: '🎧' },
        { threshold: 15 * 60,   coins: 2000,   name: 'Lounge Regular',      emoji: '🛋️' },
        { threshold: 30 * 60,   coins: 3500,   name: 'Mic Warmer',          emoji: '🎙️' },
        { threshold: 60 * 60,   coins: 5500,   name: 'Frequency Rider',     emoji: '📻' },
        { threshold: 120 * 60,  coins: 9000,   name: 'Channel Guardian',    emoji: '🛡️' },
        { threshold: 200 * 60,  coins: 14000,  name: 'Soundwave Veteran',   emoji: '🔊' },
        { threshold: 350 * 60,  coins: 24000,  name: 'Voice Vanguard',      emoji: '⚔️' },
        { threshold: 550 * 60,  coins: 40000,  name: 'Legend of the Lobby', emoji: '🏆' },
        { threshold: 800 * 60,  coins: 65000,  name: 'Harmonic Titan',      emoji: '🌋' },
        { threshold: 1200 * 60, coins: 100000, name: 'Voice of the Server', emoji: '👑' },
      ],
    },
  },

  // Badge shown next to a milestone tier. Easy 1–4, intermediate 5–6, hard 7–10.
  tierBadges: [
    { upTo: 4,  badge: '🟢', rarity: 'Easy',         color: 0x57F287 },
    { upTo: 6,  badge: '🔷', rarity: 'Intermediate', color: 0x3498DB },
    { upTo: 8,  badge: '🔶', rarity: 'Hard',         color: 0xE67E22 },
    { upTo: 9,  badge: '💎', rarity: 'Legendary',    color: 0x9B59B6 },
    { upTo: 10, badge: '👑', rarity: 'Mythic',       color: 0xF1C40F },
  ],

  // ── Permanent event-title registry ────────────────────────────────────────
  // Titles members EARNED stay valid forever. They are described here, outside
  // the event definition, so deleting an event (its block below, commands/
  // economy/event.js) never removes or breaks a title someone already owns.
  eventTitles: {
    event_halloween2026_bronze: { name: 'Pumpkin Warden',    emoji: '🎃', eventName: 'Halloween Haunting', tierLabel: 'Bronze', tierEmoji: '🥉', rank: 1 },
    event_halloween2026_silver: { name: 'Crypt Keeper',      emoji: '🕸️', eventName: 'Halloween Haunting', tierLabel: 'Silver', tierEmoji: '🥈', rank: 2 },
    event_halloween2026_gold:   { name: 'Phantom Sovereign', emoji: '👻', eventName: 'Halloween Haunting', tierLabel: 'Gold',   tierEmoji: '🥇', rank: 3 },
  },

  // ── Night roles ───────────────────────────────────────────────────────────
  // The top `top` members of each category (last completed Sunday-week) hold the
  // role. Night = startHour ≤ hour < endHour in `timezone` (wraps past midnight
  // when startHour > endHour). `minUnits`: voice = minutes, text = characters.
  nightRoles: {
    enabled: true,
    startHour: 0,
    endHour: 6,
    top: 5,
    syncIntervalMs: 10 * 60 * 1000,
    voice: { roleId: '1357421824589168671', minUnits: 60 },
    text:  { roleId: '1357421898312581395', minUnits: 3000 },
  },

  // ── Seasonal events ───────────────────────────────────────────────────────
  // One active event at a time. Add another object (or change `current`) for
  // Christmas later. Dates are absolute (note the +03:00 = Riyadh).
  events: {
    current: 'halloween-2026',
    list: {
      'halloween-2026': {
        id: 'halloween-2026',
        name: 'Halloween Haunting',
        emoji: '🎃',
        // Starts Mon 26 Oct 2026 00:00 Riyadh and runs 7 days (ends Mon 2 Nov
        // 00:00), so Halloween night is inside it. Change this line to move it.
        startAt: '2026-10-26T00:00:00+03:00',
        durationDays: 7,
        // Optional: channel where a live progress message is kept updated.
        progressChannelId: null,
        // Optional: channel where the final results are announced.
        announceChannelId: null,
        // Candy 🍬 (the event's points): 30 from voice + 30 from typing + 40 from
        // party games = 100 max per member.
        points: {
          voiceMax: 30,
          textMax: 30,
          gamesMax: 40,
          voiceMinutesPerPoint: 12,   // 30 Candy = 6 h of eligible voice
          textCharsPerPoint: 360,     // 30 Candy = 10,800 eligible characters
          pointsPerGame: 4,           // each finished party game = 4 Candy (10 games = 40)
          gamesPerDayMax: 3,          // at most 3 games a day count (stops farming)
          qualifyAt: 50,
        },
        // Community targets are TOTAL points across all members. They assume
        // ~250 members take part in a normal week (your server: 150–700): rerun
        // `node dev/simulate.js --members N` with your real number and copy the
        // suggested targets. Rewards are
        // cumulative: reaching Gold gives the Bronze + Silver + Gold rewards.
        tiers: [
          { key: 'bronze', label: 'Bronze', emoji: '🥉', target: 8500,
            coins: 9500,  textPotions: 1, voicePotions: 1,
            title: { id: 'event_halloween2026_bronze', name: 'Pumpkin Warden',    emoji: '🎃' } },
          { key: 'silver', label: 'Silver', emoji: '🥈', target: 12500,
            coins: 15000,  textPotions: 1, voicePotions: 1,
            title: { id: 'event_halloween2026_silver', name: 'Crypt Keeper',      emoji: '🕸️' } },
          { key: 'gold',   label: 'Gold',   emoji: '🥇', target: 16000,
            coins: 30000, textPotions: 2, voicePotions: 2,
            title: { id: 'event_halloween2026_gold',   name: 'Phantom Sovereign', emoji: '👻' } },
        ],
      },
    },
  },
};

// Throws a clear error if the numbers are inconsistent, so a typo can't
// silently produce an invalid economy (like the 101% drop table).
function validate(s = settings) {
  const problems = [];
  const sum = s.drops.table.reduce((a, r) => a + r.weight, 0);
  if (sum !== 100) problems.push(`drops.table weights add up to ${sum}, must be exactly 100`);
  if (s.voice.coinsPerHourMax > 350) problems.push('voice.coinsPerHourMax is above the 350 coins/hour ceiling');
  if (s.voice.coinsPerHourMin > s.voice.coinsPerHourMax) problems.push('voice rate min is above max');
  if (!(s.text.coinsPerChar > 0)) problems.push('text.coinsPerChar must be positive');
  for (const track of ['text', 'voice']) {
    const t = s.milestones[track].tiers;
    if (t.length !== 10) problems.push(`${track} milestones must have exactly 10 tiers`);
    for (let i = 1; i < t.length; i++) {
      if (t[i].threshold <= t[i - 1].threshold) problems.push(`${track} milestone thresholds must increase (tier ${i + 1})`);
    }
  }
  const nr = s.nightRoles;
  if (nr) {
    const okH = (h) => Number.isInteger(h) && h >= 0 && h <= 24;
    if (!okH(nr.startHour) || !okH(nr.endHour) || nr.startHour === nr.endHour) problems.push('nightRoles window hours are invalid');
    if (!(nr.top >= 1)) problems.push('nightRoles.top must be at least 1');
    for (const k of ['voice', 'text']) if (!nr[k] || !nr[k].roleId) problems.push(`nightRoles.${k}.roleId is missing`);
  }
  const dsum = s.potions.durations.reduce((a, d) => a + d[1], 0);
  if (!(dsum > 0)) problems.push('potion duration weights must be positive');
  const ev = s.events.list[s.events.current];
  if (ev) {
    const tg = ev.tiers.map(t => t.target);
    if (!(tg[0] < tg[1] && tg[1] < tg[2])) problems.push('event tier targets must increase');
    if (!Number.isFinite(Date.parse(ev.startAt))) problems.push('event startAt is not a valid date');
    for (const t of ev.tiers) if (!s.eventTitles[t.title.id]) problems.push(`title ${t.title.id} is missing from eventTitles`);
  }
  if (problems.length) throw new Error('Invalid economy settings:\n - ' + problems.join('\n - '));
  return true;
}

settings.validate = validate;
module.exports = settings;
