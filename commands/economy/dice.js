const { SlashCommandBuilder } = require('discord.js');
const { getBalance, updateBalance } = require('../../utils/economy/shopManager.js');
const allowedChannels = ['1415933682748751923'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dice')
        .setDescription('Gamble with dice (20% win chance, max bet 10000, win up to 15000)')
        .addIntegerOption(option => option.setName('bet').setDescription('Amount to gamble').setRequired(true).setMinValue(1).setMaxValue(10000)),
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

        // Roll a random number 1-100; win if 1-20 (20% chance)
        const roll = Math.floor(Math.random() * 100) + 1;
        const isWin = roll <= 20;
        let winnings = 0;
        if (isWin) {
            // Win up to 15000, but capped by bet? We'll implement: win bet * 1.5, max 15000
            winnings = Math.min(bet * 1.5, 15000);
            winnings = Math.floor(winnings);
            await updateBalance(userId, winnings);
        } else {
            await updateBalance(userId, -bet);
        }

        const resultMessage = isWin 
            ? `🎲 You rolled a **${roll}** (1-20 = win) and won **${winnings}** coins!`
            : `🎲 You rolled a **${roll}** (1-20 = win) and lost **${bet}** coins.`;

        await interaction.editReply(`${resultMessage}\nNew balance: ${balance + (isWin ? winnings : -bet)} coins.`);
    }
};
