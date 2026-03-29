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

        // Use a transaction to avoid race conditions
        db.serialize(async () => {
            // First, get current lastWorkTime and balance
            db.get('SELECT lastWorkTime, balance FROM users WHERE userId = ?', [userId], async (err, row) => {
                if (err) {
                    console.error('Error fetching user:', err);
                    return interaction.editReply('❌ An error occurred. Please try again later.');
                }

                let lastWorkTime = row ? row.lastWorkTime : 0;
                let balance = row ? row.balance : 0;
                const cooldownMs = 24 * 60 * 60 * 1000;
                const timeLeft = lastWorkTime + cooldownMs - now;

                if (!isAdmin && timeLeft > 0) {
                    const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
                    const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
                    return interaction.editReply(`⏰ You can work again in **${hoursLeft}h ${minutesLeft}m**. Administrators have no cooldown.`);
                }

                const reward = Math.floor(Math.random() * (1000 - 250 + 1)) + 250;
                const newBalance = balance + reward;

                // Update the user record: set balance and lastWorkTime
                db.run(
                    `INSERT OR REPLACE INTO users (userId, balance, lastWorkTime) VALUES (?, ?, ?)`,
                    [userId, newBalance, now],
                    (updateErr) => {
                        if (updateErr) {
                            console.error('Error updating work data:', updateErr);
                            return interaction.editReply('❌ Failed to save work data. Please try again.');
                        }
                        console.log(`[WORK] User ${userId} earned ${reward}, new balance ${newBalance}, lastWorkTime set to ${now}`);
                        interaction.editReply(`💼 You worked hard and earned **${reward}** coins! ${isAdmin ? '(Admin: no cooldown applied)' : 'Come back tomorrow for more.'}`);
                    }
                );
            });
        });
    }
};
