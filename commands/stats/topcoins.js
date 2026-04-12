const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../utils/economy/database.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('topcoins')
    .setDescription('Show the top 10 richest players in the server'),

  async execute(interaction) {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        'SELECT userId, balance FROM users ORDER BY balance DESC LIMIT 10',
        [],
        (err, rows) => { if (err) reject(err); else resolve(rows); }
      );
    });

    if (!rows || rows.length === 0) {
      return interaction.editReply('❌ No data found yet.');
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((row, i) => {
      const medal = medals[i] || `**#${i + 1}**`;
      return `${medal} <@${row.userId}> — **${row.balance.toLocaleString()}** coins`;
    });

    const embed = new EmbedBuilder()
      .setTitle('💰 Top 10 Richest Players')
      .setDescription(lines.join('\n'))
      .setColor(0xFFD700)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
