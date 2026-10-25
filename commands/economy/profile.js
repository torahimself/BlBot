const { SlashCommandBuilder } = require('discord.js');
const views = require('../../utils/economy/engine/views.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Show your coins, titles and milestones (or another member\'s)')
    .addUserOption(o => o.setName('user').setDescription('Member to look at (default: you)').setRequired(false)),

  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    if (user.bot) return interaction.editReply('❌ Bots do not have a profile.');

    // Prefer the server nickname when the member is in this server.
    let name = user.globalName || user.username;
    let avatarUrl = user.displayAvatarURL({ size: 256 });
    if (interaction.guild) {
      const member = interaction.guild.members.cache.get(user.id) || await interaction.guild.members.fetch(user.id).catch(() => null);
      if (member) {
        name = member.displayName || name;
        avatarUrl = member.displayAvatarURL({ size: 256 });
      }
    }

    const embed = await views.buildProfile(user.id, name, avatarUrl);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
