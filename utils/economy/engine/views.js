'use strict';
// Everything a member SEES: the /profile card, the /inventory screen (with the
// "activate a potion" menu) and the /event screen. Pure presentation — the
// numbers all come from the engine modules.
//
//   /profile    coins · titles · milestone progress      (NO potions, NO timers)
//   /inventory  coins · potions · active boosts · weekly usage · activate menu
//   /event      the running event: your points, community progress, rewards

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const settings = require('./settings');
const dbx = require('./dbx');
const fmt = require('./format');
const time = require('./time');
const boosts = require('./boosts');
const activity = require('./activity');
const betting = require('./betting');
const events = require('./events');

const BLURPLE = 0x5865F2;
const MAX_TIER = 10;

// ── Titles ───────────────────────────────────────────────────────────────────

// Finds the display info for a stored title id (milestone or event).
function titleInfo(titleId) {
  const m = /^ms_(text|voice)_(\d+)$/.exec(titleId || '');
  if (m) {
    const tier = settings.milestones[m[1]].tiers[Number(m[2]) - 1];
    return tier ? { kind: 'milestone', track: m[1], n: Number(m[2]), name: tier.name, emoji: tier.emoji } : null;
  }
  const t = settings.eventTitles[titleId];
  if (t) {
    return {
      kind: 'event', name: t.name, emoji: t.emoji,
      event: { name: t.eventName }, tier: { label: t.tierLabel, emoji: t.tierEmoji },
    };
  }
  return null;
}

async function profileData(userId) {
  const bal = await dbx.get('SELECT balance FROM users WHERE userId = ?', [userId]);
  const tot = await dbx.get('SELECT chars, voiceMinutes FROM act_totals WHERE userId = ?', [userId]);
  const titles = await dbx.all('SELECT titleId, category, earnedAt FROM titles WHERE userId = ?', [userId]);
  return {
    balance: bal ? bal.balance : 0,
    chars: tot ? tot.chars : 0,
    voiceMinutes: tot ? tot.voiceMinutes : 0,
    titles,
  };
}

// Tiers (sorted 1..n) the member has unlocked on a track.
function earnedTiers(data, track) {
  const out = [];
  for (const t of data.titles) {
    const info = titleInfo(t.titleId);
    if (info && info.kind === 'milestone' && info.track === track) out.push(info.n);
  }
  return out.sort((a, b) => a - b);
}

function trackField(track, data) {
  const def = settings.milestones[track];
  const total = track === 'voice' ? data.voiceMinutes : data.chars;
  const earned = earnedTiers(data, track);
  const tierCount = earned.length ? earned[earned.length - 1] : 0;

  const lines = earned.map((n) => {
    const t = def.tiers[n - 1];
    return `${fmt.tierStyle(n).badge} **${fmt.roman(n)}** ${t.emoji} ${t.name}`;
  });

  const next = def.tiers[tierCount];
  if (next) {
    const prev = tierCount ? def.tiers[tierCount - 1].threshold : 0;
    const frac = (total - prev) / (next.threshold - prev);
    lines.push(`${lines.length ? '\n' : ''}**Next:** ${next.emoji} ${next.name}\n${fmt.bar(frac)} ${fmt.trackValueText(track, total)} / ${fmt.trackValueText(track, next.threshold)}`);
  } else {
    lines.push('\n✅ **Track complete!**');
  }
  return { name: `${def.icon} ${def.label} milestones — ${tierCount}/${def.tiers.length}`, value: lines.join('\n').slice(0, 1024), inline: false };
}

