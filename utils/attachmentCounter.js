const { Collection } = require('discord.js');

class AttachmentCounter {
  constructor(client) {
    this.client = client;
    this.weeklyData = new Map();
    this.monthlyData = new Map();
    this.allChannelsCache = [];
  }

  // Get all channels from specified categories, excluding blacklisted ones
  getAllChannelsToScan(config) {
    if (this.allChannelsCache.length > 0) {
      return this.allChannelsCache;
    }

    const allChannels = [];

    // Explicit individual channels/forums (in addition to categories below)
    for (const channelId of config.attachmentCounter.additionalChannels || []) {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        console.log(`⚠️ Additional channel not found: ${channelId}`);
        continue;
      }
      if (!(channel.isTextBased() || channel.type === 15 || channel.type === 16) || channel.isThread()) {
        console.log(`⚠️ Additional channel ${channelId} (${channel.name}) is not a scannable text/forum/media channel — skipping`);
        continue;
      }
      allChannels.push(channelId);
    }
    console.log(`📌 Added ${allChannels.length} explicit additional channels`);

    // Get all text channels from each category
    for (const categoryId of config.attachmentCounter.categoriesToScan || []) {
      const category = this.client.channels.cache.get(categoryId);
      if (category && category.type === 4) { // GUILD_CATEGORY
        const categoryChannels = category.children.cache
          .filter(ch => (ch.isTextBased() || ch.type === 15 || ch.type === 16) && !ch.isThread())
          .map(ch => ch.id);
        allChannels.push(...categoryChannels);
        console.log(`📂 Added ${categoryChannels.length} channels from category: ${category.name}`);
      } else {
        console.log(`⚠️ Category not found or invalid: ${categoryId}`);
      }
    }

    // Remove duplicates and filter out excluded channels
    const uniqueChannels = [...new Set(allChannels)];
    const filteredChannels = uniqueChannels.filter(ch => !config.attachmentCounter.excludedChannels.includes(ch));

    this.allChannelsCache = filteredChannels;

