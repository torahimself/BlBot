const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getBalance } = require('../../utils/economy/shopManager.js');
const allowedChannels = ['1415933682748751923', '1464140979148689550'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your coin balance'),
  async execute(interaction) {
    if (!allowedChannels.includes(interaction.channelId)) {
      return interaction.editReply(`❌ This command can only be used in <#1415933682748751923> or <#1464140979148689550>.`);
    }
    const balance = await getBalance(interaction.user.id);
    await interaction.editReply(`💰 Your balance: **${balance}** coins.`);
  }
};
