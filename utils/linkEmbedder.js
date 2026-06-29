'use strict';

const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const ytDlp    = require('yt-dlp-exec');
const { AttachmentBuilder } = require('discord.js');

const EMBED_ROLE_ID = '1502603423923699833';

// Discord's free-tier file size limit (25 MB)
const MAX_FILE_BYTES = 25 * 1024 * 1024;

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
      found.push({ url: m[0].replace(/[.,;!?)>\]]+$/, ''), platform, start: m.index });
    }
    re.lastIndex = 0;
  }
  return found.sort((a, b) => a.start - b.start);
}

// ── Twitter → fixupx plain URL (Discord renders inline video natively) ────────
function buildTwitterPost(url, authorId) {
  const fixUrl = url
    .replace(/(?:www\.)?x\.com/, 'fixupx.com')
    .replace(/(?:www\.)?twitter\.com/, 'fixupx.com');

  return { content: `<@${authorId}>\n${fixUrl}` };
}

// ── Download video via yt-dlp-exec and upload to Discord ─────────────────────
async function buildVideoPost(url, authorId, platform) {
  const tmpFile = path.join(os.tmpdir(), `blbot_${Date.now()}.mp4`);

  try {
    await ytDlp(url, {
      output: tmpFile,
      noPlaylist: true,
      format: 'mp4/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      mergeOutputFormat: 'mp4',
      maxFilesize: '24M',
      quiet: true,
      noWarnings: true,
    });

    const stat = fs.statSync(tmpFile);
    if (stat.size > MAX_FILE_BYTES) {
      fs.unlinkSync(tmpFile);
      console.warn(`[LinkEmbed] ${platform} video too large (${(stat.size / 1024 / 1024).toFixed(1)} MB), skipping`);
      return null;
    }

    const attachment = new AttachmentBuilder(tmpFile, { name: 'video.mp4' });
    return {
      content: `<@${authorId}>`,
      files: [attachment],
      _cleanup: () => { try { fs.unlinkSync(tmpFile); } catch {} },
    };
  } catch (err) {
    try { fs.unlinkSync(tmpFile); } catch {}
    throw err;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
async function handleLinkEmbed(message) {
  if (!message.guild || !message.channel?.isTextBased()) return false;
  if (message.author.bot) return false;

  const member = message.member;
  if (!member?.roles?.cache?.has(EMBED_ROLE_ID)) return false;

  const detections = detectUrls(message.content);
  if (!detections.length) return false;

  try {
    await message.delete();
  } catch (err) {
    if (err.code === 50013) {
      console.error(`[LinkEmbed] ❌ Missing "Manage Messages" permission in #${message.channel.name}`);
    } else {
      console.error(`[LinkEmbed] Delete failed (${err.code}):`, err.message);
    }
    return false;
  }

  for (const det of detections) {
    try {
      let payload;

      if (det.platform === 'twitter') {
        payload = buildTwitterPost(det.url, message.author.id);
      } else {
        payload = await buildVideoPost(det.url, message.author.id, det.platform);
      }

      if (payload) {
        const { _cleanup, ...sendPayload } = payload;
        await message.channel.send(sendPayload);
        if (_cleanup) _cleanup();
        console.log(`[LinkEmbed] ✅ ${det.platform} sent for ${message.author.username}`);
      }
    } catch (err) {
      console.error(`[LinkEmbed] ❌ ${det.platform} failed:`, err.message);
    }
  }

  return true;
}

module.exports = { handleLinkEmbed };
