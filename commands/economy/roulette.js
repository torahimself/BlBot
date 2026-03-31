const { SlashCommandBuilder } = require('discord.js');
const { getBalance, updateBalance } = require('../../utils/economy/shopManager.js');
const allowedChannels = ['1415933682748751923'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roulette')
        .setDescription('Gamble on red or black (50% win chance, max bet 1000, win 1000)')
        .addStringOption(option => option.setName('color').setDescription('Red or black').setRequired(true).addChoices({ name: 'Red', value: 'red' }, { name: 'Black', value: 'black' }))
        .addIntegerOption(option => option.setName('bet').setDescription('Amount to gamble').setRequired(true).setMinValue(1).setMaxValue(1000)),
    async execute(interaction) {
        if (!allowedChannels.includes(interaction.channelId)) {
            return interaction.editReply(`❌ This command can only be used in <#1415933682748751923>.`);
        }

        const userId = interaction.user.id;
        const color = interaction.options.getString('color');
        const bet = interaction.options.getInteger('bet');
        const balance = await getBalance(userId);
        if (bet > balance) {
            return interaction.editReply(`❌ You only have ${balance} coins. Cannot bet ${bet}.`);
        }

        // Random win/loss (50% chance)
        const isWin = Math.random() < 0.5;
        let outcome;
        if (isWin) {
            await updateBalance(userId, bet);
            outcome = `🎰 The ball landed on ${color === 'red' ? '🔴' : '⚫'} and you won **${bet}** coins!`;
        } else {
            await updateBalance(userId, -bet);
            outcome = `🎰 The ball landed on ${color === 'red' ? '⚫' : '🔴'} and you lost **${bet}** coins.`;
        }

        await interaction.editReply(`${outcome}\nNew balance: ${balance + (isWin ? bet : -bet)} coins.`);
    }
};
