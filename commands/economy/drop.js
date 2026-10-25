const { SlashCommandBuilder } = require('discord.js');
const drops = require('../../utils/economy/engine/drops.js');

// Only affects the random-drop DMs. Warnings, jail, ban and every other
// moderation message are completely separate and can never be switched off here.
module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('drop')
    .setDescription('Turn random-drop notifications (DMs) on or off')
    .addStringOption(o => o
      .setName('notifications')
      .setDescription('Receive a DM when you find a random drop?')
      .setRequired(true)
      .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })),

  async execute(interaction) {
    const on = interaction.options.getString('notifications') === 'on';
    await drops.setDmPref(interaction.user.id, on);
    await interaction.editReply(on
      ? '🔔 Random-drop DMs are **on**. You will be told when you find something.'
      : '🔕 Random-drop DMs are **off**. You will still receive your drops — check **/inventory** — you just will not be messaged about them.\n-# This only affects drop messages, never moderation notices.');
  },
};
