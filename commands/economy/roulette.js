const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { getBalance, spendCoins } = require('../../utils/economy/shopManager.js');
const { isBet, canBet, settleBet, capRefusal } = require('../../utils/economy/stakes.js');
const allowedChannels = ['1415933682748751923'];

// Pre-rendered spinning-wheel GIFs: assets/roulette/wheel_1.gif … wheel_36.gif
// (odd pocket = red, even = black). Made by dev/make-roulette-gifs.py.
const WHEEL_DIR = path.join(__dirname, '..', '..', 'assets', 'roulette');
const SPIN_MS = Number(process.env.BL_ROULETTE_SPIN_MS ?? 3200);   // about as long as the GIF spins
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickPocket(landed) {
    // red = odd numbers, black = even numbers
    const n = Math.floor(Math.random() * 18);
    return landed === 'red' ? n * 2 + 1 : n * 2 + 2;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roulette')
        .setDescription('Red or black (50% win chance) — play for free or bet up to 1000')
        .addStringOption(option => option.setName('color').setDescription('Red or black').setRequired(true).addChoices({ name: 'Red', value: 'red' }, { name: 'Black', value: 'black' }))
        .addIntegerOption(option => option.setName('bet').setDescription('Amount to gamble (leave empty to play for free)').setRequired(false).setMinValue(1).setMaxValue(1000)),
    async execute(interaction) {
        if (!allowedChannels.includes(interaction.channelId)) {
            return interaction.editReply(`❌ This command can only be used in <#1415933682748751923>.`);
        }

        const userId = interaction.user.id;
        const color = interaction.options.getString('color');
        const bet = interaction.options.getInteger('bet') || 0; // 0 = free game

        if (isBet(bet)) {
            const cap = await canBet([userId], bet);
            if (!cap.ok) return interaction.editReply(capRefusal(userId, false));

            // Take the bet up front, atomically (no check-then-deduct gap).
            const paid = await spendCoins(userId, bet);
            if (!paid) {
                const balance = await getBalance(userId);
                return interaction.editReply(`❌ You only have ${balance} coins. Cannot bet ${bet}.`);
            }
        }

        const isWin = Math.random() < 0.5;
        const landed = isWin ? color : (color === 'red' ? 'black' : 'red');
        const icon = landed === 'red' ? '🔴' : '⚫';
        const pocket = pickPocket(landed);

        // Settle first (so a crash during the animation can never lose a stake), then animate.
        let text;
        let balanceLine = '';
        if (!isBet(bet)) {
            text = `The ball landed on ${icon} **${pocket}** — ${isWin ? 'you won! 🎉' : 'better luck next time.'}\n*(Free game — no coins at stake.)*`;
        } else {
            const res = await settleBet({
                kind: 'house',
                stakes: { [userId]: bet },
                payouts: isWin ? { [userId]: bet * 2 } : {},
            });
            const newBalance = await getBalance(userId);
            text = isWin
                ? `The ball landed on ${icon} **${pocket}** and you won **${res.nets[userId] || 0}** coins!${res.note}`
                : `The ball landed on ${icon} **${pocket}** and you lost **${bet}** coins.`;
            balanceLine = `\nNew balance: ${newBalance} coins.`;
        }

        const gifPath = path.join(WHEEL_DIR, `wheel_${pocket}.gif`);
        const hasGif = fs.existsSync(gifPath);
        if (hasGif) {
            const file = new AttachmentBuilder(gifPath, { name: 'wheel.gif' });
            const spin = new EmbedBuilder().setColor(0xF1C40F).setTitle('🎰 Roulette')
                .setDescription(`<@${userId}> bet on ${color === 'red' ? '🔴 red' : '⚫ black'} — the wheel is spinning…`)
                .setImage('attachment://wheel.gif');
            await interaction.editReply({ embeds: [spin], files: [file], allowedMentions: { parse: [] } });
            await sleep(SPIN_MS);
        }

        if (hasGif) {
            const done = new EmbedBuilder().setColor(isWin ? 0x57F287 : 0xED4245).setTitle('🎰 Roulette')
                .setDescription(text + balanceLine).setImage('attachment://wheel.gif');
            return interaction.editReply({ embeds: [done] });   // the GIF attachment is kept
        }
        return interaction.editReply(`🎰 ${text}${balanceLine}`);
    }
};
