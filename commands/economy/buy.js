const { SlashCommandBuilder } = require('discord.js');
const buyMenu = require('../../utils/economy/buyMenu.js');
const allowedChannels = ['1464140979148689550'];

// /buy replaces /buyrole: one menu for the custom role and the time-limited seasonal shop.
module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Shop: buy a custom role or browse the seasonal shop'),
  async execute(interaction) {
    if (!allowedChannels.includes(interaction.channelId)) {
      return interaction.editReply(`❌ This command can only be used in <#${allowedChannels[0]}>.`);
    }
    await interaction.editReply(await buyMenu.home(interaction.user.id));
  },
};
