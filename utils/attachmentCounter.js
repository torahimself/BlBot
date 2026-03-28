const { Collection } = require('discord.js');

class AttachmentCounter {
  constructor(client) {
    this.client = client;
    this.weeklyData = new Map();
    this.monthlyData = new Map();
    this.allChannelsCache = [];
  }

  // Get all channels including category expansion
  getAllChannelsToScan(config) {
    if (this.allChannelsCache.length > 0) {
      return this.allChannelsCache;
    }
    
    const allChannels = [...config.attachmentCounter.channels];
    
    // Add all channels from specified categories
    for (const categoryId of config.attachmentCounter.categories || []) {
      const category = this.client.channels.cache.get(categoryId);
      if (category && category.type === 4) {
        const categoryChannels = category.children.cache
          .filter(ch => ch.isTextBased() && !ch.isThread())
          .map(ch => ch.id);
        
        console.log(`📂 Adding ${categoryChannels.length} channels from category: ${category.name}`);
        allChannels.push(...categoryChannels);
      }
    }
    
    // Remove duplicates
    const uniqueChannels = [...new Set(allChannels)];
    this.allChannelsCache = uniqueChannels;
    
    console.log(`📊 Total channels to scan: ${uniqueChannels.length}`);
    console.log(`📁 From config: ${config.attachmentCounter.channels.length}`);
    console.log(`📂 From categories: ${uniqueChannels.length - config.attachmentCounter.channels.length}`);
    
    return uniqueChannels;
  }

  // Check if user has any of the tracked roles
  userHasTrackedRole(member, trackedRoles) {
    if (!member) return false;
    return member.roles.cache.some(role => trackedRoles.includes(role.id));
  }

  // Count both attachments and embeds
  countMessageMedia(message) {
    let count = 0;
    count += message.attachments.size;
    
    if (message.embeds.length > 0) {
      message.embeds.forEach(embed => {
        if (embed.image || embed.video || embed.thumbnail) {
          count += 1;
        }
      });
    }
    
    return count;
  }

  // Scan ALL messages in a channel from sinceDate
  async scanAllChannelMessages(channel, trackedRoles, sinceDate) {
    console.log(`🔍 Scanning ALL messages in ${channel.name} since ${sinceDate.toLocaleString()}`);
    
    const userStats = new Map();
    let totalMessages = 0;
    let totalMedia = 0;
    let lastMessageId = null;
    let hasMoreMessages = true;
    let batchCount = 0;

    try {
      while (hasMoreMessages) {
        batchCount++;
        const options = { limit: 100 };
        if (lastMessageId) options.before = lastMessageId;

        const messages = await channel.messages.fetch(options);
        console.log(`📦 Batch ${batchCount}: Found ${messages.size} messages in ${channel.name}`);

        if (messages.size === 0) {
          hasMoreMessages = false;
          break;
        }

        let batchOlderThanRange = false;

        for (const [messageId, message] of messages) {
          if (message.createdAt < sinceDate) {
            batchOlderThanRange = true;
            break;
          }

          if (message.author.bot) continue;
          
          let member = message.member;
          if (!member && message.guild) {
            try {
              member = await message.guild.members.fetch(message.author.id);
            } catch (error) {
              continue;
            }
          }

          if (!member) continue;
          
          const hasTrackedRole = this.userHasTrackedRole(member, trackedRoles);
          if (!hasTrackedRole) continue;

          const mediaItems = this.countMessageMedia(message);
          if (mediaItems > 0) {
            const userId = message.author.id;
            const username = message.author.tag;

            if (!userStats.has(userId)) {
              userStats.set(userId, {
                username: username,
                total: 0,
                channels: new Map(),
                roles: member.roles.cache.map(role => ({ id: role.id, name: role.name })),
                userMention: `<@${userId}>`
              });
            }

            const userData = userStats.get(userId);
            userData.total += mediaItems;
            userData.channels.set(channel.id, (userData.channels.get(channel.id) || 0) + mediaItems);
            totalMedia += mediaItems;
          }

          totalMessages++;
          lastMessageId = messageId;
        }

        if (batchOlderThanRange) {
          console.log(`⏰ Reached messages older than scan range in ${channel.name}`);
          hasMoreMessages = false;
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 500));
        if (totalMessages >= 2000) break;
      }
    } catch (error) {
      console.error(`❌ Error scanning channel ${channel.name}:`, error.message);
    }

