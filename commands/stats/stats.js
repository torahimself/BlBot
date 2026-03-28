const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../../config.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Generate manual media report (Last 7 days)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  
  async execute(interaction) {
    // Permission check
    const ALLOWED_ROLE_ID = "1438249316559884499";
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      await interaction.editReply('❌ You do not have permission to use this command!');
      return;
    }

    const scheduler = interaction.client.scheduler;
    if (!scheduler) {
      await interaction.editReply('❌ Scheduler not available. Bot is still initializing.');
      return;
    }
    await scheduler.generateManualReport(interaction);
  },
};
