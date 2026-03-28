const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('statsm')
    .setDescription('Generate monthly media report')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  
  async execute(interaction) {
    // Check for Administrator permission
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.editReply('❌ You do not have permission to use this command!');
      return;
    }

    const scheduler = interaction.client.scheduler;
    if (!scheduler) {
      await interaction.editReply('❌ Scheduler not available. Bot is still initializing. Please wait a moment and try again.');
      return;
    }
    await scheduler.generateManualMonthlyReport(interaction);
  },
};
