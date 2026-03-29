const db = require('./database.js');

const WORD_THRESHOLD = 100;
const MIN_REWARD = 67;
const MAX_REWARD = 444;

function getRandomReward() {
    return Math.floor(Math.random() * (MAX_REWARD - MIN_REWARD + 1)) + MIN_REWARD;
}

async function processMessage(message) {
    if (message.author.bot) return;
    if (message.content.startsWith('/')) return;

    const words = message.content.trim().split(/\s+/).length;
    if (words === 0) return;

    const userId = message.author.id;

    return new Promise((resolve) => {
        db.get('SELECT wordCount, balance FROM users WHERE userId = ?', [userId], async (err, row) => {
            if (err) {
                console.error(err);
                return resolve();
            }
            let wordCount = row ? row.wordCount : 0;
            let balance = row ? row.balance : 0;
            let totalReward = 0;

            wordCount += words;
            while (wordCount >= WORD_THRESHOLD) {
                const reward = getRandomReward();
                totalReward += reward;
                wordCount -= WORD_THRESHOLD;
            }

            if (totalReward > 0) {
                balance += totalReward;
                db.run(
                    'INSERT OR REPLACE INTO users (userId, balance, wordCount) VALUES (?, ?, ?)',
                    [userId, balance, wordCount],
                    (err) => {
                        if (err) console.error(err);
                        resolve();
                    }
                );
            } else {
                db.run('INSERT OR REPLACE INTO users (userId, wordCount, balance) VALUES (?, ?, ?)',
                    [userId, wordCount, balance],
                    (err) => {
                        if (err) console.error(err);
                        resolve();
                    });
            }
        });
    });
}

module.exports = { processMessage };
