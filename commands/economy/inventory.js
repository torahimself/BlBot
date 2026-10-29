const { SlashCommandBuilder } = require('discord.js');
const views = require('../../utils/economy/engine/views.js');
const { whoIs } = require('../../utils/ui/customize.js');

// Replaces the old /balance command: coins, potions, active boosts and this
// week's earnings, with a menu to activate a potion. Private (only you see it).
module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Your coins, boost potions and active boosts — activate a potion here'),

  async execute(interaction) {
    await interaction.editReply(await views.inventoryPayload(interaction.user.id, { user: whoIs(interaction) }));
  },
};
