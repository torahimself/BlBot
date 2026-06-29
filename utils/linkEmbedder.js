'use strict';

const https = require('https');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const EMBED_ROLE_ID = '1502603423923699833';

// ── HTTP fetch ────────────────────────────────────────────────────────────────
function httpsGet(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0)', Accept: 'application/json' },
    }, (res) => {
      // Follow redirects
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        return httpsGet(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      let d = '';
      res.setEncoding('utf8');
      res.on('data', c => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── URL detection ─────────────────────────────────────────────────────────────
const PATTERNS = [
  { re: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s<>"')]+/gi,                           platform: 'twitter'   },
  { re: /https?:\/\/(?:(?:vm|vt|www)\.)?tiktok\.com\/[^\s<>"')]+/gi,                       platform: 'tiktok'    },
  { re: /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv|stories)\/[^\s<>"')]+/gi, platform: 'instagram' },
];

function detectUrls(content) {
  const found = [];
  for (const { re, platform } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      found.push({ url: m[0].replace(/[.,;!?)>\]]+$/, ''), platform, start: m.index, end: m.index + m[0].length });
    }
    re.lastIndex = 0;
  }
  return found.sort((a, b) => a.start - b.start);
}

// ── Twitter: rich embed via fxtwitter API ─────────────────────────────────────
function parseTweetId(url) {
  const m = url.match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}

async function buildTwitterPost(url, authorId) {
  const tweetId = parseTweetId(url);

  // fixupx renders video inline in Discord — use this as the primary link
  const fixUrl = /\/\/(?:www\.)?x\.com\//i.test(url)
    ? url.replace(/(?:www\.)?x\.com/, 'fixupx.com')
    : url.replace(/(?:www\.)?twitter\.com/, 'fixupx.com');

  // Original x.com link for the "View on X" button
  const viewUrl = /\/\/(?:www\.)?(?:twitter|x)\.com\//i.test(url)
    ? url.replace(/(?:www\.)?(?:twitter|x)\.com/, 'x.com')
    : url;

  // Fetch tweet data from fxtwitter public API (no key needed)
  let tweet = null;
  if (tweetId) {
    try {
      const data = await httpsGet(`https://api.fxtwitter.com/status/${tweetId}`);
      tweet = data?.tweet || null;
    } catch (e) {
      console.warn(`[LinkEmbed] fxtwitter API error: ${e.message}`);
    }
  }

  const embed = new EmbedBuilder().setColor(0x000000);
  let hasVideo = false;

  if (tweet) {
    embed.setAuthor({
      name: tweet.author?.name ? `${tweet.author.name} just tweeted:` : 'Just tweeted:',
      iconURL: tweet.author?.avatar_url || undefined,
      url: fixUrl,  // clicking the author name opens fixupx (plays video)
    });
    if (tweet.text)                embed.setDescription(tweet.text.slice(0, 4096));
    if (tweet.author?.screen_name) embed.setFooter({ text: `@${tweet.author.screen_name}  ·  X (Twitter)` });
    if (tweet.created_at)          embed.setTimestamp(new Date(tweet.created_at));

    // Media handling
    const media = tweet.media?.all?.[0];
    if (media?.type === 'photo' && media.url) {
      embed.setImage(media.url);
    } else if (media?.type === 'video' || media?.type === 'gif') {
      hasVideo = true;
      // Show video thumbnail; clicking the ▶️ button opens fixupx which plays it
      if (media.thumbnail_url) embed.setImage(media.thumbnail_url);
      else if (media.url)      embed.setImage(media.url);
    } else if (media?.thumbnail_url) {
      embed.setImage(media.thumbnail_url);
    }
  } else {
    // API failed — show minimal embed
    embed.setTitle('🐦 Twitter / X').setFooter({ text: 'Twitter / X' });
  }

  // Build buttons: always show ▶️ Play/Embed + View on X
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(hasVideo ? '▶️  Play Video' : '▶️  Open Embed')
      .setURL(fixUrl)
      .setStyle(ButtonStyle.Link),
    new ButtonBuilder()
      .setLabel('View on X')
      .setURL(viewUrl)
      .setStyle(ButtonStyle.Link)
      .setEmoji('🐦'),
  );

  return { content: `<@${authorId}>`, embeds: [embed], components: [row] };
}

// ── TikTok: direct proxy via vxTikTok (most reliable) ─────────────────────────
async function buildTikTokPost(url, authorId) {
  // vxtiktok.com is the most reliable TikTok proxy — works like fixupx for Twitter.
  // It rewrites the URL so Discord can render the video embed directly.
  const proxyUrl = url
    .replace(/(?:vm\.|vt\.|www\.)?tiktok\.com/, 'vxtiktok.com')
    .replace(/^http:/, 'https:');

  // Also try to fetch oEmbed metadata for title/author/thumbnail
  let title = null;
  let author = null;
  let thumb = null;

  try {
    const oembed = await httpsGet(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
    );
    if (oembed) {
      title  = oembed.title        || null;
      author = oembed.author_name  || null;
      thumb  = oembed.thumbnail_url|| null;
    }
  } catch (e) {
    console.warn(`[LinkEmbed] TikTok oEmbed error: ${e.message}`);
  }

  const embed = new EmbedBuilder().setColor(0x010101).setFooter({ text: 'TikTok' });

  if (author) embed.setAuthor({ name: `${author} on TikTok` });
  if (title)  embed.setDescription(title.slice(0, 300));
  if (thumb)  embed.setImage(thumb);
  if (!author && !title && !thumb) embed.setTitle('🎵 TikTok Video');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('▶️  Play Video')
      .setURL(proxyUrl)
      .setStyle(ButtonStyle.Link),
    new ButtonBuilder()
      .setLabel('Watch on TikTok')
      .setURL(url)
      .setStyle(ButtonStyle.Link)
      .setEmoji('🎵'),
  );

  return { content: `<@${authorId}>`, embeds: [embed], components: [row] };
}

// ── Instagram: embed + button ─────────────────────────────────────────────────
async function buildInstagramPost(url, authorId) {
  // ddinstagram.com is the most reliable Instagram proxy (similar to fixupx/vxtiktok)
  const proxyUrl = url.replace(/(?:www\.)?instagram\.com/, 'ddinstagram.com');
  // Keep original link for the "View" button
  const viewUrl = url.replace(/(?:www\.)?instagram\.com/, 'www.instagram.com');

  // Try oEmbed for metadata
  let title  = null;
  let author = null;
  let thumb  = null;

  try {
    const oembed = await httpsGet(
      `https://www.instagram.com/oembed/?url=${encodeURIComponent(url)}&omitscript=true`
    );
    if (oembed) {
      title  = oembed.title       || null;
      author = oembed.author_name || null;
      thumb  = oembed.thumbnail_url || null;
    }
  } catch (e) {
    console.warn(`[LinkEmbed] Instagram oEmbed error: ${e.message}`);
  }

  const embed = new EmbedBuilder().setColor(0xC13584).setFooter({ text: 'Instagram' });

  if (author) embed.setAuthor({ name: `${author} on Instagram` });
  if (title)  embed.setDescription(title.slice(0, 300));
  if (thumb)  embed.setImage(thumb);
  if (!author && !title && !thumb) embed.setTitle('📸 Instagram');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('▶️  Play Reel')
      .setURL(proxyUrl)
      .setStyle(ButtonStyle.Link),
    new ButtonBuilder()
      .setLabel('View on Instagram')
      .setURL(viewUrl)
      .setStyle(ButtonStyle.Link)
      .setEmoji('📸'),
  );

  return { content: `<@${authorId}>`, embeds: [embed], components: [row] };
}

// ── Main handler ──────────────────────────────────────────────────────────────
async function handleLinkEmbed(message) {
  if (!message.guild || !message.channel?.isTextBased()) return false;
  if (message.author.bot) return false;

  const member = message.member;
  if (!member?.roles?.cache?.has(EMBED_ROLE_ID)) return false;

  const detections = detectUrls(message.content);
  if (!detections.length) return false;

  // Delete original — if this fails the bot stops here (no duplicate response)
  try {
    await message.delete();
  } catch (err) {
    if (err.code === 50013) {
      console.error(`[LinkEmbed] ❌ MISSING "Manage Messages" PERMISSION in #${message.channel.name}. Grant this to the bot role in channel/server settings.`);
    } else {
      console.error(`[LinkEmbed] Delete failed (${err.code}):`, err.message);
    }
    return false;
  }

  // Send one rich embed per detected URL
  for (const det of detections) {
    try {
      let payload;

      if      (det.platform === 'twitter')   payload = await buildTwitterPost(det.url, message.author.id);
      else if (det.platform === 'tiktok')    payload = await buildTikTokPost(det.url, message.author.id);
      else if (det.platform === 'instagram') payload = await buildInstagramPost(det.url, message.author.id);

      if (payload) await message.channel.send(payload);
      console.log(`[LinkEmbed] ✅ Sent ${det.platform} embed for ${message.author.username}`);
    } catch (err) {
      console.error(`[LinkEmbed] Error building ${det.platform} embed:`, err.message);
    }
  }

  return true;
}

module.exports = { handleLinkEmbed };
