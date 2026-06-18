const { EmbedBuilder } = require('discord.js');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * StatpReportGenerator — produces one embed per member.
 * Each embed shows their total + per-channel breakdown,
 * skipping channels where they posted nothing.
 */
class StatpReportGenerator {
  constructor(client) {
    this.client = client;
  }

  /**
   * Build the per-member embed.
   * @param {string}  userId    Discord user ID
   * @param {object}  userData  { username, total, channels: Map<channelKey, count> }
   * @param {Date}    reportDate  Any date in the reported month
   */
  generateMemberEmbed(userId, userData, reportDate) {
    const monthLabel = `${MONTH_NAMES[reportDate.getMonth()]} ${reportDate.getFullYear()}`;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`📊 Monthly Report — ${monthLabel}`)
      .setTimestamp()
      .setFooter({ text: 'Monthly Statp Report' });

    // --- Total ---
    embed.addFields({
      name: '📊 Total Shared',
      value: `**${userData.total}** media items`,
      inline: false,
    });

    // --- Channel breakdown (only channels with at least 1 item) ---
    if (userData.channels && userData.channels.size > 0) {
      // Use a Map to aggregate: multiple threads in the same forum → one line
      const aggregated = new Map(); // display label → total count

      for (const [channelKey, count] of userData.channels) {
        if (count <= 0) continue;

        let display;
        if (channelKey.startsWith('forum-')) {
          // forum-{forumId}-{threadId} — group all threads under the forum name
          const forumId = channelKey.split('-')[1];
          const forum = this.client.channels.cache.get(forumId);
          display = forum ? `🏛️ ${forum.name}` : `🏛️ Forum (${forumId})`;
        } else {
          display = `<#${channelKey}>`;
        }

        aggregated.set(display, (aggregated.get(display) || 0) + count);
      }

      // Convert to sorted array
      const lines = Array.from(aggregated.entries())
        .map(([display, count]) => ({ display, count }));

      // Sort highest → lowest
      lines.sort((a, b) => b.count - a.count);

      if (lines.length > 0) {
        const value = lines
          .map(({ display, count }) => `${display} — **${count}** item${count !== 1 ? 's' : ''}`)
          .join('\n');

        embed.addFields({
          name: '📍 Channel Breakdown',
          value,
          inline: false,
        });
      }
    }

    return embed;
  }
}

module.exports = StatpReportGenerator;
