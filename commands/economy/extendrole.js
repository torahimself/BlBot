const { SlashCommandBuilder } = require('discord.js');
const shopManager = require('../../utils/economy/shopManager.js');
const { extendRole, getBalance, ROLE_PRICE } = shopManager;
const db = require('../../utils/economy/database.js');

const allowedChannels = ['1464140979148689550'];
const EXPIRATION_WARNING_MS = 24 * 60 * 60 * 1000; // matches shopManager's warning window

module.exports = {
    data: new SlashCommandBuilder()
        .setName('extendrole')
        .setDescription(`Extend your custom role for 30 more days (${ROLE_PRICE} coins) when it's close to expiring`),
    async execute(interaction) {
        if (!allowedChannels.includes(interaction.channelId)) {
            return interaction.editReply(`❌ This command can only be used in <#1464140979148689550>.`);
        }

        const userId = interaction.user.id;

        const roleData = await new Promise((resolve, reject) => {
            db.get('SELECT roleId, expirationDate FROM purchased_roles WHERE ownerId = ?', [userId], (err, row) => {
                if (err) reject(err); else resolve(row);
            });
        });

        if (!roleData) {
            return interaction.editReply('❌ You do not own a custom role.');
        }

        const timeLeft = roleData.expirationDate - Date.now();

        if (timeLeft <= 0) {
            return interaction.editReply('❌ Your role has already expired. Purchase a new one with `/buyrole`.');
        }

        if (timeLeft > EXPIRATION_WARNING_MS) {
            const hoursLeft = Math.ceil(timeLeft / (60 * 60 * 1000));
            return interaction.editReply(`❌ Your role isn't close to expiring yet (**${hoursLeft}h** left). You can only extend within 24 hours of expiration.`);
        }

        const balance = await getBalance(userId);
        if (balance < ROLE_PRICE) {
            return interaction.editReply(`❌ You need **${ROLE_PRICE}** coins to extend. You have **${balance}**.`);
        }

        const result = await extendRole(roleData.roleId, userId);
        if (result.success) {
            const newExpiry = Date.now() + (30 * 24 * 60 * 60 * 1000);
            await interaction.editReply(`✅ Your role <@&${roleData.roleId}> has been extended for 30 days! New expiry: <t:${Math.floor(newExpiry / 1000)}:R>`);
        } else {
            await interaction.editReply(`❌ ${result.message}`);
        }
    }
};
