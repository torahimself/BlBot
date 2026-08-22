const { REST, Routes } = require('discord.js');
const config = require('../config.js');
const commandHandler = require('../handlers/commandHandler');
const rotationSystem = require('../utils/rotationSystem');
const AttachmentCounter = require('../utils/attachmentCounter');
const ReportGenerator = require('../utils/reportGenerator');
const StatpScanner = require('../utils/statpScanner');
const StatpReportGenerator = require('../utils/statpReportGenerator');
const Scheduler = require('../utils/scheduler');
const { checkExpiredRoles } = require('../utils/economy/shopManager.js');
const { seedVoiceUsers } = require('../utils/economy/voiceTracker.js');
const { startTracker } = require('../utils/twitterTracker.js');
const { startPeriodicCheck: startJailCheck } = require('../utils/jail/jailManager.js');
const { startExpirationCheck: startWarnCheck } = require('../utils/warn/warnManager.js');

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

    // Start attachment counter + statp systems
    try {
      const attachmentCounter   = new AttachmentCounter(client);
      const reportGenerator     = new ReportGenerator(client);
      const statpScanner        = new StatpScanner(client);
      const statpReportGenerator = new StatpReportGenerator(client);

      const scheduler = new Scheduler(
        client,
        attachmentCounter,
        reportGenerator,
        statpScanner,
        statpReportGenerator,
        config
      );

      client.scheduler = scheduler;
      scheduler.scheduleReports(); // schedules the combined statm → statp monthly run
      console.log('📊 Attachment counter & statp systems activated (statm → statp, sequential, 1st of each month, 1 AM Riyadh)');
    } catch (error) {
      console.error('❌ Error starting attachment counter system:', error);
    }

    // Start economy system – role expiration checker
    try {
      checkExpiredRoles(client, '1380869949463199856');
      setInterval(() => {
        checkExpiredRoles(client, '1380869949463199856');
      }, 6 * 60 * 60 * 1000);
      console.log('💰 Economy system activated – role expiration checker running');
    } catch (error) {
      console.error('❌ Error starting economy expiration checker:', error);
    }

    // Start jail system periodic check (auto-unjail expired sentences,
    // re-enforce jail state for anyone whose roles drifted)
    try {
      startJailCheck(client);
    } catch (error) {
      console.error('❌ Error starting jail system periodic check:', error);
    }

    // Start warning system periodic check (logs individual warning expirations)
    try {
      startWarnCheck(client);
    } catch (error) {
      console.error('❌ Error starting warning system periodic check:', error);
    }

    // Seed voice tracker with users already in voice channels
    try {
      seedVoiceUsers(client);
      console.log('🎤 Voice tracker activated');
    } catch (error) {
      console.error('❌ Error starting voice tracker:', error);
    }

    // Twitter / X post tracker — @Emmaoinkk → channel 1437107048348123136
    try {
      startTracker(client);
    } catch (error) {
      console.error('❌ Error starting Twitter tracker:', error);
    }

    console.log('🤖 Bot is fully operational!');
  },
};
