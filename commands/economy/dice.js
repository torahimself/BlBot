const { SlashCommandBuilder } = require('discord.js');
const { getBalance, updateBalance } = require('../../utils/economy/shopManager.js');
const allowedChannels = ['1415933682748751923'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dice')
        .setDescription('Guess a number 1-6. Win 5x your bet if correct!')
        .addIntegerOption(option =>
            option.setName('bet')
                .setDescription('Amount to gamble (1-1000)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(1000))
        .addIntegerOption(option =>
            option.setName('guess')
                .setDescription('Your guess (1-6)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(6)),
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

        const roll = Math.floor(Math.random() * 6) + 1; // 1-6
        const isWin = (guess === roll);
        let winnings = 0;

        if (isWin) {
            winnings = bet * 5;
            await updateBalance(userId, winnings);
        } else {
            await updateBalance(userId, -bet);
        }

        const resultMessage = isWin
            ? `🎲 The number was **${roll}**. You guessed **${guess}** and won **${winnings}** coins!`
            : `🎲 The number was **${roll}**. You guessed **${guess}** and lost **${bet}** coins.`;

        await interaction.editReply(`${resultMessage}\nNew balance: ${balance + (isWin ? winnings : -bet)} coins.`);
    }
};
