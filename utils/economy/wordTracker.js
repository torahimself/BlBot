const db = require('./database.js');

const WORD_THRESHOLD = 100;
const MIN_REWARD = 67;
const MAX_REWARD = 444;

function getRandomReward() {
    return Math.floor(Math.random() * (MAX_REWARD - MIN_REWARD + 1)) + MIN_REWARD;
}

// One message at a time PER USER. Without this, two quick messages from the
// same person both read the same word count, and the later write could also
// overwrite coins won elsewhere (a game payout, /work) with a stale balance.
const queues = new Map();

function runExclusive(key, fn) {
    const prev = queues.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    queues.set(key, next);
    next
        .catch(() => {})
        .then(() => { if (queues.get(key) === next) queues.delete(key); });
    return next;
}

function dbGet(sql, params) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

function dbRun(sql, params) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
}

async function processMessage(message) {
    if (message.author.bot) return;
    if (message.content.startsWith('/')) return;

    const words = message.content.trim().split(/\s+/).length;
    if (words === 0) return;

    const userId = message.author.id;

    return runExclusive(userId, async () => {
        try {
            const row = await dbGet('SELECT wordCount FROM users WHERE userId = ?', [userId]);

            let wordCount = (row ? row.wordCount : 0) + words;
            let totalReward = 0;
            while (wordCount >= WORD_THRESHOLD) {
                totalReward += getRandomReward();
                wordCount -= WORD_THRESHOLD;
            }

            // The coin reward is ADDED to whatever the balance is right now
            // (never overwritten with a value read earlier), and the other
            // columns (lastWorkTime, ...) are left untouched.
            await dbRun(
                `INSERT INTO users (userId, balance, wordCount)
                 VALUES (?, ?, ?)
                 ON CONFLICT(userId) DO UPDATE SET
                 wordCount = excluded.wordCount,
                 balance = balance + excluded.balance`,
                [userId, totalReward, wordCount]
            );
        } catch (err) {
            console.error('[WordTracker]', err);
        }
    });
}

module.exports = { processMessage };
