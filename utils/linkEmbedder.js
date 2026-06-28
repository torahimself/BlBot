'use strict';

const https = require('https');

const EMBED_ROLE_ID = '1502603423923699833';

// ── Fallback proxies (used when embedez API is unavailable) ───────────────────
const FALLBACK = {
  twitter:   (url) => /\/\/(?:www\.)?x\.com\//i.test(url)
                        ? url.replace(/(?:www\.)?x\.com/, 'fixupx.com')
                        : url.replace(/(?:www\.)?twitter\.com/, 'fxtwitter.com'),
  tiktok:    (url) => url.replace(/tiktok\.com/, 'tnktok.com'),
  instagram: (url) => url.replace(/(?:www\.)?instagram\.com/, 'zzinstagram.com'),
};

// ── EmbedEZ API ───────────────────────────────────────────────────────────────
// Docs: https://embedez.com/blog/embedez-api-documentation
// Returns the clean proxy URL that hides the raw social media link.
function fetchEmbedEzKey(originalUrl) {
  return new Promise((resolve, reject) => {
    const apiUrl = `https://embedez.com/api/v1/providers/search?url=${encodeURIComponent(originalUrl)}`;
    const req = https.get(apiUrl, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0)',
        'Accept': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.key || null);   // e.g. "search_6a409cfa23ae94e90c4c020c"
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('embedez timeout')); });
  });
}

async function getEmbedEzProxyUrl(originalUrl, platform) {
  const key = await fetchEmbedEzKey(originalUrl);
  if (!key) return null;

  // Matches the format from proxy.embedez.com
  const innerUrl = encodeURIComponent(`https://embedez.com/api/v1/redirect/${key}?site=${platform}`);
  const referUrl = `https://embedez.com/embed/${key}`;
  return `https://proxy.embedez.com/embed?url=${innerUrl}&refer=${referUrl}`;
}

// ── URL detection ─────────────────────────────────────────────────────────────
const PATTERNS = [
  {
    re: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s<>"')]+/gi,
    platform: 'twitter',
  },
  {
    re: /https?:\/\/(?:(?:vm|vt|www)\.)?tiktok\.com\/[^\s<>"')]+/gi,
    platform: 'tiktok',
  },
  {
    re: /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv|stories)\/[^\s<>"')]+/gi,
    platform: 'instagram',
  },
];

function detectUrls(content) {
  const found = [];
  for (const { re, platform } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      found.push({
        url:      m[0].replace(/[.,;!?)>\]]+$/, ''), // trim trailing punctuation
        platform,
        start:    m.index,
        end:      m.index + m[0].length,
      });
    }
    re.lastIndex = 0;
  }
  return found.sort((a, b) => a.start - b.start);
}

// ── Resolve one URL to its clean proxy form ───────────────────────────────────
async function resolveUrl(url, platform) {
  // Twitter is already perfect with fxtwitter — no API call needed
  if (platform === 'twitter') return FALLBACK.twitter(url);

  // TikTok / Instagram: try embedez for the clean URL, fall back to domain swap
  try {
    const ezUrl = await getEmbedEzProxyUrl(url, platform);
    if (ezUrl) return ezUrl;
  } catch (err) {
    console.warn(`[LinkEmbed] embedez API failed (${platform}), using fallback: ${err.message}`);
  }

  return FALLBACK[platform](url);
}

// ── Main handler (called from messageCreate) ──────────────────────────────────
async function handleLinkEmbed(message) {
  if (!message.guild || !message.channel?.isTextBased()) return false;
  if (message.author.bot) return false;

  const member = message.member;
  if (!member?.roles?.cache?.has(EMBED_ROLE_ID)) return false;

  const detections = detectUrls(message.content);
  if (!detections.length) return false;

  // Resolve each URL → substitute from end to start so indices stay valid
  let result = message.content;
  for (const det of [...detections].reverse()) {
    const proxyUrl = await resolveUrl(det.url, det.platform);
    result = result.slice(0, det.start) + proxyUrl + result.slice(det.end);
  }

  // Mention the sender so they get a ping
  const repost = `📎 <@${message.author.id}>:\n${result}`;

  // Delete original first
  try {
    await message.delete();
  } catch (err) {
    if (err.code === 50013) {
      console.warn(`[LinkEmbed] Missing MANAGE_MESSAGES in #${message.channel.name}`);
    } else {
      console.error(`[LinkEmbed] Delete failed:`, err.message);
    }
    return false;
  }

  // Repost with proxy URL
  try {
    await message.channel.send(repost);
    console.log(`[LinkEmbed] Reposted ${message.author.username}'s ${detections.map(d => d.platform).join('+')} link`);
    return true;
  } catch (err) {
    console.error(`[LinkEmbed] Send failed:`, err.message);
    return false;
  }
}

module.exports = { handleLinkEmbed };
