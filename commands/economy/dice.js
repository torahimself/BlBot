const { SlashCommandBuilder } = require('discord.js');
const { getBalance, spendCoins } = require('../../utils/economy/shopManager.js');
const { isBet, canBet, settleBet, capRefusal } = require('../../utils/economy/stakes.js');

const GAME_CHANNELS = require('../../utils/gameChannels.js');
const allowedChannels = GAME_CHANNELS.IDS;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dice')
    .setDescription('Guess the dice roll — play for free or bet coins!')
    .addIntegerOption(option =>
      option.setName('guess')
        .setDescription('Your guess')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(4))
    .addIntegerOption(option =>
      option.setName('bet')
        .setDescription('Amount of coins to bet (leave empty to play for free)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(1000)),

  async execute(interaction) {
    if (!allowedChannels.includes(interaction.channelId)) {
      return interaction.editReply(`❌ Games can only be played in ${GAME_CHANNELS.mention}.`);
    }

    const userId = interaction.user.id;
    const bet = interaction.options.getInteger('bet') || 0; // 0 = free game
    const guess = interaction.options.getInteger('guess');

    if (isBet(bet)) {
      const cap = await canBet([userId], bet);
      if (!cap.ok) return interaction.editReply(capRefusal(userId, false));

      // Take the bet up front, atomically. (Checking the balance first and
      // deducting afterwards let two quick /dice commands spend the same coins.)
      const paid = await spendCoins(userId, bet);
      if (!paid) {
        const balance = await getBalance(userId);
        return interaction.editReply(`❌ You only have ${balance} coins. Cannot bet ${bet}.`);
      }
    }

    // Roll 1-4 for a 25% win chance
    const roll = Math.floor(Math.random() * 4) + 1;
    const isWin = guess === roll;

    if (!isBet(bet)) {
      return interaction.editReply(`🎲 The number was **${roll}**. You guessed **${guess}** — ${isWin ? 'you won! 🎉' : 'better luck next time.'}\n*(Free game — no coins at stake.)*`);
    }

    // Win pays 3× profit (stake back + 3× bet). The weekly net-profit cap may trim it.
    const res = await settleBet({
      kind: 'house',
      stakes: { [userId]: bet },
      payouts: isWin ? { [userId]: bet * 4 } : {},
    });
    const newBalance = await getBalance(userId);
    if (isWin) {
      const won = (res.nets[userId] || 0);
      await interaction.editReply(`🎲 The number was **${roll}**. You guessed **${guess}** — you won **${won}** coins!${res.note}\nBalance: ${newBalance} coins.`);
    } else {
      await interaction.editReply(`🎲 The number was **${roll}**. You guessed **${guess}** — you lost **${bet}** coins.\nBalance: ${newBalance} coins.`);
    }
  },
};