    console.log(`📊 Total channels to scan: ${filteredChannels.length}`);
    console.log(`🚫 Excluded ${uniqueChannels.length - filteredChannels.length} channels`);
    return filteredChannels;
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
  async scanAllChannelMessages(channel, trackedRoles, sinceDate, untilDate = null) {
    console.log(`🔍 Scanning ALL messages in ${channel.name} since ${sinceDate.toLocaleString()}${untilDate ? ` until ${untilDate.toLocaleString()}` : ''}`);
    
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

          // Skip messages newer than the upper bound (relevant for automatic
          // reports scanning a specific past month), but keep paginating
          // since Discord returns newest-first.
          if (untilDate && message.createdAt >= untilDate) {
            lastMessageId = messageId;
            continue;
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

  // Scan forum / media channels (type 15 or 16)
  async scanForumChannel(forumChannel, trackedRoles, sinceDate, untilDate = null) {
    console.log(`🏛️  Scanning forum: ${forumChannel.name}`);

    const userStats = new Map();
    let totalThreads = 0;
    let totalMedia = 0;
    // Use a plain array + Set for dedup — avoids Collection iterator quirks
    const seen = new Set();
    const relevantThreads = [];

    const addThread = (thread) => {
      if (!seen.has(thread.id)) {
        seen.add(thread.id);
        relevantThreads.push(thread);
      }
    };

    // ── 1. Active threads ─────────────────────────────────────────────────────
    // All active threads can have this-month messages regardless of creation date
    try {
      const activeResult = await forumChannel.threads.fetchActive();
      activeResult.threads.forEach(t => addThread(t));
      console.log(`🟢 Active threads in ${forumChannel.name}: ${activeResult.threads.size}`);
    } catch (err) {
      console.error(`⚠️ fetchActive failed for ${forumChannel.name}:`, err.message);
    }

    // ── 2. Recently archived threads ──────────────────────────────────────────
    // Key insight: if a thread had a post in the current month it would have been
    // re-opened (Discord auto-unarchives on new message) and would appear in
    // fetchActive(). So only archived threads that were archived THIS month can
    // possibly have this-month content.
    try {
      let keepFetching = true;
      let before = undefined;
      let archivedAdded = 0;

      while (keepFetching) {
        const opts = { limit: 100 };
        if (before) opts.before = before;

        const result = await forumChannel.threads.fetchArchived(opts);
        if (!result || result.threads.size === 0) break;

        let lastThread = null;
        let allOlderThanMonth = true;

        result.threads.forEach(thread => {
          const archiveTs = thread.archiveTimestamp ? new Date(thread.archiveTimestamp) : null;
          const createdAt  = thread.createdAt;

          // Include if: created in range OR archived in range
          const inSinceRange = createdAt >= sinceDate || (archiveTs && archiveTs >= sinceDate);
          const inUntilRange = !untilDate || createdAt <= untilDate || (archiveTs && archiveTs <= untilDate);
          if (inSinceRange && inUntilRange) {
            addThread(thread);
            archivedAdded++;
            allOlderThanMonth = false;
          }

          lastThread = thread;
        });

        // Stop once we've gone far enough back that no thread could be relevant
        if (allOlderThanMonth || !result.hasMore) {
          keepFetching = false;
        } else {
          before = lastThread?.id;
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log(`📦 Archived (this month) in ${forumChannel.name}: ${archivedAdded}`);
    } catch (err) {
      console.error(`⚠️ fetchArchived failed for ${forumChannel.name}:`, err.message);
    }

    console.log(`📂 Total threads to scan in ${forumChannel.name}: ${relevantThreads.length}`);

    // ── 3. Scan each thread (plain for loop over array, per-thread catch) ─────
    for (let i = 0; i < relevantThreads.length; i++) {
      const thread = relevantThreads[i];
      totalThreads++;
      console.log(`📖 [${i + 1}/${relevantThreads.length}] Scanning thread: ${thread.name}`);

      try {
        const threadStats = await this.scanAllChannelMessages(thread, trackedRoles, sinceDate, untilDate);

        for (const [userId, userData] of threadStats) {
          if (!userStats.has(userId)) {
            userStats.set(userId, {
              username: userData.username,
              total: 0,
              channels: new Map(),
              roles: userData.roles,
              userMention: `<@${userId}>`,
            });
          }

          const overallData = userStats.get(userId);
          overallData.total += userData.total;
          totalMedia += userData.total;

          // Aggregate all threads of this forum under one key
          const forumKey = `forum-${forumChannel.id}`;
          overallData.channels.set(forumKey, (overallData.channels.get(forumKey) || 0) + userData.total);
        }
      } catch (err) {
        console.error(`❌ Thread scan error [${thread.name}]:`, err.message);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`✅ Scanned ${totalThreads} threads in forum ${forumChannel.name}, found ${totalMedia} media items`);
    return userStats;
  }

  // Scan channel (forum, media channel, or regular text)
  async scanChannel(channel, trackedRoles, sinceDate, untilDate = null) {
    if (channel.type === 15 || channel.type === 16) {
      // type 15 = GuildForum, type 16 = GuildMedia — both use threads
      return await this.scanForumChannel(channel, trackedRoles, sinceDate, untilDate);
    } else if (channel.isTextBased()) {
      return await this.scanAllChannelMessages(channel, trackedRoles, sinceDate, untilDate);
    } else {
      return new Map();
    }
  }

  // Main scanning method – receives the full config object.
  // `dateRange` (optional): { since: Date, until: Date|null } overrides the
  // default reportType-based date logic entirely, when provided.
  async scanChannels(config, reportType = 'weekly', dateRange = null) {
    const trackedRoles = config.attachmentCounter.trackedRoles;
    console.log(`🔄 Starting ${reportType.toUpperCase()} attachment scan...`);
    
    const allChannels = this.getAllChannelsToScan(config);
    const allUserStats = new Map();
    
    let sinceDate, untilDate = null;
    if (dateRange) {
      sinceDate = dateRange.since;
      untilDate = dateRange.until || null;
      console.log(`📅 Custom range scan: From ${sinceDate.toLocaleDateString()}${untilDate ? ` to ${untilDate.toLocaleDateString()}` : ' to now'}`);
    } else if (reportType === 'monthly') {
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
      const channelStats = await this.scanChannel(channel, trackedRoles, sinceDate, untilDate);

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
          if (
            channelKey === channelId ||                          // regular channel
            channelKey === `forum-${channelId}` ||              // new aggregated forum key
            channelKey.startsWith(`forum-${channelId}-`)        // old per-thread forum key
          ) {
            channelTotal += count;
          }
        }
      }

      const channelName = channel ?
        (channel.type === 15 || channel.type === 16 ? `🏛️ ${channel.name}` : `#${channel.name}`) :
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
