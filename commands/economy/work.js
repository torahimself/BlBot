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

        // Ensure user exists and get lastWorkTime
        let lastWorkTime = 0;
        await new Promise((resolve, reject) => {
            db.get('SELECT lastWorkTime FROM users WHERE userId = ?', [userId], (err, row) => {
                if (err) {
                    console.error(`[WORK] Error fetching user ${userId}:`, err);
                    reject(err);
                } else if (!row) {
                    // Create user with default values
                    db.run('INSERT INTO users (userId, balance, wordCount, lastWorkTime) VALUES (?, 0, 0, 0)', [userId], (err2) => {
                        if (err2) {
                            console.error(`[WORK] Error creating user ${userId}:`, err2);
                            reject(err2);
                        } else {
                            lastWorkTime = 0;
                            resolve();
                        }
                    });
                } else {
                    lastWorkTime = row.lastWorkTime || 0;
                    resolve();
                }
            });
        }).catch(() => {
            return interaction.editReply('❌ Database error. Please try again later.');
        });

        const cooldownMs = 24 * 60 * 60 * 1000;
        const timeLeft = lastWorkTime + cooldownMs - now;
        console.log(`[WORK] User ${userId}, lastWorkTime=${lastWorkTime}, now=${now}, timeLeft=${timeLeft}`);

        if (!isAdmin && timeLeft > 0) {
            const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
            const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            return interaction.editReply(`⏰ You can work again in **${hoursLeft}h ${minutesLeft}m**. Administrators have no cooldown.`);
        }

        const reward = Math.floor(Math.random() * (1000 - 250 + 1)) + 250;

        // Update balance and lastWorkTime atomically
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE users SET balance = balance + ?, lastWorkTime = ? WHERE userId = ?`,
                [reward, now, userId],
                (err) => {
                    if (err) {
                        console.error(`[WORK] Error updating work for ${userId}:`, err);
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        }).catch(() => {
            return interaction.editReply('❌ Failed to update. Please try again.');
        });

        // Verify the update (optional)
        const updated = await new Promise((resolve) => {
            db.get('SELECT lastWorkTime FROM users WHERE userId = ?', [userId], (err, row) => {
                if (err) resolve(false);
                else resolve(row ? row.lastWorkTime : 0);
            });
        });
        console.log(`[WORK] Updated lastWorkTime for ${userId} to ${updated}`);

        await interaction.editReply(`💼 You worked hard and earned **${reward}** coins! ${isAdmin ? '(Admin: no cooldown applied)' : 'Come back tomorrow for more.'}`);
    }
};
