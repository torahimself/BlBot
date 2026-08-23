const { SlashCommandBuilder } = require('discord.js');
const { addWarning } = require('../../utils/warn/warnManager.js');
const config = require('../../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Issue a warning to a user (staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to warn').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for the warning').setRequired(true))
        .addAttachmentOption(option => option.setName('evidence').setDescription('Optional: evidence for this warning').setRequired(false)),
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
        const reason = interaction.options.getString('reason');
        const evidence = interaction.options.getAttachment('evidence');

        if (targetUser.id === interaction.client.user.id) {
            return interaction.editReply('❌ I cannot warn myself.');
        }
        if (targetUser.bot) {
            return interaction.editReply('❌ Cannot warn a bot.');
        }

        const guild = interaction.guild;
        const member = guild.members.cache.get(targetUser.id) || await guild.members.fetch(targetUser.id).catch(() => null);
        if (!member) {
            return interaction.editReply('❌ That user is not in this server.');
        }

        const result = await addWarning(interaction.client, guild, member, interaction.user, reason, evidence);

        await interaction.editReply(
            `✅ <@${targetUser.id}> has been warned (Warning ID: ${result.warningId}).\n` +
            `Active warnings: **${result.activeCount}**\n` +
            `Punishment: **${result.punishment ? result.punishment.type : 'none'}**`
        );
    }
};
