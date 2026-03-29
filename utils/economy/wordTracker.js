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
        db.get('SELECT wordCount, balance, lastWorkTime FROM users WHERE userId = ?', [userId], (err, row) => {
            if (err) {
                console.error(err);
                return resolve();
            }
            let wordCount = row ? row.wordCount : 0;
            let balance = row ? row.balance : 0;
            let lastWorkTime = row ? row.lastWorkTime : 0;
            let totalReward = 0;

            wordCount += words;
            while (wordCount >= WORD_THRESHOLD) {
                const reward = getRandomReward();
                totalReward += reward;
                wordCount -= WORD_THRESHOLD;
            }

            if (totalReward > 0) {
                balance += totalReward;
                // Update balance, wordCount, but preserve lastWorkTime
                db.run(
                    `INSERT INTO users (userId, balance, wordCount, lastWorkTime) 
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(userId) DO UPDATE SET 
                     balance = excluded.balance,
                     wordCount = excluded.wordCount,
                     lastWorkTime = COALESCE(lastWorkTime, excluded.lastWorkTime)`,
                    [userId, balance, wordCount, lastWorkTime],
                    (err) => {
                        if (err) console.error(err);
                        resolve();
                    }
                );
            } else {
                // Just update wordCount, preserve others
                db.run(
                    `INSERT INTO users (userId, wordCount, balance, lastWorkTime) 
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(userId) DO UPDATE SET 
                     wordCount = excluded.wordCount,
                     balance = COALESCE(balance, excluded.balance),
                     lastWorkTime = COALESCE(lastWorkTime, excluded.lastWorkTime)`,
                    [userId, wordCount, balance, lastWorkTime],
                    (err) => {
                        if (err) console.error(err);
                        resolve();
                    }
                );
            }
        });
    });
}

module.exports = { processMessage };