function profileEmbed({ name, avatarUrl, data }) {
  const voiceTiers = earnedTiers(data, 'voice');
  const textTiers = earnedTiers(data, 'text');
  const topVoice = voiceTiers.length ? voiceTiers[voiceTiers.length - 1] : 0;
  const topText = textTiers.length ? textTiers[textTiers.length - 1] : 0;

  const featured = [];
  if (topVoice) { const t = settings.milestones.voice.tiers[topVoice - 1]; featured.push(`${t.emoji} **${t.name}**`); }
  if (topText) { const t = settings.milestones.text.tiers[topText - 1]; featured.push(`${t.emoji} **${t.name}**`); }

  const eventTitles = data.titles
    .map((t) => ({ t, info: titleInfo(t.titleId) }))
    .filter((x) => x.info && x.info.kind === 'event')
    .sort((a, b) => a.t.earnedAt - b.t.earnedAt || a.t.titleId.localeCompare(b.t.titleId));
  for (const x of eventTitles) featured.push(`${x.info.emoji} **${x.info.name}**`);

  const embed = new EmbedBuilder()
    .setColor(fmt.tierStyle(Math.min(MAX_TIER, Math.max(topVoice, topText, 1))).color || BLURPLE)
    .setAuthor({ name: `${name}'s profile`, iconURL: avatarUrl || undefined })
    .setDescription(
      `💰 **Coins:** ${fmt.num(data.balance)}\n\n` +
      `**Titles**\n${featured.length ? featured.join('  ·  ') : '*No titles yet — chat and hang out in voice to earn your first one!*'}`
    )
    .addFields(trackField('voice', data), trackField('text', data));

  if (eventTitles.length) {
    embed.addFields({
      name: '🎟️ Event titles',
      value: eventTitles.map((x) => `${x.info.emoji} **${x.info.name}** — ${x.info.event.name} · ${x.info.tier.emoji} ${x.info.tier.label}`).join('\n').slice(0, 1024),
      inline: false,
    });
  }
  embed.setFooter({ text: `Counted so far: ${fmt.num(data.chars)} characters · ${fmt.minutesText(data.voiceMinutes)} in voice` });
  if (avatarUrl) embed.setThumbnail(avatarUrl);
  return embed;
}

async function buildProfile(userId, name, avatarUrl) {
  return profileEmbed({ name, avatarUrl, data: await profileData(userId) });
}

// ── Inventory ────────────────────────────────────────────────────────────────

const INV_PREFIX = 'inv_use_';

function groupPotions(rows, type) {
  const counts = new Map();
  for (const r of rows) if (r.type === type) counts.set(r.hours, (counts.get(r.hours) || 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]);
}

/** Everything the inventory screen shows (also drawn as a picture by utils/ui/inventoryCard.js). */
async function inventoryState(userId, now = Date.now()) {
  const [bal, potions, active, usage, net] = await Promise.all([
    dbx.get('SELECT balance FROM users WHERE userId = ?', [userId]),
    boosts.inventory(userId),
    boosts.activeBoosts(userId, now),
    activity.weeklyUsage(userId, now),
    betting.weeklyNet(userId, now),
  ]);
  return { balance: bal ? bal.balance : 0, potions, active, usage, net, now };
}

/**
 * The inventory message. `user` ({name, avatarUrl}) makes it a picture in the member's own style;
 * without it (or without the canvas module) it is the classic embed.
 */