    console.log(`✅ Scanned ${totalMessages} messages in ${channel.name}, found ${totalMedia} media items`);
    return userStats;
  }

  // Scan forum channels
  async scanForumChannel(forumChannel, trackedRoles, sinceDate) {
    console.log(`🏛️  Scanning forum: ${forumChannel.name}`);
    
    const userStats = new Map();
    let totalThreads = 0;
    let totalMedia = 0;

    try {
      const activeThreads = await forumChannel.threads.fetchActive();
      const archivedThreads = await forumChannel.threads.fetchArchived({ limit: 50 });
      
      const allThreads = new Collection();
      activeThreads.threads.forEach(thread => allThreads.set(thread.id, thread));
      archivedThreads.threads.forEach(thread => allThreads.set(thread.id, thread));

      console.log(`📂 Found ${allThreads.size} threads in forum ${forumChannel.name}`);

      for (const [threadId, thread] of allThreads) {
        if (thread.createdAt < sinceDate) continue;
        
        totalThreads++;
        console.log(`📖 Scanning thread: ${thread.name}`);
        const threadStats = await this.scanAllChannelMessages(thread, trackedRoles, sinceDate);
        
        for (const [userId, userData] of threadStats) {
          if (!userStats.has(userId)) {
            userStats.set(userId, {
              username: userData.username,
              total: 0,
              channels: new Map(),
              roles: userData.roles,
              userMention: `<@${userId}>`
            });
          }

          const overallData = userStats.get(userId);
          overallData.total += userData.total;
          totalMedia += userData.total;
          const forumThreadKey = `forum-${forumChannel.id}-${thread.id}`;
          overallData.channels.set(forumThreadKey, userData.total);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`❌ Error scanning forum ${forumChannel.name}:`, error.message);
    }

    console.log(`✅ Scanned ${totalThreads} threads in forum ${forumChannel.name}, found ${totalMedia} media items`);
    return userStats;
  }

  // Scan channel (forum or regular)
  async scanChannel(channel, trackedRoles, sinceDate) {
    if (channel.type === 15) {
      return await this.scanForumChannel(channel, trackedRoles, sinceDate);
    } else if (channel.isTextBased()) {
      return await this.scanAllChannelMessages(channel, trackedRoles, sinceDate);
    } else {
      return new Map();
    }
  }

  // Main scanning method – receives the full config object
  async scanChannels(config, reportType = 'weekly') {
    const trackedRoles = config.attachmentCounter.trackedRoles;
    console.log(`🔄 Starting ${reportType.toUpperCase()} attachment scan...`);
    
    const allChannels = this.getAllChannelsToScan(config);
    const allUserStats = new Map();
    
    let sinceDate;
    if (reportType === 'monthly') {
      const now = new Date();
      sinceDate = new Date(now.getFullYear(), now.getMonth(), 1);
      console.log(`📅 Monthly scan: From ${sinceDate.toLocaleDateString()} to now`);
    } else {
      sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      console.log(`📅 Weekly scan: Last 7 days from ${sinceDate.toLocaleDateString()}`);
    }
    
    let totalChannelsScanned = 0;

    for (const channelId of allChannels) {
      totalChannelsScanned++;
      console.log(`\n📊 Progress: ${totalChannelsScanned}/${allChannels.length} channels`);
      
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        console.log(`❌ Channel not found: ${channelId}`);
        continue;
      }

      console.log(`🔍 Scanning channel ${totalChannelsScanned}/${allChannels.length}: ${channel.name}`);
      const channelStats = await this.scanChannel(channel, trackedRoles, sinceDate);

      for (const [userId, userData] of channelStats) {
        if (!allUserStats.has(userId)) {
          allUserStats.set(userId, {
            username: userData.username,
            total: 0,
            channels: new Map(),
            roles: userData.roles,
            userMention: `<@${userId}>`
          });
        }

        const overallData = allUserStats.get(userId);
        overallData.total += userData.total;

        for (const [channelKey, count] of userData.channels) {
          overallData.channels.set(channelKey, (overallData.channels.get(channelKey) || 0) + count);
        }
      }

      const currentTotal = Array.from(allUserStats.values()).reduce((sum, user) => sum + user.total, 0);
      console.log(`📈 Running total: ${currentTotal} media items from ${allUserStats.size} users`);

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\n🎯 ${reportType.toUpperCase()} SCAN FINISHED!`);
    console.log(`📊 Scanned ${totalChannelsScanned} channels`);
    console.log(`👤 Found ${allUserStats.size} users with media items`);
    
    let grandTotal = 0;
    for (const [userId, userData] of allUserStats) {
      console.log(`👤 ${userData.username} (${userId}) - ${userData.total} media items`);
      console.log(`   Mention: <@${userId}>`);
      grandTotal += userData.total;
    }
    
    console.log(`🏆 ${reportType.toUpperCase()} GRAND TOTAL: ${grandTotal} media items found`);
    
    return allUserStats;
  }

  // Get channel breakdown
  getChannelBreakdown(userStats, channelIds) {
    const channelData = new Map();
    
    for (const channelId of channelIds) {
      const channel = this.client.channels.cache.get(channelId);
      let channelTotal = 0;

      for (const userData of userStats.values()) {
        for (const [channelKey, count] of userData.channels) {
          if (channelKey === channelId || channelKey.startsWith(`forum-${channelId}-`)) {
            channelTotal += count;
          }
        }
      }

      const channelName = channel ? 
        (channel.type === 15 ? `🏛️ ${channel.name}` : `#${channel.name}`) : 
        `Unknown Channel (${channelId})`;

      channelData.set(channelId, {
        name: channelName,
        total: channelTotal
      });
    }

    return channelData;
  }

  // Get top users
  getTopUsers(userStats, limit = 10) {
    return Array.from(userStats.entries())
      .map(([userId, data]) => ({
        userId,
        username: data.username,
        total: data.total,
        channelCount: data.channels.size,
        roles: data.roles,
        userMention: data.userMention
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  }
}

module.exports = AttachmentCounter;
