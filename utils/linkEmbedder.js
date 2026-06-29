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
  const viewUrl = /\/\/(?:www\.)?x\.com\//i.test(url)
    ? url.replace(/(?:www\.)?x\.com/, 'fixupx.com')
    : url.replace(/(?:www\.)?twitter\.com/, 'fxtwitter.com');

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

  if (tweet) {
    embed.setAuthor({
      name: tweet.author?.name ? `${tweet.author.name} just tweeted:` : 'Just tweeted:',
      iconURL: tweet.author?.avatar_url || undefined,
      url: viewUrl,
    });
    if (tweet.text)          embed.setDescription(tweet.text.slice(0, 4096));
    if (tweet.author?.screen_name) embed.setFooter({ text: `@${tweet.author.screen_name}  ·  X (Twitter)` });
    if (tweet.created_at)   embed.setTimestamp(new Date(tweet.created_at));

    // First photo gets shown as embed image; video gets shown via thumbnail
    const media = tweet.media?.all?.[0];
    if (media?.type === 'photo' && media.url)          embed.setImage(media.url);
    else if (media?.thumbnail_url)                      embed.setImage(media.thumbnail_url);
  } else {
    // API failed — show minimal embed
    embed.setTitle('🐦 Twitter / X').setFooter({ text: 'Twitter / X' });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('View on X')
      .setURL(viewUrl)
      .setStyle(ButtonStyle.Link)
      .setEmoji('🐦'),
  );

  return { content: `<@${authorId}>`, embeds: [embed], components: [row] };
}

// ── TikTok: rich embed via embedez API ────────────────────────────────────────
async function buildTikTokPost(url, authorId) {
  let proxyUrl = url.replace(/tiktok\.com/, 'tnktok.com'); // fallback
  let thumb = null;
  let description = null;
  let creator = null;

  try {
    const data = await httpsGet(
      `https://embedez.com/api/v1/providers/combined?q=${encodeURIComponent(url)}`
    );
    if (data?.key) {
      const key     = data.key;
      const inner   = encodeURIComponent(`https://embedez.com/api/v1/redirect/${key}?site=tiktok`);
      const refer   = `https://embedez.com/embed/${key}`;
      proxyUrl      = `https://proxy.embedez.com/embed?url=${inner}&refer=${refer}`;
      thumb         = data.data?.media?.thumbnail
                   || data.data?.thumbnail_url
                   || data.data?.media?.all?.[0]?.thumbnail_url
                   || null;
      description   = data.data?.description || data.data?.title || null;
      creator       = data.data?.user?.displayName || data.data?.user?.name || null;
    }
  } catch (e) {
    console.warn(`[LinkEmbed] embedez TikTok API error: ${e.message}`);
  }

  const embed = new EmbedBuilder().setColor(0x010101).setFooter({ text: 'TikTok' });
  if (creator)     embed.setAuthor({ name: `${creator} on TikTok` });
  if (description) embed.setDescription(description.slice(0, 300));
  if (thumb)       embed.setImage(thumb);
  if (!creator && !description && !thumb) embed.setTitle('🎵 TikTok Video');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Watch on TikTok')
      .setURL(proxyUrl)
      .setStyle(ButtonStyle.Link)
      .setEmoji('🎵'),
  );

  return { content: `<@${authorId}>`, embeds: [embed], components: [row] };
}

// ── Instagram: embed + button ─────────────────────────────────────────────────
function buildInstagramPost(url, authorId) {
  const viewUrl = url.replace(/(?:www\.)?instagram\.com/, 'gginstagram.com');

  const embed = new EmbedBuilder()
    .setColor(0xC13584)
    .setTitle('📸 Instagram')
    .setFooter({ text: 'Instagram' });

  const row = new ActionRowBuilder().addComponents(
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
      else if (det.platform === 'instagram') payload = buildInstagramPost(det.url, message.author.id);

      if (payload) await message.channel.send(payload);
      console.log(`[LinkEmbed] ✅ Sent ${det.platform} embed for ${message.author.username}`);
    } catch (err) {
      console.error(`[LinkEmbed] Error building ${det.platform} embed:`, err.message);
    }
  }

  return true;
}

module.exports = { handleLinkEmbed };