async function inventoryPayload(userId, { now = Date.now(), notice = '', user = null } = {}) {
  const st = await inventoryState(userId, now);
  const { potions, active, usage, net } = st;
  const bal = { balance: st.balance };

  const mult = settings.potions.multiplier;
  const activeTypes = new Set(active.map((b) => b.type));

  const potionText = (type) => {
    const g = groupPotions(potions, type);
    return g.length ? g.map(([h, n]) => `**${n}** × ${h}h`).join('  ·  ') : '*None*';
  };

  const activeText = active.length
    ? active.map((b) => {
        const t = boosts.TYPES[b.type];
        return `${t.emoji} **${t.label}** ×${b.multiplier} — ends ${fmt.tsRel(b.expiresAt)} (${fmt.tsFull(b.expiresAt)})`;
      }).join('\n')
    : '*No boost is running.*';

  const betCap = settings.betting.weeklyNetProfitCap;
  const weekly = [
    `⌨️ Typing: **${fmt.num(usage.text.weekCoins)}** / ${fmt.num(usage.text.weeklyCap)} coins`,
    `🎧 Voice: **${fmt.num(usage.voice.weekCoins)}** / ${fmt.num(usage.voice.weeklyCap)} coins`,
    `🎲 Betting profit: **${fmt.num(Math.max(0, net))}** / ${fmt.num(betCap)} coins`,
    `🔄 Resets ${fmt.tsRel(usage.resetAt)}`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle('🎒 Inventory')
    .setDescription(`💰 **Coins:** ${fmt.num(bal ? bal.balance : 0)}`)
    .addFields(
      { name: `⌨️ ${boosts.TYPES.text.label} potions (×${mult} typing coins)`, value: potionText('text'), inline: true },
      { name: `🎧 ${boosts.TYPES.voice.label} potions (×${mult} voice coins)`, value: potionText('voice'), inline: true },
      { name: '⚡ Active boosts', value: activeText, inline: false },
      { name: '📅 This week', value: weekly, inline: false },
    )
    .setFooter({ text: 'Potions come from random drops and events — they cannot be bought. A potion is used up when you activate it.' });

  // Menu: one entry per (type, duration) the member owns and can start now.
  const options = [];
  for (const type of ['text', 'voice']) {
    if (activeTypes.has(type)) continue;                       // same type can't stack
    for (const [hours, n] of groupPotions(potions, type)) {
      const t = boosts.TYPES[type];
      options.push({
        label: `${t.label} — ${hours}h (×${mult})`.slice(0, 100),
        description: `You own ${n}. Activating uses one up.`.slice(0, 100),
        value: `${type}:${hours}`,
        emoji: t.emoji,
      });
    }
  }

  const components = [];
  if (options.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${INV_PREFIX}${userId}`)
        .setPlaceholder('Activate a potion…')
        .addOptions(options.slice(0, 25))
    ));
  }
  const waiting = potions.filter((p) => activeTypes.has(p.type)).length;
  const hint = waiting ? `\n-# ${waiting} potion(s) are waiting: a boost of the same type is still running.` : '';
  const content = `${notice}${hint}`.trim() || null;
  if (user) {
    try {
      const ui = require('../../ui');                              // lazy: ui → views → ui would otherwise be circular
      const img = await ui.inventoryImage({ userId, user, state: st });
      if (img) return { content, embeds: [], files: [img], attachments: [], components, allowedMentions: { parse: [] } };
    } catch (err) { console.error('[UI] inventory picture failed, using the embed:', err); }
  }
  return { content, embeds: [embed], files: [], attachments: [], components };
}

/** Handles the "activate a potion" menu. Returns true if the interaction was ours. */
async function handleInventorySelect(interaction) {
  if (!interaction.customId || !interaction.customId.startsWith(INV_PREFIX)) return false;
  const ownerId = interaction.customId.slice(INV_PREFIX.length);
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: '❌ This is not your inventory.', flags: 64 });
    return true;
  }

  const [type, hoursRaw] = String(interaction.values[0] || '').split(':');
  const hours = Number(hoursRaw);
  let notice;
  if (!boosts.TYPES[type] || !Number.isInteger(hours)) {
    notice = '❌ Unknown potion.';
  } else {
    const row = await dbx.get('SELECT id FROM potions WHERE userId = ? AND type = ? AND hours = ? ORDER BY id LIMIT 1', [ownerId, type, hours]);
    const res = row ? await boosts.activate(ownerId, row.id) : { ok: false, reason: 'missing' };
    const t = boosts.TYPES[type] || { label: 'potion', emoji: '🧪' };
    if (res.ok) {
      notice = `✅ **${t.emoji} ${t.label}** activated! ×${res.multiplier} for **${res.hours}h** — ends ${fmt.tsRel(res.expiresAt)} (${fmt.tsFull(res.expiresAt)}).`;
    } else if (res.reason === 'same-type-active') {
      notice = `⏳ You already have a ${t.label} running (ends ${fmt.tsRel(res.expiresAt)}). Wait for it to finish first.`;
    } else if (res.reason === 'other-active') {
      notice = `⏳ Another boost is still running (ends ${fmt.tsRel(res.expiresAt)}).`;
    } else {
      notice = '❌ You no longer have that potion.';
    }
  }
  let user = null;
  try { user = require('../../ui/customize').whoIs(interaction); } catch (_) { user = null; }
  await interaction.update(await inventoryPayload(ownerId, { notice, user }));
  return true;
}

// ── Events ───────────────────────────────────────────────────────────────────

function tierRewardText(t) {
  const parts = [`${fmt.num(t.coins)} coins`];
  if (t.textPotions) parts.push(`${t.textPotions} Typing Boost`);
  if (t.voicePotions) parts.push(`${t.voicePotions} Voice Boost`);
  parts.push(`title ${t.title.emoji} **${t.title.name}**`);
  return parts.join(' + ');
}

function communityLines(s) {
  const total = Math.floor(s.community.total);
  return [...s.community.tiers].reverse().map((t) => {
    const frac = total / t.target;
    return `${t.emoji} **${t.label}** ${fmt.bar(frac)} ${fmt.num(Math.min(total, t.target))} / ${fmt.num(t.target)} (${Math.min(100, (total / t.target) * 100).toFixed(2)}%) ${t.reached ? '✅' : ''}`;
  }).join('\n');
}

