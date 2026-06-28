'use strict';

const https   = require('https');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const EMBED_ROLE_ID = '1502603423923699833';

// ── Platform definitions ──────────────────────────────────────────────────────
const PLATFORM = {
  twitter: {
    label: 'Twitter / X',
    emoji: '🐦',
    color: 0x000000,
    proxy: (url) =>
      /\/\/(?:www\.)?x\.com\//i.test(url)
        ? url.replace(/(?:www\.)?x\.com/, 'fixupx.com')
        : url.replace(/(?:www\.)?twitter\.com/, 'fxtwitter.com'),
  },
  tiktok: {
    label: 'TikTok',
    emoji: '🎵',
    color: 0x010101,
    proxy: (url) => url.replace(/tiktok\.com/, 'tnktok.com'),
  },
  instagram: {
    label: 'Instagram',
    emoji: '📸',
    color: 0xC13584,
    proxy: (url) => url.replace(/(?:www\.)?instagram\.com/, 'gginstagram.com'),
  },
};

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

// ── EmbedEZ API (clean proxy URL + optional thumbnail for TikTok) ─────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0)', Accept: 'application/json' },
    }, (res) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', c => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function getEmbezData(originalUrl, platform) {
  // Combined endpoint: returns key + preview data in one call
  const apiUrl = `https://embedez.com/api/v1/providers/combined?q=${encodeURIComponent(originalUrl)}`;
  const json = await httpsGet(apiUrl);
  if (!json?.key) return null;

  const key      = json.key;
  const innerUrl = encodeURIComponent(`https://embedez.com/api/v1/redirect/${key}?site=${platform}`);
  const referUrl = `https://embedez.com/embed/${key}`;
  const proxyUrl = `https://proxy.embedez.com/embed?url=${innerUrl}&refer=${referUrl}`;

  // Pull thumbnail from response if available
  const thumb = json.data?.media?.thumbnail
    || json.data?.media?.all?.[0]?.url
    || json.data?.thumbnail_url
    || null;

  return { proxyUrl, thumb };
}

// ── Build embed + button (no raw URL in the message content) ──────────────────
function buildPost(platform, proxyUrl, authorId, extraText, thumb) {
  const cfg = PLATFORM[platform];

  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setFooter({ text: cfg.label });

  if (extraText) embed.setDescription(extraText);
  if (thumb)     embed.setImage(thumb);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Watch / View')
      .setURL(proxyUrl)
      .setStyle(ButtonStyle.Link)
      .setEmoji(cfg.emoji),
  );

  return {
    content: `<@${authorId}>`,   // ping only — no raw URL visible
    embeds:  [embed],
    components: [row],
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
async function handleLinkEmbed(message) {
  if (!message.guild || !message.channel?.isTextBased()) return false;
  if (message.author.bot) return false;

  const member = message.member;
  if (!member?.roles?.cache?.has(EMBED_ROLE_ID)) return false;

  const detections = detectUrls(message.content);
  if (!detections.length) return false;

  // Delete original message first
  try {
    await message.delete();
  } catch (err) {
    if (err.code === 50013) console.warn(`[LinkEmbed] Missing MANAGE_MESSAGES in #${message.channel.name}`);
    else                    console.error(`[LinkEmbed] Delete error:`, err.message);
    return false;
  }

  // Extract any non-URL text from the original message to keep as context
  let extraText = message.content;
  for (const det of [...detections].reverse()) {
    extraText = extraText.slice(0, det.start) + extraText.slice(det.end);
  }
  extraText = extraText.trim() || null;

  // Post one clean embed per detected URL
  for (const det of detections) {
    try {
      let proxyUrl = PLATFORM[det.platform].proxy(det.url);
      let thumb    = null;

      // For TikTok: try embedez API for clean URL + thumbnail
      if (det.platform === 'tiktok') {
        try {
          const ez = await getEmbezData(det.url, 'tiktok');
          if (ez) { proxyUrl = ez.proxyUrl; thumb = ez.thumb; }
        } catch (e) {
          console.warn(`[LinkEmbed] embedez failed, using tnktok fallback: ${e.message}`);
        }
      }

      const payload = buildPost(det.platform, proxyUrl, message.author.id, extraText, thumb);
      await message.channel.send(payload);
      console.log(`[LinkEmbed] Sent ${det.platform} embed for ${message.author.username}`);
    } catch (err) {
      console.error(`[LinkEmbed] Error posting ${det.platform}:`, err.message);
    }
  }

  return true;
}

module.exports = { handleLinkEmbed };
