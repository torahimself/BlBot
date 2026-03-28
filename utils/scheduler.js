const cron = require('node-cron');

class Scheduler {
  constructor(client, attachmentCounter, reportGenerator, config) {
    this.client = client;
    this.attachmentCounter = attachmentCounter;
    this.reportGenerator = reportGenerator;
    this.config = config; // store the full config
    this.isRunning = false;
    this.isMonthlyRunning = false;
  }

  // Helper to check if tomorrow is the first day of month
  isLastDayOfMonth() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.getDate() === 1;
  }

  // Schedule both weekly and monthly reports
  scheduleWeeklyReport() {
    const weeklySchedule = this.config.attachmentCounter.weeklySchedule;
    const monthlySchedule = this.config.attachmentCounter.monthlySchedule;
    const timezone = this.config.attachmentCounter.timezone;

    console.log(`⏰ Scheduling weekly reports: ${weeklySchedule} (Friday 1:00 AM Riyadh Time)`);
    console.log(`⏰ Scheduling monthly reports: ${monthlySchedule} (1st of month 1:00 AM Riyadh Time)`);
    
    // Schedule weekly report
    const weeklyTask = cron.schedule(weeklySchedule, async () => {
      if (this.isRunning) {
        console.log('⚠️  Weekly report generation already in progress, skipping...');
        return;
      }

      this.isRunning = true;
      console.log('🔄 Starting scheduled weekly report generation...');
      
      try {
        await this.generateAndSendReport('weekly');
        console.log('✅ Scheduled weekly report completed successfully');
      } catch (error) {
        console.error('❌ Error in scheduled weekly report generation:', error);
      } finally {
        this.isRunning = false;
      }
    }, {
      scheduled: true,
      timezone: timezone
    });

    // Schedule monthly report (checks on 28th-31st, runs on 1st at 1:00 AM Riyadh)
    const monthlyTask = cron.schedule(monthlySchedule, async () => {
      // Only run if tomorrow is the first day of month
      if (!this.isLastDayOfMonth()) {
        console.log('⏰ Not the last day of month, skipping monthly report...');
        return;
      }

      if (this.isMonthlyRunning) {
        console.log('⚠️  Monthly report generation already in progress, skipping...');
        return;
      }

      this.isMonthlyRunning = true;
      console.log('🔄 Starting scheduled monthly report generation...');
      
      try {
        await this.generateAndSendReport('monthly');
        console.log('✅ Scheduled monthly report completed successfully');
      } catch (error) {
        console.error('❌ Error in scheduled monthly report generation:', error);
      } finally {
        this.isMonthlyRunning = false;
      }
    }, {
      scheduled: true,
      timezone: timezone
    });

    return { weeklyTask, monthlyTask };
  }

  // Generate and send report (weekly or monthly)
  async generateAndSendReport(reportType = 'weekly') {
    const isMonthly = reportType === 'monthly';
    const reportChannelId = isMonthly ? this.config.attachmentCounter.monthlyReportChannel : this.config.attachmentCounter.reportChannel;
    
    try {
      const reportChannel = this.client.channels.cache.get(reportChannelId);
      if (!reportChannel) {
        console.log(`❌ ${reportType} report channel not found: ${reportChannelId}`);
        return;
      }

      // Check if bot can send messages
      const canSend = reportChannel.permissionsFor(this.client.user)?.has('SendMessages');
      if (!canSend) {
        console.log(`❌ Bot cannot send messages to ${reportType} report channel`);
        return;
      }

      console.log(`🔍 Scanning for ${reportType} media...`);
      
      const userStats = await this.attachmentCounter.scanChannels(this.config, reportType);
      
      console.log(`📊 ${reportType.toUpperCase()} scan completed. Users found: ${userStats.size}`);
      
      if (userStats.size === 0) {
        console.log(`ℹ️  No media found from tracked roles this ${reportType}`);
        try {
          await reportChannel.send(`📊 **${reportType.toUpperCase()} MEDIA REPORT**\n\nNo media found from tracked roles this ${reportType}. 📭`);
        } catch (error) {
          console.error(`❌ Cannot send to ${reportType} report channel:`, error.message);
        }
        return;
      }

      const topUsers = this.attachmentCounter.getTopUsers(userStats, 15); // Show more users
      const channelBreakdown = this.attachmentCounter.getChannelBreakdown(userStats, this.attachmentCounter.getAllChannelsToScan(this.config));
      const totalMedia = this.reportGenerator.calculateTotalMedia(userStats);

      console.log(`📈 Generating ${reportType} report: ${totalMedia} total media, ${topUsers.length} top users`);

      // Send main report with ALL user mentions
      console.log(`📊 Generating ${reportType} main report...`);
      const mainEmbed = this.reportGenerator.generateMainReport(topUsers, channelBreakdown, totalMedia, reportType, userStats);
      try {
        // Create mention list for all users
        const allUserMentions = Array.from(userStats.values())
          .map(user => user.userMention)
          .join(' ');
          
        await reportChannel.send({ 
          content: `📊 **${reportType.toUpperCase()} MEDIA REPORT**\n\n**All Contributors:** ${allUserMentions}\n\n**Total Media:** ${totalMedia} items from ${userStats.size} users`, 
          embeds: [mainEmbed] 
        });
      } catch (error) {
        console.error(`❌ Cannot send ${reportType} main report:`, error.message);
        return;
      }

      // Send individual user reports with detailed breakdown
      console.log(`👤 Generating ${userStats.size} individual user reports for ${reportType}...`);
      let userReportCount = 0;
      for (const [userId, userData] of userStats) {
        if (userData.total > 0) {
          try {
            const userEmbed = this.reportGenerator.generateUserEmbed(userId, userData, this.client, reportType);
            await reportChannel.send({ 
              content: `**User Report:** <@${userId}>`, 
              embeds: [userEmbed] 
            });
            userReportCount++;
            
            // Delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 300));
          } catch (error) {
            console.error(`❌ Error sending ${reportType} user report for ${userId}:`, error.message);
          }
        }
      }

      console.log(`✅ ${reportType.toUpperCase()} report generation complete! Sent ${userReportCount} user reports`);

    } catch (error) {
      console.error(`❌ Error generating ${reportType} report:`, error);
      throw error;
    }
  }

  // Manual weekly report trigger
  async generateManualReport(interaction = null) {
    if (this.isRunning) {
      if (interaction) {
        await interaction.editReply('⚠️ Weekly report generation is already in progress!');
      }
      return;
    }

    this.isRunning = true;
    
    try {
      if (interaction) {
        await interaction.editReply('🔄 Generating manual weekly report... This may take a few minutes.');
      }

      console.log('🔄 Starting manual weekly report generation...');
      await this.generateAndSendReport('weekly');

      if (interaction) {
        await interaction.editReply('✅ Weekly report generated successfully! Check the reports channel.');
      }

    } catch (error) {
      console.error('❌ Error in manual weekly report generation:', error);
      
      if (interaction) {
        await interaction.editReply('❌ Error generating weekly report! Check console for details.');
      }
    } finally {
      this.isRunning = false;
    }
  }

  // Manual monthly report trigger
  async generateManualMonthlyReport(interaction = null) {
    if (this.isMonthlyRunning) {
      if (interaction) {
        await interaction.editReply('⚠️ Monthly report generation is already in progress!');
      }
      return;
    }

    this.isMonthlyRunning = true;
    
    try {
      if (interaction) {
        await interaction.editReply('🔄 Generating manual monthly report... This may take a few minutes.');
      }

      console.log('🔄 Starting manual monthly report generation...');
      await this.generateAndSendReport('monthly');

      if (interaction) {
        await interaction.editReply('✅ Monthly report generated successfully! Check the reports channel.');
      }

    } catch (error) {
      console.error('❌ Error in manual monthly report generation:', error);
      
      if (interaction) {
        await interaction.editReply('❌ Error generating monthly report! Check console for details.');
      }
    } finally {
      this.isMonthlyRunning = false;
    }
  }
}

module.exports = Scheduler;
