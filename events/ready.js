const { REST, Routes } = require('discord.js');
const config = require('../config.js');
const commandHandler = require('../handlers/commandHandler');
const rotationSystem = require('../utils/rotationSystem');
const AttachmentCounter = require('../utils/attachmentCounter');
const ReportGenerator = require('../utils/reportGenerator');
const Scheduler = require('../utils/scheduler');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`✅ Bot logged in as ${client.user.tag}`);

    // Register slash commands globally
    try {
      const rest = new REST({ version: '10' }).setToken(config.botToken);
      const commands = commandHandler.getCommands();
      console.log(`📋 Commands to register:`, commands.map(cmd => cmd.name));
      if (commands.length) {
        const data = await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`✅ Successfully registered ${data.length} commands`);
      }
    } catch (error) {
      console.error('❌ Could not register commands:', error);
    }

    // Start rotation system
    try {
      rotationSystem.scheduleNextRotation();
      rotationSystem.startRotationCycle(client);
      console.log('🔄 Channel rotation system activated');
    } catch (error) {
      console.error('❌ Error starting rotation system:', error);
    }

    // Start attachment counter system
    try {
      const attachmentCounter = new AttachmentCounter(client);
      const reportGenerator = new ReportGenerator(client);
      const scheduler = new Scheduler(client, attachmentCounter, reportGenerator);
      client.scheduler = scheduler;
      scheduler.scheduleWeeklyReport();
      console.log('📊 Attachment counter system activated');
    } catch (error) {
      console.error('❌ Error starting attachment counter system:', error);
    }

    console.log('🤖 Bot is fully operational!');
  },
};
