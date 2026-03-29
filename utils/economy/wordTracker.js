const db = require('./database.js');

const WORD_THRESHOLD = 100;
const MIN_REWARD = 67;
const MAX_REWARD = 444;

// Get random reward
function getRandomReward() {
  return Math.floor(Math.random() * (MAX_REWARD - MIN_REWARD + 1)) + MIN_REWARD;
}

// Process a message: count words, update balance
async function processMessage(message) {
  // Ignore bots, commands (messages starting with /), and system messages
  if (message.author.bot) return;
  if (message.content.startsWith('/')) return;

  const words = message.content.trim().split(/\s+/).length;
  if (words === 0) return;

  const userId = message.author.id;

  db.get('SELECT wordCount, balance FROM users WHERE userId = ?', [userId], (err, row) => {
    if (err) return console.error(err);
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
          if (!err && totalReward > 0) {
            // Optional: send silent DM? Not required per spec.
            // We'll just update silently.
          }
        }
      );
    } else {
      // Just update wordCount
      db.run('INSERT OR REPLACE INTO users (userId, wordCount, balance) VALUES (?, ?, ?)',
        [userId, wordCount, balance]);
    }
  });
}

module.exports = { processMessage };
