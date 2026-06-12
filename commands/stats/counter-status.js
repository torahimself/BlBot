const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const config = require('../../config.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counter-status')
    .setDescription('Check bot status and next report times')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.editReply('❌ You do not have permission to use this command!');
      return;
    }

    const now = new Date();

    // Next 1st of month at 1:00 AM Riyadh (UTC+3 → 22:00 UTC previous day)
    // We calculate the next 1st of month in Riyadh time as a UTC timestamp
    function nextFirstOfMonth() {
      const d = new Date(now);
      // Advance to next month's 1st
      d.setUTCMonth(d.getUTCMonth() + 1, 1);
      // 1:00 AM Riyadh = 22:00 UTC the previous calendar day
      d.setUTCDate(d.getUTCDate() - 1);
      d.setUTCHours(22, 0, 0, 0);
      // If that moment is already in the past, add another month
      if (d <= now) {
        d.setUTCMonth(d.getUTCMonth() + 1);
      }
      return d;
    }

    const nextMonthly = nextFirstOfMonth();
    const msUntil = nextMonthly.getTime() - now.getTime();
    const daysUntil  = Math.floor(msUntil / (1000 * 60 * 60 * 24));
    const hoursUntil = Math.floor((msUntil % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    const embed = new EmbedBuilder()
      .setTitle('🤖 Attachment Counter Bot Status')
      .setColor(0x00AE86)
      .setTimestamp()
      .setFooter({ text: 'Use /statsm for monthly report · /statp for partner report' })
      .addFields(
        {
          name: '🟢 Bot Status',
          value: 'Operational ✅',
          inline: true,
        },
        {
          name: '📅 Next Monthly Report',
          value: `<t:${Math.floor(nextMonthly.getTime() / 1000)}:F>`,
          inline: true,
        },
        {
          name: '⏰ Time Until Report',
          value: `${daysUntil}d ${hoursUntil}h`,
          inline: true,
        },
        {
          name: '🗓️ Schedule',
          value: '1st of every month · 1:00 AM Riyadh Time',
          inline: false,
        },
        {
          name: '📁 Regular Scan — Categories',
          value: config.attachmentCounter.categoriesToScan.map(id => `<#${id}>`).join(', ') || 'None',
          inline: false,
        },
        {
          name: '🚫 Regular Scan — Excluded Channels',
          value: config.attachmentCounter.excludedChannels.map(id => `<#${id}>`).join(', ') || 'None',
          inline: false,
        },
        {
          name: '👥 Regular Scan — Tracked Roles',
          value: config.attachmentCounter.trackedRoles.map(id => `<@&${id}>`).join(', ') || 'None',
          inline: false,
        },
        {
          name: '📢 Regular Report Channel',
          value: `<#${config.attachmentCounter.reportChannel}>`,
          inline: true,
        },
        {
          name: '📌 Statp Channels',
          value: config.statp.channels.map(id => `<#${id}>`).join(', ') || 'None',
          inline: false,
        },
        {
          name: '📂 Statp Category',
          value: `<#${config.statp.category}>`,
          inline: true,
        },
        {
          name: '🎭 Statp Tracked Role',
          value: `<@&${config.statp.trackedRole}>`,
          inline: true,
        },
        {
          name: '📢 Statp Report Channel',
          value: `<#${config.statp.reportChannel}>`,
          inline: true,
        },
      );

    await interaction.editReply({ embeds: [embed] });
  },
};
