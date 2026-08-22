const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAllWarnings, isWarningActive } = require('../../utils/warn/warnManager.js');
const config = require('../../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('userhistory')
        .setDescription('View a user\'s full warning history (staff only)')
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
        const warnings = await getAllWarnings(targetUser.id);

        if (warnings.length === 0) {
            return interaction.editReply(`📋 <@${targetUser.id}> has no warning history.`);
        }

        const activeCount = warnings.filter(w => isWarningActive(w)).length;

        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle(`📋 Warning History — ${targetUser.tag}`)
            .setDescription(`**Active warnings:** ${activeCount}\n**Total (all-time):** ${warnings.length}\n\nUse \`/warnedit\` or \`/warnremove\` with the Warning ID shown below to modify an entry.`)
            .setTimestamp();

        for (const w of warnings.slice(0, 24)) { // embed field limit safety
            let status;
            if (w.removed) status = `🗑️ Removed by <@${w.removedBy}>${w.removedReason ? ` — ${w.removedReason}` : ''}`;
            else if (isWarningActive(w)) status = '🟢 Active';
            else status = '⚪ Expired';

            embed.addFields({
                name: `#${w.warnNumberAtIssue} — Warning ID ${w.id}`,
                value: `**Reason:** ${w.reason}\n**By:** <@${w.issuedBy}>\n**Issued:** <t:${Math.floor(w.issuedAt / 1000)}:f>\n**Status:** ${status}`,
                inline: false,
            });
        }

        if (warnings.length > 24) {
            embed.setFooter({ text: `Showing 24 of ${warnings.length} total warnings (most recent first).` });
        }

        await interaction.editReply({ embeds: [embed] });
    }
};
