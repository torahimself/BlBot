const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { jailUser, parseDuration } = require('../../utils/jail/jailManager.js');
const config = require('../../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('jail')
        .setDescription('Jail a user — strips their roles and applies the jail role (admin/staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to jail').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for jailing').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('Optional: e.g. "1d", "3h", "45m", "1d12h" — omit for permanent').setRequired(false))
        .addAttachmentOption(option => option.setName('evidence').setDescription('Optional: image or video evidence').setRequired(false)),
    async execute(interaction) {
        const isAdmin = interaction.member.permissions.has('Administrator');
        const hasStaffRole = (config.jail.staffRoleIds || []).some(id => interaction.member.roles.cache.has(id));
        if (!isAdmin && !hasStaffRole) {
            return interaction.editReply('❌ You do not have permission to use this command!');
        }

        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const durationInput = interaction.options.getString('duration');
        const evidence = interaction.options.getAttachment('evidence');

        if (targetUser.id === interaction.client.user.id) {
            return interaction.editReply('❌ I cannot jail myself.');
        }
        if (targetUser.bot) {
            return interaction.editReply('❌ Cannot jail a bot.');
        }

        const guild = interaction.guild;
        const member = guild.members.cache.get(targetUser.id) || await guild.members.fetch(targetUser.id).catch(() => null);
        if (!member) {
            return interaction.editReply('❌ That user is not in this server.');
        }

        if (member.roles.highest.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
            return interaction.editReply('❌ You cannot jail someone with an equal or higher role than you.');
        }

        let durationMs = null;
        if (durationInput) {
            durationMs = parseDuration(durationInput);
            if (durationMs === null) {
                return interaction.editReply('❌ Could not parse that duration. Use a format like `1d`, `3h`, `45m`, or `1d12h30m`.');
            }
        }

        const result = await jailUser(interaction.client, guild, member, interaction.user, reason, durationMs, evidence);

        if (!result.success) {
            return interaction.editReply(`❌ ${result.message}`);
        }

        const durationText = durationMs
            ? `<t:${Math.floor(result.releaseAt / 1000)}:R>`
            : 'permanently (until manually unjailed)';

        await interaction.editReply(`✅ <@${targetUser.id}> has been jailed. Auto-unjail: ${durationText}. Saved ${result.previousRoleCount} previous role(s).`);
    }
};
