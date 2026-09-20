// 🧪 TEMP SCRIPT — for finding users who hold the jail role but aren't
// tracked in the bot's jailed_users table (e.g. manually given the role
// outside /jail, or left over from before the bot tracked them). Tell
// Claude "remove the scan jail role command" when done and this whole file
// can be deleted safely — it doesn't touch any other part of the bot.
const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const { getAllJailRecords } = require('../../utils/jail/jailManager.js');
const config = require('../../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('scanjailrole')
        .setDescription('[TEMP] List members with the jail role who are NOT tracked as jailed by the bot')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.editReply('❌ You do not have permission to use this command!');
        }

        const role = interaction.guild.roles.cache.get(config.jail.jailRoleId);
        if (!role) {
            return interaction.editReply(`❌ Could not find role ${config.jail.jailRoleId} in this server.`);
        }

        // Make sure the member cache is actually populated before relying
        // on role.members, otherwise this silently under-reports.
        await interaction.guild.members.fetch();

        const roleHolders = role.members; // Collection<userId, GuildMember>
        const jailRecords = await getAllJailRecords();
        const trackedIds = new Set(jailRecords.map(r => r.userId));

        const untracked = roleHolders.filter(m => !trackedIds.has(m.id));

        if (untracked.size === 0) {
            return interaction.editReply(`✅ Scanned **${roleHolders.size}** member(s) with <@&${role.id}> — all of them are properly tracked in the bot's jail system.`);
        }

        // A previous version tried to list every user as embed fields, but
        // Discord embeds have a hard 6000-character TOTAL size cap across
        // title+description+all fields combined (separate from the
        // per-field 1024 cap), and a large untracked list blew past it.
        // A text file has no such limit, so use that instead — reliable
        // regardless of how many users are found.
        const lines = untracked.map(m => `${m.user.tag} — ${m.id} — <@${m.id}>`);
        const fileContent = lines.join('\n');

        const tmpPath = path.join('/tmp', `untracked-jail-role-${Date.now()}.txt`);
        fs.writeFileSync(tmpPath, fileContent, 'utf8');

        const embed = new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle('🔎 Untracked Jail Role Holders')
            .setDescription(
                `Scanned **${roleHolders.size}** member(s) with <@&${role.id}>.\n` +
                `**${untracked.size}** of them have the role but are **not** in the bot's jailed_users records — full list attached below.`
            )
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            files: [new AttachmentBuilder(tmpPath, { name: 'untracked_jail_role_holders.txt' })],
        });

        fs.unlink(tmpPath, () => {}); // best-effort cleanup, don't block the response on it
    }
};
