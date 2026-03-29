const { SlashCommandBuilder } = require('discord.js');
const { getBalance, updateBalance } = require('../../utils/economy/shopManager.js');
const db = require('../../utils/economy/database.js');
const allowedChannels = ['1415933682748751923', '1464140979148689550'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Work daily to earn coins (250-1000)'),
  async execute(interaction) {
    if (!allowedChannels.includes(interaction.channelId)) {
      return interaction.editReply(`❌ This command can only be used in <#1415933682748751923> or <#1464140979148689550>.`);
    }
    const userId = interaction.user.id;
    const now = Date.now();
    const lastWork = await new Promise((resolve) => {
      db.get('SELECT lastWorkTime FROM users WHERE userId = ?', [userId], (err, row) => {
        resolve(row ? row.lastWorkTime : 0);
      });
    });
    const cooldown = 24 * 60 * 60 * 1000;
    if (now - lastWork < cooldown) {
      const remaining = cooldown - (now - lastWork);
      const hours = Math.floor(remaining / (60 * 60 * 1000));
      const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
      return interaction.editReply(`⏰ You can work again in ${hours}h ${minutes}m.`);
    }
    const reward = Math.floor(Math.random() * (1000 - 250 + 1)) + 250;
    await updateBalance(userId, reward);
    db.run('UPDATE users SET lastWorkTime = ? WHERE userId = ?', [now, userId]);
    await interaction.editReply(`💼 You worked hard and earned **${reward}** coins!`);
  }
};
