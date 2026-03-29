const cooldownCache = new Map();
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

        // Ensure user exists first
        await new Promise((resolve) => {
            db.run('INSERT OR IGNORE INTO users (userId, balance, wordCount, lastWorkTime) VALUES (?, 0, 0, 0)', [userId], (err) => {
                if (err) console.error('Error ensuring user exists:', err);
                resolve();
            });
        });

        // Get current lastWorkTime
        const row = await new Promise((resolve) => {
            db.get('SELECT lastWorkTime FROM users WHERE userId = ?', [userId], (err, row) => {
                if (err) {
                    console.error('Error fetching user:', err);
                    resolve(null);
                } else {
                    console.log(`[WORK] User ${userId}, lastWorkTime=${row ? row.lastWorkTime : 'NULL'}, now=${now}`);
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

        // Update balance and lastWorkTime in a single transaction
        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE users SET balance = balance + ?, lastWorkTime = ? WHERE userId = ?',
                [reward, now, userId],
                function(err) {
                    if (err) {
                        console.error('Failed to update work data:', err);
                        reject(err);
                    } else {
                        console.log(`[WORK] Updated ${this.changes} row(s) for user ${userId}, new lastWorkTime=${now}`);
                        if (this.changes === 0) {
                            // Fallback: insert if update affected nothing (should not happen due to INSERT OR IGNORE above)
                            db.run('INSERT INTO users (userId, balance, lastWorkTime) VALUES (?, ?, ?)', [userId, reward, now]);
                        }
                        resolve();
                    }
                }
            );
        });

        await interaction.editReply(`💼 You worked hard and earned **${reward}** coins! ${isAdmin ? '(Admin: no cooldown applied)' : 'Come back tomorrow for more.'}`);
    }
};
