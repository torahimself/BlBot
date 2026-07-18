const AttachmentCounter = require('./attachmentCounter');

/**
 * StatpScanner — scans one or more categories (with exclusions),
 * filtered to members with a specific role, for the current month.
 * Inherits all message/forum scanning logic from AttachmentCounter.
 */
class StatpScanner extends AttachmentCounter {
  constructor(client) {
    super(client);
    this.statpChannelsCache = [];
  }

  // Build the full deduplicated list of channel IDs for the statp scan
  getStatpChannels(config) {
    if (this.statpChannelsCache.length > 0) return this.statpChannelsCache;

    const exclusions = config.statp.excludedChannels || [];
    const channels = [];

    // 1. Explicit individual channels/forums listed directly
    const explicitChannelIds = config.statp.channels || [];
    for (const channelId of explicitChannelIds) {
      if (exclusions.includes(channelId)) continue;

      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        console.log(`⚠️ [Statp] Explicit channel not found: ${channelId}`);
        continue;
      }
      if (!(channel.isTextBased() || channel.type === 15 || channel.type === 16) || channel.isThread()) {
        console.log(`⚠️ [Statp] Explicit channel ${channelId} (${channel.name}) is not a scannable text/forum/media channel — skipping`);
        continue;
      }
      channels.push(channelId);
    }
    console.log(`📌 [Statp] Explicit channels added: ${channels.length}`);

    // 2. Every category in the categories list
    const categoryIds = config.statp.categories || [];
    for (const categoryId of categoryIds) {
      const category = this.client.channels.cache.get(categoryId);
      if (!category || category.type !== 4) {
        console.log(`⚠️ [Statp] Category not found or not a category: ${categoryId}`);
        continue;
      }

      const catChannels = category.children.cache
        .filter(ch =>
          // Include text channels, forum channels (15), and media channels (16)
          (ch.isTextBased() || ch.type === 15 || ch.type === 16) &&
          !ch.isThread() &&
          !exclusions.includes(ch.id)
        )
        .map(ch => ch.id);

      console.log(`📂 [Statp] Category "${category.name}": ${catChannels.length} channels added`);
      channels.push(...catChannels);
    }

    // Deduplicate
    this.statpChannelsCache = [...new Set(channels)];
    console.log(`📊 [Statp] Total channels to scan: ${this.statpChannelsCache.length} (excluded: ${exclusions.length} IDs)`);
    return this.statpChannelsCache;
  }

  // Full statp scan. `dateRange` (optional): { since: Date, until: Date|null }
  // overrides the default "current month" behavior when provided.
  async scanStatp(config, dateRange = null) {
    const trackedRoles = [config.statp.trackedRole];

    let sinceDate, untilDate = null;
    if (dateRange) {
      sinceDate = dateRange.since;
      untilDate = dateRange.until || null;
      console.log(`🔄 [Statp] Starting custom-range scan...`);
      console.log(`📅 [Statp] From ${sinceDate.toISOString()}${untilDate ? ` to ${untilDate.toISOString()}` : ' to now'}`);
    } else {
      const now = new Date();
      sinceDate = new Date(now.getFullYear(), now.getMonth(), 1);
      console.log(`🔄 [Statp] Starting monthly scan...`);
      console.log(`📅 [Statp] From ${sinceDate.toLocaleDateString()} (${sinceDate.toISOString()}) to now`);
    }

    const channelIds = this.getStatpChannels(config);
    const allUserStats = new Map();
    let scanned = 0;

    for (const channelId of channelIds) {
      scanned++;
      console.log(`\n📊 [Statp] Progress: ${scanned}/${channelIds.length} channels`);

      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        console.log(`❌ [Statp] Channel not in cache: ${channelId}`);
        continue;
      }

      const typeLabel = channel.type === 15 ? 'forum' : channel.type === 16 ? 'media' : 'text';
      console.log(`🔍 [Statp] Scanning ${typeLabel}: ${channel.name}`);

      const channelStats = await this.scanChannel(channel, trackedRoles, sinceDate, untilDate);

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