function communityEmbed(s) {
  const ev = s.ev;
  const ended = s.phase === 'ended';
  return new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle(`${ev.emoji} ${ev.name} — community progress`)
    .setDescription(
      `${ended ? 'Ended' : 'Ends'} ${fmt.tsRel(s.endAt)} (${fmt.tsFull(s.endAt)})\n\n` +
      `${communityLines(s)}\n\n` +
      `👥 **${fmt.num(s.community.participants)}** members taking part · **${fmt.num(s.community.qualified)}** already qualified (${ev.points.qualifyAt}+ Candy)`
    )
    .setFooter({ text: 'Updated' })
    .setTimestamp(s.now);
}

function eventEmbed(s) {
  const ev = s.ev;
  const p = ev.points;
  const embed = new EmbedBuilder().setColor(0xE67E22).setTitle(`${ev.emoji} ${ev.name}`);

  if (s.phase === 'upcoming') {
    embed.setDescription(`Starts ${fmt.tsRel(s.startAt)} (${fmt.tsFull(s.startAt)}) and runs for **${ev.durationDays} days**.\nEvery eligible minute in voice and every eligible message earns 🍬 Candy — get **${p.qualifyAt}** of the possible **${p.voiceMax + p.textMax + (p.gamesMax || 0)}** to qualify for rewards.`);
  } else {
    embed.setDescription(
      `${s.phase === 'ended' ? '🏁 **The event has ended.**' : `Ends ${fmt.tsRel(s.endAt)}`}\n` +
      `${fmt.tsFull(s.startAt)} → ${fmt.tsFull(s.endAt)}  (**${ev.durationDays} days**)`
    );
    const me = s.me;
    const needed = Math.max(0, p.qualifyAt - me.total);
    embed.addFields(
      {
        name: '🧑 Your Candy 🍬',
        value:
          `🎧 Voice: **${me.voice}** / ${p.voiceMax}  (${fmt.minutesText(me.voiceMinutes)})${me.voice >= p.voiceMax ? ' ✅ max' : `\n   ↳ next 🍬 in **${p.voiceMinutesPerPoint - (me.voiceMinutes % p.voiceMinutesPerPoint)} min** ${fmt.bar((me.voiceMinutes % p.voiceMinutesPerPoint) / p.voiceMinutesPerPoint)}`}\n` +
          `⌨️ Typing: **${me.text}** / ${p.textMax}  (${fmt.num(me.textChars)} counted letters)${me.text >= p.textMax ? ' ✅ max' : `\n   ↳ next 🍬 needs **${fmt.num(p.textCharsPerPoint - (me.textChars % p.textCharsPerPoint))}** more letters ${fmt.bar((me.textChars % p.textCharsPerPoint) / p.textCharsPerPoint)} (${fmt.num(me.textChars % p.textCharsPerPoint)} / ${p.textCharsPerPoint})`}\n` +
          `🎮 Games: **${me.games}** / ${p.gamesMax || 0}  (${me.gamesPlayed} finished — ${p.pointsPerGame} Candy each, max ${p.gamesPerDayMax || '∞'} games a day)\n` +
          `**Total: ${me.total} / ${p.voiceMax + p.textMax + (p.gamesMax || 0)}**\n` +
          (me.qualified
            ? `✅ You qualify for the rewards (${p.qualifyAt}+ Candy).`
            : `❌ Not qualified yet — **${needed}** more Candy to go (${p.qualifyAt} needed).`) +
          `\n-# Only letters and digits count (spaces, emoji, links, mentions, commands, spam and repeated messages don't), so what you type is a bit more than what counts. ${p.textCharsPerPoint} counted letters = 1 🍬; a Candy is added only when complete.`,
        inline: false,
      },
      { name: '🌍 Community goal', value: `${communityLines(s)}\n👥 ${fmt.num(s.community.participants)} members · ${fmt.num(s.community.qualified)} qualified`, inline: false },
    );
    if (s.phase === 'ended' && s.rewarded) embed.addFields({ name: '🎁 Your rewards', value: 'Paid! Check **/inventory** and **/profile**.', inline: false });
  }

  embed.addFields({
    name: '🏆 Rewards (cumulative)',
    value: [...ev.tiers].reverse().map((t) => `${t.emoji} **${t.label}** — ${tierRewardText(t)}`).join('\n') +
      `\n-# Reaching a tier gives its reward AND every lower tier's reward, to every member with ${p.qualifyAt}+ Candy. Rewards are paid after the event ends.`,
    inline: false,
  });
  return embed;
}

module.exports = {
  profileData, profileEmbed, buildProfile,
  inventoryPayload, handleInventorySelect, inventoryState, groupPotions, earnedTiers,
  eventEmbed, communityEmbed, titleInfo, INV_PREFIX,
};
