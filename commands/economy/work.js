const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../utils/economy/database.js');
const allowedChannels = ['1415933682748751923', '1464140979148689550'];

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

        // Get current lastWorkTime
        const row = await new Promise((resolve) => {
            db.get('SELECT lastWorkTime FROM users WHERE userId = ?', [userId], (err, row) => {
                if (err) {
                    console.error('Error fetching user:', err);
                    resolve(null);
                } else {
                    resolve(row);
                }
            });
        });

        const lastWorkTime = row ? row.lastWorkTime : 0;
        const cooldownMs = 24 * 60 * 60 * 1000;
        const timeLeft = lastWorkTime + cooldownMs - now;

        if (!isAdmin && timeLeft > 0) {
            const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
            const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            return interaction.editReply(`⏰ You can work again in **${hoursLeft}h ${minutesLeft}m**. Administrators have no cooldown.`);
        }

        const reward = Math.floor(Math.random() * (1000 - 250 + 1)) + 250;

        // Atomic update: add reward and set lastWorkTime
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO users (userId, balance, lastWorkTime) 
                 VALUES (?, ?, ?) 
                 ON CONFLICT(userId) DO UPDATE SET 
                 balance = balance + ?, 
                 lastWorkTime = ?`,
                [userId, reward, now, reward, now],
                (err) => {
                    if (err) {
                        console.error('Failed to update work data:', err);
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });

        await interaction.editReply(`💼 You worked hard and earned **${reward}** coins! ${isAdmin ? '(Admin: no cooldown applied)' : 'Come back tomorrow for more.'}`);
    }
};
