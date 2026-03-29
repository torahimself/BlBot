const { processMessage } = require('../utils/economy/wordTracker.js');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    // Ignore bot messages and commands
    if (message.author.bot) return;
    if (message.content.startsWith('/')) return;
    await processMessage(message);
  },
};
