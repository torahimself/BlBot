const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { unjailUser } = require('../../utils/jail/jailManager.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unjail')
        .setDescription('Unjail a user — restores their previous roles (admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option => option.setName('user').setDescription('User to unjail').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for unjailing').setRequired(true))
        .addAttachmentOption(option => option.setName('evidence').setDescription('Optional: image or video evidence').setRequired(false)),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.editReply('❌ You do not have permission to use this command!');
        }

        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const evidence = interaction.options.getAttachment('evidence');

        const result = await unjailUser(interaction.client, interaction.guild, targetUser.id, interaction.user, reason, evidence, false);

        if (!result.success) {
            return interaction.editReply(`❌ ${result.message}`);
        }

        await interaction.editReply(`✅ <@${targetUser.id}> has been unjailed.`);
    }
};
