const { SlashCommandBuilder } = require('discord.js');
const { getBalance, updateBalance } = require('../../utils/economy/shopManager.js');

const allowedChannels = ['1415933682748751923'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dice')
    .setDescription('Guess the dice roll and win coins!')
    .addIntegerOption(option =>
      option.setName('bet')
        .setDescription('Amount of coins to bet')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1000))
    .addIntegerOption(option =>
      option.setName('guess')
        .setDescription('Your guess')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(4)),

  async execute(interaction) {
    if (!allowedChannels.includes(interaction.channelId)) {
      return interaction.editReply(`❌ This command can only be used in <#1415933682748751923>.`);
    }

    const userId = interaction.user.id;
    const bet = interaction.options.getInteger('bet');
    const guess = interaction.options.getInteger('guess');
    const balance = await getBalance(userId);

    if (bet > balance) {
      return interaction.editReply(`❌ You only have ${balance} coins. Cannot bet ${bet}.`);
    }

    // Roll 1-4 for a 25% win chance (up from 1/6 ~16.7%)
    const roll = Math.floor(Math.random() * 4) + 1;
    const isWin = guess === roll;

    let newBalance;
    if (isWin) {
      const winnings = bet * 3;
      await updateBalance(userId, winnings);
      newBalance = balance + winnings;
      await interaction.editReply(`🎲 The number was **${roll}**. You guessed **${guess}** — you won **${winnings}** coins!\nBalance: ${newBalance} coins.`);
    } else {
      await updateBalance(userId, -bet);
      newBalance = balance - bet;
      await interaction.editReply(`🎲 The number was **${roll}**. You guessed **${guess}** — you lost **${bet}** coins.\nBalance: ${newBalance} coins.`);
    }
  },
};
