const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../../config.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counter-status')
    .setDescription('Check bot status and next report times')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  
  async execute(interaction) {
    // Check for Administrator permission
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.editReply('❌ You do not have permission to use this command!');
      return;
    }

    const now = new Date();
    const nextFriday = new Date();
    const nextMonthStart = new Date();
    
    // Calculate next Friday 1:00 AM Riyadh time (UTC+3)
    // Friday in Riyadh is 1:00 AM = previous day 22:00 UTC
    nextFriday.setUTCHours(22, 0, 0, 0); // 10 PM UTC
    while (nextFriday.getUTCDay() !== 4) { // Thursday UTC is equivalent to Friday Riyadh
      nextFriday.setUTCDate(nextFriday.getUTCDate() + 1);
    }
    // If today is past 10 PM UTC, move to next week
    if (now > nextFriday) {
      nextFriday.setUTCDate(nextFriday.getUTCDate() + 7);
    }
    
    // Calculate 1st of next month 1:00 AM Riyadh time (22:00 UTC previous day)
    nextMonthStart.setUTCHours(22, 0, 0, 0);
    nextMonthStart.setUTCMonth(now.getUTCMonth() + 1, 1);
    
    // Calculate time until reports
    const timeUntilFriday = nextFriday.getTime() - now.getTime();
    const daysUntilFriday = Math.floor(timeUntilFriday / (1000 * 60 * 60 * 24));
    const hoursUntilFriday = Math.floor((timeUntilFriday % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    const timeUntilMonthly = nextMonthStart.getTime() - now.getTime();
    const daysUntilMonthly = Math.floor(timeUntilMonthly / (1000 * 60 * 60 * 24));
    const hoursUntilMonthly = Math.floor((timeUntilMonthly % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    const statusEmbed = {
      title: "🤖 Attachment Counter Bot Status",
      color: 0x00AE86,
      fields: [
        {
          name: "🟢 Bot Status",
          value: "Operational ✅",
          inline: true
        },
        {
          name: "📊 Next Weekly Report",
          value: `<t:${Math.floor(nextFriday.getTime() / 1000)}:F>`,
          inline: true
        },
        {
          name: "📅 Next Monthly Report",
          value: `<t:${Math.floor(nextMonthStart.getTime() / 1000)}:F>`,
          inline: true
        },
        {
          name: "⏰ Weekly Time",
          value: `${daysUntilFriday}d ${hoursUntilFriday}h`,
          inline: true
        },
        {
          name: "📅 Monthly Time",
          value: `${daysUntilMonthly}d ${hoursUntilMonthly}h`,
          inline: true
        },
        {
          name: "📁 Categories Scanned",
          value: config.attachmentCounter.categoriesToScan.map(id => `<#${id}>`).join(', ') || 'None',
          inline: false
        },
        {
          name: "🚫 Excluded Channels",
          value: config.attachmentCounter.excludedChannels.map(id => `<#${id}>`).join(', ') || 'None',
          inline: false
        },
        {
          name: "👥 Tracked Roles",
          value: config.attachmentCounter.trackedRoles.map(id => `<@&${id}>`).join(', ') || 'None',
          inline: false
        },
        {
          name: "🕒 Weekly Schedule",
          value: "Every Friday 1:00 AM Riyadh Time",
          inline: true
        },
        {
          name: "📅 Monthly Schedule",
          value: "1st of each month 1:00 AM Riyadh Time",
          inline: true
        },
        {
          name: "📢 Report Channel",
          value: `<#${config.attachmentCounter.reportChannel}>`,
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: "Use /stats for weekly or /statsm for monthly reports"
      }
    };

    await interaction.editReply({ embeds: [statusEmbed] });
  },
};
