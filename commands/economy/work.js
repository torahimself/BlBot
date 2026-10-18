const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../utils/economy/database.js');
const allowedChannels = ['1415933682748751923', '1464140979148689550'];

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Work daily to earn coins (250-1000)')
        .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

    async execute(interaction) {
        if (!allowedChannels.includes(interaction.channelId)) {
            return interaction.editReply(`❌ This command can only be used in <#1415933682748751923> or <#1464140979148689550>.`);
        }

        const userId = interaction.user.id;
        const isAdmin = interaction.member.permissions.has('Administrator');
        const now = Date.now();
        const reward = Math.floor(Math.random() * (1000 - 250 + 1)) + 250;

        try {
            // Make sure the user has a row to update.
            await dbRun('INSERT OR IGNORE INTO users (userId, balance, lastWorkTime) VALUES (?, 0, 0)', [userId]);

            // Claim the payout in ONE statement that also checks the cooldown.
            // (It used to read lastWorkTime, then write later — two /work
            // commands sent at the same moment could both pass the check and
            // both pay out.) Admins skip the cooldown, as before.
            const claim = isAdmin
                ? await dbRun('UPDATE users SET balance = balance + ?, lastWorkTime = ? WHERE userId = ?', [reward, now, userId])
                : await dbRun(
                    `UPDATE users SET balance = balance + ?, lastWorkTime = ?
                     WHERE userId = ? AND (lastWorkTime IS NULL OR lastWorkTime + ? <= ?)`,
                    [reward, now, userId, COOLDOWN_MS, now]
                );

            if (claim.changes === 0) {
                const row = await dbGet('SELECT lastWorkTime FROM users WHERE userId = ?', [userId]);
                const lastWorkTime = row ? row.lastWorkTime : 0;
                const timeLeft = Math.max(0, lastWorkTime + COOLDOWN_MS - now);
                const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
                const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
                return interaction.editReply(`⏰ You can work again in **${hoursLeft}h ${minutesLeft}m**.`);
            }

            console.log(`[WORK] ${userId} earned ${reward} (lastWorkTime -> ${now})`);
            await interaction.editReply(`💼 You worked hard and earned **${reward}** coins! ${isAdmin ? '' : 'Come back tomorrow for more.'}`);
        } catch (err) {
            console.error('[WORK] Failed:', err);
            await interaction.editReply('❌ Something went wrong while working. Please try again.');
        }
    }
};
