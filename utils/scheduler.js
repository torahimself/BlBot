const cron = require('node-cron');
const {
  getPreviousMonthRange,
  getRolling30DayRange,
  formatRiyadhNow,
  msUntilNextMonthlyRun,
} = require('./dateHelpers.js');

class Scheduler {
  constructor(client, attachmentCounter, reportGenerator, statpScanner, statpReportGenerator, config) {
    this.client = client;
    this.attachmentCounter = attachmentCounter;
    this.reportGenerator = reportGenerator;
    this.statpScanner = statpScanner;
    this.statpReportGenerator = statpReportGenerator;
    this.config = config;

    // Single shared lock per report type — checked by BOTH the automatic
    // scheduled run AND manual /statsm or /statp commands, so they can
    // never run concurrently against each other. Previously these were
    // three separate flags that didn't check each other at all, meaning
    // an automatic run and a manual command could fire at the same time
    // and both scan overlapping channels simultaneously.
    this.isMonthlyReportRunning = false;
    this.isStatpReportRunning = false;
  }

  // ─── Schedule both monthly reports (combined, sequential) ───────────────────

  scheduleReports() {
    const timezone = this.config.attachmentCounter.timezone; // Asia/Riyadh
    const schedule = this.config.attachmentCounter.monthlySchedule; // "0 1 1 * *"

    console.log(`⏰ Scheduling automatic monthly reports (statm → statp): "${schedule}" (1 AM Riyadh, 1st of month)`);
    console.log(`🕐 Current time: ${formatRiyadhNow()}`);
    const { next, msUntil } = msUntilNextMonthlyRun();
    const hoursUntil = (msUntil / (60 * 60 * 1000)).toFixed(1);
    console.log(`⏳ Next automatic run: ${next.toISOString()} (in ~${hoursUntil}h). This holds regardless of bot restarts — cron only fires at the scheduled time.`);

    // Single cron job handles BOTH reports, sequentially, so they never run
    // at the same moment and never conflict with each other.
    cron.schedule(schedule, async () => {
      if (this.isMonthlyReportRunning || this.isStatpReportRunning) {
        console.log('⚠️ Automatic monthly report run skipped — a monthly/statp report (automatic or manual) is already in progress.');
        return;
      }

      // Both reports cover the full PREVIOUS calendar month (Riyadh time),
      // computed once so statm and statp use the exact same window.
      const dateRange = getPreviousMonthRange();
      console.log(`🔄 Starting automatic monthly reports for period: ${dateRange.label}`);

      // Hold BOTH locks for the entire run (statm + statp), not just their
      // individual phases — this closes the race window where a manual
      // /statsm or /statp could otherwise sneak in between the two.
      this.isMonthlyReportRunning = true;
      this.isStatpReportRunning = true;

      try {
        console.log('  → [1/2] Running statm (regular monthly report)...');
        await this.generateAndSendReport('monthly', dateRange, dateRange.label);
        console.log('  ✅ [1/2] statm complete.');
      } catch (error) {
        console.error('  ❌ [1/2] Error in automatic statm report:', error);
      }

      try {
        console.log('  → [2/2] Running statp...');
        await this.generateAndSendStatpReport(dateRange, dateRange.label);
        console.log('  ✅ [2/2] statp complete.');
      } catch (error) {
        console.error('  ❌ [2/2] Error in automatic statp report:', error);
      } finally {
        this.isMonthlyReportRunning = false;
        this.isStatpReportRunning = false;
      }

      console.log('✅ Automatic monthly report run finished (statm + statp).');
    }, { scheduled: true, timezone });
  }

  // ─── Regular monthly report (all tracked categories) ────────────────────────
  // dateRange (optional): { since, until, label } — when provided, overrides
  // the default "current month to now" window. periodLabel overrides the
  // display label shown in the per-user embed's REPORT PERIOD field.

