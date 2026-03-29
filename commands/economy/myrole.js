const { SlashCommandBuilder } = require('discord.js');
const db = require('../../utils/economy/database.js');
const allowedChannels = ['1415933682748751923', '1464140979148689550'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myrole')
    .setDescription('View your custom role info'),
  async execute(interaction) {
    if (!allowedChannels.includes(interaction.channelId)) {
      return interaction.editReply(`❌ This command can only be used in <#1415933682748751923> or <#1464140979148689550>.`);
    }
    const userId = interaction.user.id;
    db.get('SELECT roleId, purchaseDate, expirationDate FROM purchased_roles WHERE ownerId = ?', [userId], async (err, row) => {
      if (err || !row) {
        return interaction.editReply('You do not own any custom role.');
      }
      const role = interaction.guild.roles.cache.get(row.roleId);
      const expiration = new Date(row.expirationDate);
      const now = new Date();
      const daysLeft = Math.max(0, Math.floor((row.expirationDate - now) / (1000 * 60 * 60 * 24)));
      await interaction.editReply({
        embeds: [{
          title: 'Your Custom Role',
          fields: [
            { name: 'Role', value: role ? `<@&${row.roleId}>` : 'Deleted', inline: true },
            { name: 'Expires', value: `<t:${Math.floor(row.expirationDate / 1000)}:R>`, inline: true },
            { name: 'Days Left', value: `${daysLeft} days`, inline: true }
          ]
        }]
      });
    });
  }
};
