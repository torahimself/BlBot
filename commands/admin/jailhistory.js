const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getJailHistory, getJailRecord } = require('../../utils/jail/jailManager.js');
const config = require('../../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('jailhistory')
        .setDescription('View a user\'s full jail history (staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to look up').setRequired(true)),
    async execute(interaction) {
        const isAdmin = interaction.member.permissions.has('Administrator');
        const hasStaffRole = (config.warn.staffRoleIds || []).some(id => interaction.member.roles.cache.has(id));
        if (!isAdmin && !hasStaffRole) {
            return interaction.editReply('❌ You do not have permission to use this command!');
        }

        if (interaction.channelId !== config.warn.commandChannelId) {
            return interaction.editReply(`❌ This command can only be used in <#${config.warn.commandChannelId}>.`);
        }

        const targetUser = interaction.options.getUser('user');
        const current = await getJailRecord(targetUser.id);
        const history = await getJailHistory(targetUser.id);

        if (!current && history.length === 0) {
            return interaction.editReply(`📋 <@${targetUser.id}> has no jail history.`);
        }

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle(`🔒 Jail History — ${targetUser.tag}`)
            .setTimestamp();

        if (current) {
            embed.addFields({
                name: '🔴 Currently Jailed',
                value: `**By:** <@${current.jailedBy}>\n**Reason:** ${current.reason}\n**Since:** <t:${Math.floor(current.jailedAt / 1000)}:f>\n**Auto-release:** ${current.releaseAt ? `<t:${Math.floor(current.releaseAt / 1000)}:R>` : 'None (manual unjail required)'}`,
                inline: false,
            });
        }

        for (const record of history.slice(0, 20)) {
            const duration = record.releaseAt ? `${Math.round((record.releaseAt - record.jailedAt) / 3600000)}h (planned)` : 'Permanent (until manual unjail)';
            embed.addFields({
                name: `Jail — <t:${Math.floor(record.jailedAt / 1000)}:d>`,
                value:
                    `**Jailed by:** <@${record.jailedBy}>\n**Reason:** ${record.jailReason}\n**Duration:** ${duration}\n` +
                    `**Unjailed:** ${record.wasAuto ? 'Automatically (time expired)' : `by <@${record.unjailedBy}>`} on <t:${Math.floor(record.unjailedAt / 1000)}:f>\n` +
                    `**Unjail reason:** ${record.unjailReason}`,
                inline: false,
            });
        }

        if (history.length > 20) {
            embed.setFooter({ text: `Showing 20 of ${history.length} past jail records (most recent first).` });
        }

        await interaction.editReply({ embeds: [embed] });
    }
};