  async generateAndSendReport(reportType = 'monthly', dateRange = null, periodLabel = null) {
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

    const userStats = await this.attachmentCounter.scanChannels(this.config, reportType, dateRange);
    console.log(`📊 Scan complete — ${userStats.size} users found`);

    const labelSuffix = periodLabel ? ` — ${periodLabel}` : '';

    if (userStats.size === 0) {
      await reportChannel.send(
        `📊 **MONTHLY MEDIA REPORT${labelSuffix}**\n\nNo media found from tracked roles this period. 📭`
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
      content: `📊 **MONTHLY MEDIA REPORT${labelSuffix}**\n\n**All Contributors:** ${allMentions}\n**Total Media:** ${totalMedia} items from ${userStats.size} users`,
      embeds: [mainEmbed],
    });

    // Individual user embeds
    console.log(`👤 Sending individual user reports...`);
    let sent = 0;
    for (const [userId, userData] of userStats) {
      if (userData.total > 0) {
        try {
          const userEmbed = this.reportGenerator.generateUserEmbed(
            userId, userData, this.client, reportType, periodLabel
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

  // ─── Statp report (targeted channels + role) ─────────────────────────────────
  // dateRange (optional): { since, until, label } — overrides default
  // "current month to now" window. periodLabel overrides the header text.

  async generateAndSendStatpReport(dateRange = null, periodLabel = null) {
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

    const userStats = await this.statpScanner.scanStatp(this.config, dateRange);

    const label = periodLabel || (dateRange && dateRange.label) || 'This Month';

    if (userStats.size === 0) {
      await reportChannel.send(
        `📊 **STATP REPORT — ${label}**\n\nNo media found from tracked role this period. 📭`
      );
      return;
    }

    // Header
    await reportChannel.send(
      `📊 **STATP REPORT — ${label}**\n` +
      `**${userStats.size} member${userStats.size !== 1 ? 's' : ''} reported**`
    );

    // One embed per member, sorted highest → lowest, each with their mention
    const sorted = Array.from(userStats.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .filter(([, data]) => data.total > 0);

    let sent = 0;
    for (const [userId, userData] of sorted) {
      try {
        const embed = this.statpReportGenerator.generateMemberEmbed(userId, userData, label);
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
  // Per spec: manual /statsm and /statp count the rolling 30 days ending at
  // the moment the command was run — NOT the calendar month.

  async generateManualMonthlyReport(interaction = null) {
    if (this.isMonthlyReportRunning || this.isStatpReportRunning) {
      if (interaction) await interaction.editReply('⚠️ A monthly/statp report (automatic or manual) is already running — try again once it finishes.');
      return;
    }
    this.isMonthlyReportRunning = true;
    try {
      if (interaction) await interaction.editReply('🔄 Generating monthly report (last 30 days)… this may take a few minutes.');
      const dateRange = getRolling30DayRange();
      await this.generateAndSendReport('monthly', dateRange, dateRange.label);
      if (interaction) await interaction.editReply('✅ Monthly report done! Check the reports channel.');
    } catch (err) {
      console.error('❌ Manual monthly report error:', err);
      if (interaction) await interaction.editReply('❌ Error generating monthly report. Check console.');
    } finally {
      this.isMonthlyReportRunning = false;
    }
  }

  async generateManualStatpReport(interaction = null) {
    if (this.isMonthlyReportRunning || this.isStatpReportRunning) {
      if (interaction) await interaction.editReply('⚠️ A monthly/statp report (automatic or manual) is already running — try again once it finishes.');
      return;
    }
    this.isStatpReportRunning = true;
    try {
      if (interaction) await interaction.editReply('🔄 Generating statp report (last 30 days)… this may take a few minutes.');
      const dateRange = getRolling30DayRange();
      await this.generateAndSendStatpReport(dateRange, dateRange.label);
      if (interaction) await interaction.editReply('✅ Statp report done! Check the report channel.');
    } catch (err) {
      console.error('❌ Manual statp report error:', err);
      if (interaction) await interaction.editReply('❌ Error generating statp report. Check console.');
    } finally {
      this.isStatpReportRunning = false;
    }
  }
}

module.exports = Scheduler;
