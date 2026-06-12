const AttachmentCounter = require('./attachmentCounter');

/**
 * StatpScanner — scans a fixed set of channels + one category,
 * filtered to members with a single specific role, for the current month.
 * Inherits all message-scanning logic from AttachmentCounter.
 */
class StatpScanner extends AttachmentCounter {
  constructor(client) {
    super(client);
    this.statpChannelsCache = [];
  }

  // Build the full list of channel IDs for the statp scan
  getStatpChannels(config) {
    if (this.statpChannelsCache.length > 0) return this.statpChannelsCache;

    // Start with the explicit channel list
    const channels = [...config.statp.channels];

    // Add all text channels from the specified category
    const category = this.client.channels.cache.get(config.statp.category);
    if (category && category.type === 4) { // GUILD_CATEGORY
      const catChannels = category.children.cache
        .filter(ch => ch.isTextBased() && !ch.isThread())
        .map(ch => ch.id);
      channels.push(...catChannels);
      console.log(`📂 [Statp] Added ${catChannels.length} channels from category: ${category.name}`);
    } else {
      console.log(`⚠️ [Statp] Category not found or invalid: ${config.statp.category}`);
    }

    // Deduplicate
    this.statpChannelsCache = [...new Set(channels)];
    console.log(`📊 [Statp] Total channels to scan: ${this.statpChannelsCache.length}`);
    return this.statpChannelsCache;
  }

  // Full statp scan — current month, single tracked role
  async scanStatp(config) {
    const trackedRoles = [config.statp.trackedRole];
    const now = new Date();
    const sinceDate = new Date(now.getFullYear(), now.getMonth(), 1);

    console.log(`🔄 [Statp] Starting monthly scan...`);
    console.log(`📅 [Statp] From ${sinceDate.toLocaleDateString()} (${sinceDate.toISOString()}) to now`);

    const channelIds = this.getStatpChannels(config);
    const allUserStats = new Map();
    let scanned = 0;

    for (const channelId of channelIds) {
      scanned++;
      console.log(`\n📊 [Statp] Progress: ${scanned}/${channelIds.length} channels`);

      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        console.log(`❌ [Statp] Channel not found: ${channelId}`);
        continue;
      }

      console.log(`🔍 [Statp] Scanning: ${channel.name}`);
      const channelStats = await this.scanChannel(channel, trackedRoles, sinceDate);

      for (const [userId, userData] of channelStats) {
        if (!allUserStats.has(userId)) {
          allUserStats.set(userId, {
            username: userData.username,
            total: 0,
            channels: new Map(),
            userMention: `<@${userId}>`,
          });
        }

        const overallData = allUserStats.get(userId);
        overallData.total += userData.total;

        for (const [channelKey, count] of userData.channels) {
          overallData.channels.set(
            channelKey,
            (overallData.channels.get(channelKey) || 0) + count
          );
        }
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\n✅ [Statp] Scan complete — ${allUserStats.size} members found`);
    return allUserStats;
  }
}

module.exports = StatpScanner;
