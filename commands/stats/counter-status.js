const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config.js');
const ALLOWED_ROLE_ID = "1438249316559884499";

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counter-status')
    .setDescription('Check bot status and next report times'),
  
  async execute(interaction) {
    // Permission check
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      await interaction.editReply('❌ You do not have permission to use this command!');
      return;
    }

    // Use config.attachmentCounter for channels etc.
    const now = new Date();
    const nextFriday = new Date();
    const nextMonthStart = new Date();
    
    // … same logic as original, but config references become config.attachmentCounter
    // (all config references inside the embed should be updated)
  },
};
