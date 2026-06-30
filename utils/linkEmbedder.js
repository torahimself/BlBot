'use strict';

const https    = require('https');
const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const { AttachmentBuilder } = require('discord.js');

const EMBED_ROLE_ID  = '1502603423923699833';
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB Discord free limit

// ── URL detection ─────────────────────────────────────────────────────────────
const PATTERNS = [
  { re: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s<>"')]+/gi,                           platform: 'twitter'   },
  { re: /https?:\/\/(?:(?:vm|vt|www)\.)?tiktok\.com\/[^\s<>"')]+/gi,                       platform: 'tiktok'    },
  { re: /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels)\/[^\s<>"')]+/gi,               platform: 'instagram' },
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

// ── HTTP GET → JSON (follows redirects) ───────────────────────────────────────
function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, */*',
        ...headers,
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location, headers).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Download binary file to disk (follows redirects) ─────────────────────────
function downloadFile(url, destPath, referer = 'https://www.tiktok.com/') {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    const req = lib.get(url, {
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': referer,
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(() => {
          try { fs.unlinkSync(destPath); } catch {}
          downloadFile(res.headers.location, destPath, referer).then(resolve).catch(reject);
        });
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode} downloading video`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('download timeout')); });
  });
}

// ── TikTok: tikwm.com public API ─────────────────────────────────────────────
async function getTikTokVideoUrl(url) {
  const data = await fetchJson(
    `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`
  );
  if (data?.code === 0 && data?.data?.play) {
    return data.data.play;
  }
  throw new Error(`tikwm: ${data?.msg || 'no video returned'}`);
}

// ── Instagram Reels: yt-dlp via Python (pip install yt-dlp runs on every boot) ─
const { execFile } = require('child_process');
const IG_COOKIES_FILE = path.join(__dirname, '../data/instagram_cookies.txt');

function runYtDlp(url, outputPath, cookiesFile) {
  return new Promise((resolve, reject) => {
    // Use python3 -m yt_dlp — works because pip install yt-dlp runs in package.json start script
    const args = [
      '-m', 'yt_dlp',
      url,
      '-o', outputPath,
      '--cookies', cookiesFile,
      '--no-playlist',
      '-f', 'mp4/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--max-filesize', '24M',
      '--quiet',
      '--no-warnings',
      '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    ];
    execFile('python3', args, { timeout: 90_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      resolve();
    });
  });
}

async function downloadInstagramReel(url, tmpFile) {
  if (!fs.existsSync(IG_COOKIES_FILE)) {
    throw new Error('Missing data/instagram_cookies.txt — upload your Instagram cookies via Pebble File Manager');
  }
  await runYtDlp(url, tmpFile, IG_COOKIES_FILE);
}

// ── Download video and return Discord payload ─────────────────────────────────
async function buildVideoPost(url, authorId, platform) {
  const tmpFile = path.join(os.tmpdir(), `blbot_${Date.now()}.mp4`);

  try {
    if (platform === 'tiktok') {
      const videoUrl = await getTikTokVideoUrl(url);
      await downloadFile(videoUrl, tmpFile);
    } else if (platform === 'instagram') {
      await downloadInstagramReel(url, tmpFile);
    }

    const stat = fs.statSync(tmpFile);
    if (stat.size > MAX_FILE_BYTES) {
      fs.unlinkSync(tmpFile);
      console.warn(`[LinkEmbed] ${platform} too large (${(stat.size / 1024 / 1024).toFixed(1)} MB), skipping`);
      return null;
    }
    if (stat.size === 0) {
      fs.unlinkSync(tmpFile);
      throw new Error('downloaded file is empty');
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

// ── Twitter → fixupx plain URL ────────────────────────────────────────────────
function buildTwitterPost(url, authorId) {
  const fixUrl = url
    .replace(/(?:www\.)?x\.com/, 'fixupx.com')
    .replace(/(?:www\.)?twitter\.com/, 'fixupx.com');
  return { content: `<@${authorId}>\n${fixUrl}` };
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
