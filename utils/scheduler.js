const cron = require('node-cron');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

class Scheduler {
  constructor(client, attachmentCounter, reportGenerator, statpScanner, statpReportGenerator, config) {
    this.client = client;
    this.attachmentCounter = attachmentCounter;
    this.reportGenerator = reportGenerator;
    this.statpScanner = statpScanner;
    this.statpReportGenerator = statpReportGenerator;
    this.config = config;

    // Locks to prevent overlapping runs
    this.isMonthlyRunning = false;
    this.isStatpRunning = false;
  }

  // ─── Schedule both monthly reports ──────────────────────────────────────────

  scheduleReports() {
    const timezone = this.config.attachmentCounter.timezone; // Asia/Riyadh

    // Regular monthly report — 1:00 AM Riyadh on the 1st of every month
    const monthlySchedule = this.config.attachmentCounter.monthlySchedule; // "0 1 1 * *"
    console.log(`⏰ Scheduling regular monthly report: "${monthlySchedule}" (1 AM Riyadh, 1st of month)`);

    cron.schedule(monthlySchedule, async () => {
      if (this.isMonthlyRunning) {
        console.log('⚠️ Regular monthly report already in progress, skipping...');
        return;
      }
      this.isMonthlyRunning = true;
      console.log('🔄 Starting scheduled regular monthly report...');
      try {
        await this.generateAndSendReport('monthly');
        console.log('✅ Scheduled regular monthly report completed');
      } catch (error) {
        console.error('❌ Error in scheduled regular monthly report:', error);
      } finally {
        this.isMonthlyRunning = false;
      }
    }, { scheduled: true, timezone });

    // Statp monthly report — same schedule: 1:00 AM Riyadh on the 1st
    const statpSchedule = this.config.statp.monthlySchedule; // "0 1 1 * *"
    console.log(`⏰ Scheduling statp monthly report:   "${statpSchedule}" (1 AM Riyadh, 1st of month)`);

    cron.schedule(statpSchedule, async () => {
      if (this.isStatpRunning) {
        console.log('⚠️ Statp monthly report already in progress, skipping...');
        return;
      }
      this.isStatpRunning = true;
      console.log('🔄 Starting scheduled statp monthly report...');
      try {
        await this.generateAndSendStatpReport();
        console.log('✅ Scheduled statp monthly report completed');
      } catch (error) {
        console.error('❌ Error in scheduled statp monthly report:', error);
      } finally {
        this.isStatpRunning = false;
      }
    }, { scheduled: true, timezone });
  }

  // ─── Regular monthly report (all tracked categories) ────────────────────────

