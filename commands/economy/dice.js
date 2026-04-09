const { SlashCommandBuilder } = require('discord.js');
const { getBalance, updateBalance } = require('../../utils/economy/shopManager.js');
const allowedChannels = ['1415933682748751923'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dice')
        .setDescription('Gamble with dice (40% win chance, max bet 1000, win 150% of bet)')
        .addIntegerOption(option =>
            option.setName('bet')
                .setDescription('Amount to gamble (1-1000)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(1000)),
    async execute(interaction) {
        if (!allowedChannels.includes(interaction.channelId)) {
            return interaction.editReply(`❌ This command can only be used in <#1415933682748751923>.`);
        }

        const userId = interaction.user.id;
        const bet = interaction.options.getInteger('bet');
        const balance = await getBalance(userId);

        if (bet > balance) {
            return interaction.editReply(`❌ You only have ${balance} coins. Cannot bet ${bet}.`);
        }

        // Roll a random number 1-100; win if 1-40 (40% chance)
        const roll = Math.floor(Math.random() * 100) + 1;
        const isWin = roll <= 40;
        let winnings = 0;

        if (isWin) {
            // Win 150% of bet (1.5x)
            winnings = Math.floor(bet * 1.5);
            await updateBalance(userId, winnings);
        } else {
            await updateBalance(userId, -bet);
        }

        const resultMessage = isWin
            ? `🎲 You rolled **${roll}** (1-40 = win) and won **${winnings}** coins!`
            : `🎲 You rolled **${roll}** (1-40 = win) and lost **${bet}** coins.`;

        await interaction.editReply(`${resultMessage}\nNew balance: ${balance + (isWin ? winnings : -bet)} coins.`);
    }
};
