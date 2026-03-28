const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config.js');
const rotationSystem = require('../../utils/rotationSystem');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rotation-status')
    .setDescription('Check channel rotation status and bot information'),
  
  async execute(interaction) {
    // … same as original, just command name changed
  },
};