  async generateAndSendReport(reportType = 'monthly') {
    const reportChannelId = this.config.attachmentCounter.reportChannel;

    const reportChannel = this.client.channels.cache.get(reportChannelId);
    if (!reportChannel) {
      console.log(`❌ Report channel not found: ${reportChannelId}`);
      return;
    }

    const canSend = reportChannel.permissionsFor(this.client.user)?.has('SendMessages');
    if (!canSend) {
      console.log(`❌ Bot cannot send messages to report channel`);
      return;
    }

    console.log(`🔍 Scanning for ${reportType} media...`);

    // Reset channel cache so a fresh scan picks up any new channels
    this.attachmentCounter.allChannelsCache = [];

    const userStats = await this.attachmentCounter.scanChannels(this.config, reportType);
    console.log(`📊 Scan complete — ${userStats.size} users found`);

    if (userStats.size === 0) {
      await reportChannel.send(
        `📊 **MONTHLY MEDIA REPORT**\n\nNo media found from tracked roles this month. 📭`
      );
      return;
    }

    const totalMedia = this.reportGenerator.calculateTotalMedia(userStats);
    const topUsers = this.attachmentCounter.getTopUsers(userStats, 10);
    const channelBreakdown = this.attachmentCounter.getChannelBreakdown(
      userStats,
      this.attachmentCounter.getAllChannelsToScan(this.config)
    );

    const mainEmbed = this.reportGenerator.generateMainReport(
      topUsers, channelBreakdown, totalMedia, reportType, userStats
    );

    const allMentions = Array.from(userStats.values())
      .map(u => u.userMention)
      .join(' ');

    await reportChannel.send({
      content: `📊 **MONTHLY MEDIA REPORT**\n\n**All Contributors:** ${allMentions}\n**Total Media:** ${totalMedia} items from ${userStats.size} users`,
      embeds: [mainEmbed],
    });

    // Individual user embeds
    console.log(`👤 Sending individual user reports...`);
    let sent = 0;
    for (const [userId, userData] of userStats) {
      if (userData.total > 0) {
        try {
          const userEmbed = this.reportGenerator.generateUserEmbed(
            userId, userData, this.client, reportType
          );
          await reportChannel.send({
            content: `**User Report:** <@${userId}>`,
            embeds: [userEmbed],
          });
          sent++;
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (err) {
          console.error(`❌ Error sending user report for ${userId}:`, err.message);
        }
      }
    }
    console.log(`✅ Monthly report complete — sent ${sent} user reports`);
  }

  // ─── Statp monthly report (targeted channels + role) ────────────────────────

  async generateAndSendStatpReport() {
    const reportChannelId = this.config.statp.reportChannel;

    const reportChannel = this.client.channels.cache.get(reportChannelId);
    if (!reportChannel) {
      console.log(`❌ [Statp] Report channel not found: ${reportChannelId}`);
      return;
    }

    const canSend = reportChannel.permissionsFor(this.client.user)?.has('SendMessages');
    if (!canSend) {
      console.log(`❌ [Statp] Bot cannot send messages to statp report channel`);
      return;
    }

    // Reset channel cache for a fresh scan
    this.statpScanner.statpChannelsCache = [];

    const userStats = await this.statpScanner.scanStatp(this.config);

    const now = new Date();
    const monthLabel = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;

    if (userStats.size === 0) {
      await reportChannel.send(
        `📊 **MONTHLY STATP REPORT — ${monthLabel}**\n\nNo media found from tracked role this month. 📭`
      );
      return;
    }

    // Header
    await reportChannel.send(
      `📊 **MONTHLY STATP REPORT — ${monthLabel}**\n` +
      `**${userStats.size} member${userStats.size !== 1 ? 's' : ''} reported**`
    );

    // One embed per member, sorted highest → lowest, each with their mention
    const sorted = Array.from(userStats.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .filter(([, data]) => data.total > 0);

    let sent = 0;
    for (const [userId, userData] of sorted) {
      try {
        const embed = this.statpReportGenerator.generateMemberEmbed(userId, userData, now);
        await reportChannel.send({
          content: `<@${userId}>`,
          embeds: [embed],
        });
        sent++;
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error(`❌ [Statp] Error sending embed for ${userId}:`, err.message);
      }
    }

    console.log(`✅ [Statp] Report complete — sent ${sent} member embeds`);
  }

  // ─── Manual triggers (called by slash commands) ──────────────────────────────

  async generateManualMonthlyReport(interaction = null) {
    if (this.isMonthlyRunning) {
      if (interaction) await interaction.editReply('⚠️ Monthly report is already running!');
      return;
    }
    this.isMonthlyRunning = true;
    try {
      if (interaction) await interaction.editReply('🔄 Generating monthly report… this may take a few minutes.');
      await this.generateAndSendReport('monthly');
      if (interaction) await interaction.editReply('✅ Monthly report done! Check the reports channel.');
    } catch (err) {
      console.error('❌ Manual monthly report error:', err);
      if (interaction) await interaction.editReply('❌ Error generating monthly report. Check console.');
    } finally {
      this.isMonthlyRunning = false;
    }
  }

  async generateManualStatpReport(interaction = null) {
    if (this.isStatpRunning) {
      if (interaction) await interaction.editReply('⚠️ Statp report is already running!');
      return;
    }
    this.isStatpRunning = true;
    try {
      if (interaction) await interaction.editReply('🔄 Generating statp report… this may take a few minutes.');
      await this.generateAndSendStatpReport();
      if (interaction) await interaction.editReply('✅ Statp report done! Check the report channel.');
    } catch (err) {
      console.error('❌ Manual statp report error:', err);
      if (interaction) await interaction.editReply('❌ Error generating statp report. Check console.');
    } finally {
      this.isStatpRunning = false;
    }
  }
}

module.exports = Scheduler;
