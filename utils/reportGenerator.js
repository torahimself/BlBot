const { EmbedBuilder } = require('discord.js');

class ReportGenerator {
  constructor(client) {
    this.client = client;
  }

  // Generate main report embed with default parameters
  generateMainReport(topUsers, channelBreakdown, totalMedia, reportType, userStats) {
    // Set defaults if not provided
    if (reportType === undefined) reportType = 'weekly';
    if (userStats === undefined) userStats = null;
    
    const isMonthly = reportType === 'monthly';
    const title = isMonthly ? '📅 MONTHLY MEDIA REPORT' : '📊 WEEKLY MEDIA REPORT';
    const color = isMonthly ? 0x9B59B6 : 0x00AE86;
    const period = isMonthly ? 'Last 30 Days' : 'Last 7 Days';
    const nextReport = isMonthly ? '1st of next month\n1:00 AM Riyadh Time' : 'Friday 1:00 AM\nRiyadh Time';
    
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .setTimestamp()
      .setFooter({ 
        text: `${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Media Counter • Report generated` 
      });

    // Top Contributors field with mentions
    if (topUsers && topUsers.length > 0) {
      const topUsersText = topUsers.map((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        return `${medal} <@${user.userId}> - **${user.total}** media items`;
      }).join('\n\n');
      
      embed.addFields({
        name: '🏆 TOP CONTRIBUTORS',
        value: topUsersText || 'No media found this period',
        inline: false
      });
    }

    // Channel Breakdown field (show top 8 channels only)
    if (channelBreakdown && channelBreakdown.size > 0) {
      const sortedChannels = Array.from(channelBreakdown.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 8);

      const channelText = sortedChannels
        .map(([channelId, data]) => 
          `• ${data.name} - **${data.total}** items`
        ).join('\n\n');

      if (sortedChannels.length > 0) {
        embed.addFields({
          name: `📁 TOP CHANNELS`,
          value: channelText,
          inline: false
        });
      }
    }

    // User Participation Summary
    if (userStats && userStats.size > 0) {
      const userCount = userStats.size;
      const activeUsers = Array.from(userStats.values()).filter(u => u.total > 0).length;
      
      embed.addFields({
        name: '👥 USER PARTICIPATION',
        value: `**Total Tracked Users:** ${userCount}\n**Active Contributors:** ${activeUsers}\n**Participation Rate:** ${Math.round((activeUsers / userCount) * 100)}%`,
        inline: true
      });
    }

    // Media Summary
    const activeChannels = channelBreakdown ? 
      Array.from(channelBreakdown.values()).filter(ch => ch.total > 0).length : 0;
    
    const avgPerUser = userStats && userStats.size > 0 ? 
      Math.round(totalMedia / userStats.size) : 0;
    
    embed.addFields(
      {
        name: '📈 MEDIA SUMMARY',
        value: `**Total Media:** ${totalMedia}\n**Avg per User:** ${avgPerUser}\n**Active Channels:** ${activeChannels}`,
        inline: true
      },
      {
        name: '⏰ NEXT REPORT',
        value: nextReport,
        inline: true
      }
    );

    return embed;
  }

  // Generate individual user embed
  generateUserEmbed(userId, userData, client, reportType) {
    // Set default if not provided
    if (reportType === undefined) reportType = 'weekly';
    
    const isMonthly = reportType === 'monthly';
    const title = isMonthly ? '👤 MONTHLY USER REPORT' : '👤 USER MEDIA REPORT';
    const color = isMonthly ? 0x8E44AD : 0x0099FF;
    
    const user = client.users.cache.get(userId);
    const username = user ? user.tag : userData.username;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .setTimestamp()
      .setFooter({ 
        text: `${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Individual Report • Click user mention to profile` 
      });

    // User info with mention
    embed.addFields({
      name: '👤 USER INFORMATION',
      value: `**User:** <@${userId}>\n**Username:** ${username}\n**User ID:** ${userId}`,
      inline: false
    });

    // Total media
    embed.addFields({
      name: '📊 TOTAL MEDIA',
      value: `**${userData.total}** media items this ${reportType}\n*(attachments + embed links)*`,
      inline: false
    });

    // Channels breakdown (with forum thread grouping)
    if (userData.channels && userData.channels.size > 0) {
      const channelGroups = new Map();
      
      // Group by parent channel (especially for forums)
      for (const [channelKey, count] of userData.channels) {
        if (channelKey.startsWith('forum-')) {
          // Forum thread: forum-{forumId}-{threadId}
          const parts = channelKey.split('-');
          const forumId = parts[1];
          const forum = client.channels.cache.get(forumId);
          const forumName = forum ? forum.name : `Forum-${forumId}`;
          
          if (!channelGroups.has(forumName)) {
            channelGroups.set(forumName, { total: 0, isForum: true });
          }
          channelGroups.get(forumName).total += count;
        } else {
          // Regular channel
          const channel = client.channels.cache.get(channelKey);
          const channelName = channel ? `#${channel.name}` : `Channel-${channelKey}`;
          
          if (!channelGroups.has(channelName)) {
            channelGroups.set(channelName, { total: 0, isForum: false });
          }
          channelGroups.get(channelName).total += count;
        }
      }

      let channelText = Array.from(channelGroups.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 6) // Limit to top 6 locations
        .map(([name, data]) => {
          const prefix = data.isForum ? '🏛️ ' : '• ';
          return `${prefix}${name}: **${data.total}** items`;
        })
        .join('\n\n');

      if (channelGroups.size > 6) {
        channelText += `\n\n• ... and ${channelGroups.size - 6} more locations`;
      }

      embed.addFields({
        name: `📍 ACTIVITY LOCATIONS`,
        value: channelText || 'No channel data',
        inline: false
      });
    }

    // Activity period
    const now = new Date();
    let startDate;
    
    if (isMonthly) {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }
    
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    
    const periodText = isMonthly 
      ? `${monthNames[startDate.getMonth()]} ${startDate.getFullYear()}`
      : `<t:${Math.floor(startDate.getTime() / 1000)}:D> to <t:${Math.floor(now.getTime() / 1000)}:D>`;
    
    embed.addFields({
      name: '📅 REPORT PERIOD',
      value: periodText,
      inline: true
    });

    return embed;
  }

  // Calculate total media from all users
  calculateTotalMedia(userStats) {
    if (!userStats) return 0;
    
    let total = 0;
    for (const userData of userStats.values()) {
      total += userData.total;
    }
    return total;
  }
}

module.exports = ReportGenerator;
