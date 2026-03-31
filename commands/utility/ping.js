const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency'),

    async execute(interaction) {
        // interaction is already deferred by interactionCreate
        const apiLatency = Math.round(interaction.client.ws.ping);

        // Calculate round-trip latency
        const startTime = Date.now();
        await interaction.editReply('🏓 Pinging...');
        const endTime = Date.now();
        const roundTripLatency = endTime - startTime;

        await interaction.editReply({
            content: `🏓 Pong! \n📡 Round-trip: ${roundTripLatency}ms \n🔧 API Latency: ${apiLatency}ms`
        });
    },
};
