const { SlashCommandBuilder } = require('discord.js');
const events = require('../../utils/economy/engine/events.js');
const views = require('../../utils/economy/engine/views.js');

// Delete this file (or set events.current to null in
// utils/economy/engine/settings.js) once the event is over.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Show the current server event: your Candy 🍬 and the community progress'),

  async execute(interaction) {
    const summary = await events.summary(interaction.user.id);
    if (!summary) return interaction.editReply('There is no event right now.');
    await interaction.editReply({ embeds: [views.eventEmbed(summary)], allowedMentions: { parse: [] } });
  },
};
