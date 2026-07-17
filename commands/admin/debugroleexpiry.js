// 🧪 DEBUG TOOL — for testing the role expiry warning / extend flow without
// waiting a real 30 days. Tell Claude "remove the debug command" once done
// testing and this whole file (plus nothing else) can be deleted safely —
// it doesn't touch any other part of the bot.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../utils/economy/database.js');
const { checkExpiredRoles } = require('../../utils/economy/shopManager.js');

const LOG_CHANNEL_ID = '1380869949463199856'; // same channel used by the real scheduler in ready.js

module.exports = {
    data: new SlashCommandBuilder()
        .setName('debugroleexpiry')
        .setDescription('[DEBUG] Fast-forward a role\'s expiration for testing (admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addRoleOption(option => option.setName('role').setDescription('The purchased custom role to modify').setRequired(true))
        .addIntegerOption(option => option.setName('minutes')
            .setDescription('Minutes from now until it "expires" (0 = expire immediately, deletes the role)')
            .setRequired(true)
            .setMinValue(0)),
    async execute(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.editReply('❌ You do not have permission to use this command!');
        }

        const role = interaction.options.getRole('role');
        const minutes = interaction.options.getInteger('minutes');

        const roleData = await new Promise((resolve, reject) => {
            db.get('SELECT roleId, ownerId FROM purchased_roles WHERE roleId = ?', [role.id], (err, row) => {
                if (err) reject(err); else resolve(row);
            });
        });

        if (!roleData) {
            return interaction.editReply(`❌ <@&${role.id}> is not in the purchased_roles table — it isn't a purchased custom role, or was already deleted.`);
        }

        const newExpiration = Date.now() + (minutes * 60 * 1000);

        await new Promise((resolve, reject) => {
            db.run('UPDATE purchased_roles SET expirationDate = ? WHERE roleId = ?', [newExpiration, role.id], (err) => {
                if (err) reject(err); else resolve();
            });
        });

        await interaction.editReply(
            `🧪 Set <@&${role.id}> (owner <@${roleData.ownerId}>) to expire in **${minutes} minute(s)**.\n` +
            `Triggering the expiry check now — ${minutes === 0 ? 'the role will be deleted immediately.' : 'the owner should get a DM pointing to `/extendrole`.'}`
        );

        // Trigger the real check immediately instead of waiting for the
        // scheduled interval, so this is testable right away.
        checkExpiredRoles(interaction.client, LOG_CHANNEL_ID);
    }
};
