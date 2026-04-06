const fs = require('fs');
const path = require('path');

// Ensure data directory exists for SQLite database
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('✅ Created data directory for database');
}
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config.js');

const app = express();
const PORT = process.env.PORT || 3000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Health check endpoints (optional, keep for hosting)
app.get('/', (req, res) => {
  res.json({ status: 'OK', bot: client.readyAt ? 'Connected' : 'Connecting' });
});
app.get('/ping', (req, res) => {
  res.json({ status: 'pong' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Health check server running on port ${PORT}`);
});

// Load handlers
const commandHandler = require('./handlers/commandHandler');
const eventHandler = require('./handlers/eventHandler');

commandHandler.loadCommands();
eventHandler.loadEvents(client);

client.login(config.botToken)
  .then(() => console.log('🔑 Discord login successful'))
  .catch(err => { console.error('❌ Login failed:', err); process.exit(1); });

// Error handling
client.on('error', console.error);
process.on('unhandledRejection', console.error);
process.on('uncaughtException', err => { console.error(err); process.exit(1); });
process.on('SIGTERM', () => { client.destroy(); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { client.destroy(); server.close(() => process.exit(0)); });

module.exports = { client, server };
