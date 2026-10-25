const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const settings = require('../../utils/economy/engine/settings.js');
const dbx = require('../../utils/economy/engine/dbx.js');
const time = require('../../utils/economy/engine/time.js');
const fmt = require('../../utils/economy/engine/format.js');
const activity = require('../../utils/economy/engine/activity.js');
const boosts = require('../../utils/economy/engine/boosts.js');
const betting = require('../../utils/economy/engine/betting.js');
const events = require('../../utils/economy/engine/events.js');

// Developer tools for the coin economy (Administrator only, replies are private).
//   /econdebug user      — one member's counters, caps, potions, drops, event points
//   /econdebug week      — how this week's earnings are distributed (use it to tune caps)
//   /econdebug potion    — give a test potion
//   /econdebug event     — raw event totals
// The full what-if simulator is the script  dev/simulate.js  (run it on your PC).

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('econdebug')
    .setDescription('Economy debugging tools (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('user').setDescription('Inspect one member\'s economy state')
      .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
    .addSubcommand(s => s.setName('week').setDescription('Distribution of this week\'s earnings (for tuning the caps)'))
    .addSubcommand(s => s.setName('potion').setDescription('Give a test boost potion')
      .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Potion type').setRequired(true)
        .addChoices({ name: 'Typing Boost', value: 'text' }, { name: 'Voice Boost', value: 'voice' }))
      .addIntegerOption(o => o.setName('hours').setDescription('Duration in hours (3-6)').setRequired(true).setMinValue(3).setMaxValue(6)))
    .addSubcommand(s => s.setName('event').setDescription('Raw totals of the current event')),

  async execute(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.editReply('❌ You do not have permission to use this command!');
    }
    const sub = interaction.options.getSubcommand();
    const now = Date.now();

    if (sub === 'potion') {
      const user = interaction.options.getUser('member');
      const type = interaction.options.getString('type');
      const hours = interaction.options.getInteger('hours');
      await boosts.grantPotion(user.id, type, hours, 'admin');
      return interaction.editReply(`✅ Gave ${user.tag} a **${boosts.TYPES[type].label}** (${hours}h).`);
    }

    if (sub === 'user') {
      const user = interaction.options.getUser('member');
      const id = user.id;
      const [bal, tot, usage, net, pots, act, dropsWeek, titles, ev] = await Promise.all([
        dbx.get('SELECT balance FROM users WHERE userId = ?', [id]),
        dbx.get('SELECT chars, voiceMinutes FROM act_totals WHERE userId = ?', [id]),
        activity.weeklyUsage(id, now),
        betting.weeklyNet(id, now),
        boosts.inventory(id),
        boosts.activeBoosts(id, now),
        dbx.get('SELECT count FROM drop_weekly WHERE userId = ? AND week = ?', [id, time.weekStartKey(now)]),
        dbx.all('SELECT titleId FROM titles WHERE userId = ? ORDER BY titleId', [id]),
        events.summary(id, now),
      ]);
      const embed = new EmbedBuilder()
        .setTitle(`🛠️ ${user.tag}`)
        .setColor(0x95A5A6)
        .addFields(
          { name: 'Coins', value: fmt.num(bal ? bal.balance : 0), inline: true },
          { name: 'Credited chars / voice', value: `${fmt.num(tot ? tot.chars : 0)} / ${fmt.minutesText(tot ? tot.voiceMinutes : 0)}`, inline: true },
          { name: 'Week (Sun→Sat Riyadh)', value:
            `Typing ${fmt.num(usage.text.weekCoins)}/${fmt.num(usage.text.weeklyCap)} · 30d ${fmt.num(usage.text.rollCoins)}/${fmt.num(usage.text.rollingCap)}\n` +
            `Voice ${fmt.num(usage.voice.weekCoins)}/${fmt.num(usage.voice.weeklyCap)} · 30d ${fmt.num(usage.voice.rollCoins)}/${fmt.num(usage.voice.rollingCap)}\n` +
            `Bet net ${fmt.num(net)}/${fmt.num(settings.betting.weeklyNetProfitCap)}\n` +
            `Drops this week ${dropsWeek ? dropsWeek.count : 0}/${settings.drops.maxPerWeek}\n` +
            `Resets ${fmt.tsRel(usage.resetAt)}` },
          { name: 'Potions', value: pots.length ? pots.map(p => `${p.type} ${p.hours}h`).join(', ') : 'none', inline: true },
          { name: 'Active boosts', value: act.length ? act.map(b => `${b.type} ×${b.multiplier} ends ${fmt.tsRel(b.expiresAt)}`).join('\n') : 'none', inline: true },
          { name: 'Titles', value: titles.length ? titles.map(t => t.titleId).join(', ').slice(0, 1000) : 'none', inline: false },
        );
      if (ev) {
        embed.addFields({ name: `Event ${ev.ev.id} (${ev.phase})`, value: `Candy ${ev.me.total} (voice ${ev.me.voice}, text ${ev.me.text}, games ${ev.me.games}) · qualified: ${ev.me.qualified} · paid: ${ev.rewarded}`, inline: false });
      }
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'week') {
      const keys = time.windowKeys(now);
      const rows = await dbx.all(
        `SELECT userId,
                SUM(CASE WHEN source = 'text'  THEN coins ELSE 0 END) AS tc,
                SUM(CASE WHEN source = 'voice' THEN coins ELSE 0 END) AS vc,
                SUM(CASE WHEN source = 'text'  THEN units ELSE 0 END) AS tu,
                SUM(CASE WHEN source = 'voice' THEN units ELSE 0 END) AS vu
           FROM act_daily WHERE day >= ? GROUP BY userId`, [keys.weekStart]);
      if (!rows.length) return interaction.editReply('No activity recorded yet this week.');

      const block = (label, coinKey, unitKey, cap, unitFmt) => {
        const active = rows.filter(r => r[coinKey] > 0);
        const coins = active.map(r => r[coinKey]).sort((a, b) => a - b);
        const units = active.map(r => r[unitKey]).sort((a, b) => a - b);
        const atCap = active.filter(r => r[coinKey] >= cap).length;
        const total = coins.reduce((a, b) => a + b, 0);
        return `**${label}** — ${active.length} earners, ${fmt.num(total)} coins minted, ${atCap} at the cap\n` +
          `coins p50 ${fmt.num(percentile(coins, 50))} · p90 ${fmt.num(percentile(coins, 90))} · p99 ${fmt.num(percentile(coins, 99))} · max ${fmt.num(coins[coins.length - 1] || 0)}\n` +
          `${unitFmt('p50', percentile(units, 50))} · ${unitFmt('p90', percentile(units, 90))} · ${unitFmt('p99', percentile(units, 99))}`;
      };
      const text = block('⌨️ Typing', 'tc', 'tu', settings.text.weeklyCoinCap, (k, v) => `chars ${k} ${fmt.num(v)}`);
      const voice = block('🎧 Voice', 'vc', 'vu', settings.voice.weeklyCoinCap, (k, v) => `voice ${k} ${fmt.minutesText(v)}`);
      return interaction.editReply(`📊 **Week starting ${keys.weekStart}** (so far)\n\n${text}\n\n${voice}`);
    }

    if (sub === 'event') {
      const s = await events.summary(null, now);
      if (!s) return interaction.editReply('No event configured.');
      const lines = s.community.tiers.map(t => `${t.emoji} ${t.label}: ${t.reached ? 'reached' : 'not yet'} (target ${fmt.num(t.target)})`);
      return interaction.editReply(
        `**${s.ev.name}** — phase **${s.phase}**, status **${s.status}**\n` +
        `${fmt.tsFull(s.startAt)} → ${fmt.tsFull(s.endAt)}\n` +
        `Participants ${fmt.num(s.community.participants)} · qualified ${fmt.num(s.community.qualified)} · total Candy **${fmt.num(s.community.total)}**\n` +
        lines.join('\n') +
        (s.result ? `\nResult: ${JSON.stringify(s.result)}` : '')
      );
    }
  },
};
