'use strict';

const https = require('https');

const EMBED_ROLE_ID = '1502603423923699833';

// ── HTTP fetch ────────────────────────────────────────────────────────────────
function httpsGet(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0)', Accept: 'application/json' },
    }, (res) => {
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

// ── Twitter → fixupx (plays video inline in Discord) ─────────────────────────
function buildTwitterPost(url, authorId, authorName) {
  const fixUrl = url
    .replace(/(?:www\.)?x\.com/, 'fixupx.com')
    .replace(/(?:www\.)?twitter\.com/, 'fixupx.com');

  // Plain text: mention + proxy URL — Discord renders it as an inline video player
  return { content: `<@${authorId}> **${authorName}** shared a tweet:\n${fixUrl}` };
}

// ── TikTok → vxtiktok (plays video inline in Discord) ────────────────────────
function buildTikTokPost(url, authorId, authorName) {
  const proxyUrl = url
    .replace(/(?:vm\.|vt\.|www\.)?tiktok\.com/, 'vxtiktok.com')
    .replace(/^http:/, 'https:');

  return { content: `<@${authorId}> **${authorName}** shared a TikTok:\n${proxyUrl}` };
}

// ── Instagram → ddinstagram (plays reel inline in Discord) ───────────────────
function buildInstagramPost(url, authorId, authorName) {
  const proxyUrl = url.replace(/(?:www\.)?instagram\.com/, 'ddinstagram.com');

  return { content: `<@${authorId}> **${authorName}** shared an Instagram reel:\n${proxyUrl}` };
}

// ── Main handler ──────────────────────────────────────────────────────────────
async function handleLinkEmbed(message) {
  if (!message.guild || !message.channel?.isTextBased()) return false;
  if (message.author.bot) return false;

  const member = message.member;
  if (!member?.roles?.cache?.has(EMBED_ROLE_ID)) return false;

  const detections = detectUrls(message.content);
  if (!detections.length) return false;

  // Delete original message
  try {
    await message.delete();
  } catch (err) {
    if (err.code === 50013) {
      console.error(`[LinkEmbed] ❌ MISSING "Manage Messages" PERMISSION in #${message.channel.name}.`);
    } else {
      console.error(`[LinkEmbed] Delete failed (${err.code}):`, err.message);
    }
    return false;
  }

  const authorName = message.member?.displayName || message.author.username;

  // Send one plain-text proxy URL per detected link — Discord auto-plays them
  for (const det of detections) {
    try {
      let payload;

      if      (det.platform === 'twitter')   payload = buildTwitterPost(det.url, message.author.id, authorName);
      else if (det.platform === 'tiktok')    payload = buildTikTokPost(det.url, message.author.id, authorName);
      else if (det.platform === 'instagram') payload = buildInstagramPost(det.url, message.author.id, authorName);

      if (payload) await message.channel.send(payload);
      console.log(`[LinkEmbed] ✅ Sent ${det.platform} inline video for ${message.author.username}`);
    } catch (err) {
      console.error(`[LinkEmbed] Error sending ${det.platform}:`, err.message);
    }
  }

  return true;
}

module.exports = { handleLinkEmbed };
