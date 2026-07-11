'use strict';

const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const { execFile } = require('child_process');
const { Scraper } = require('@the-convocation/twitter-scraper');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');

// ── Config ────────────────────────────────────────────────────────────────────
// Add or remove accounts here. Each needs a username (X handle) and display name.
// All posts go to the same CHANNEL_ID.
const CHANNEL_ID = '1437107048348123136';

const ACCOUNTS = [
  {
    username:    'Michael8uo2',
    displayName: 'Mori',
  },
  {
    username:    'Emmaoinkk',
    displayName: 'Emma 🐷',
  },
];

// Base interval per account. Each account is polled on its OWN independent
// schedule, offset from the others, so one account having an issue does not
// block/delay the other.
const BASE_INTERVAL_MS = 20 * 60 * 1000; // 20 min base — authenticated calls have
                                          // much higher limits than the old
                                          // anonymous syndication endpoint.
const JITTER_MS        = 5 * 60 * 1000;  // ± up to 5 min random jitter
const MAX_BACKOFF_MS   = 3 * 60 * 60 * 1000; // cap backoff at 3h
const MIN_BACKOFF_MS   = 10 * 60 * 1000; // first backoff step 10 min
const MAX_NEW_PER_POLL = 5;

const STATE_FILE = path.join(__dirname, '../data/twitter_tracker.json');

// ── Cookie-based auth ──────────────────────────────────────────────────────────
// Upload your X/Twitter cookies via Pebble File Manager as:
//     data/twitter_cookies.txt
// This matches the same pattern already used for data/instagram_cookies.txt.
//
// Easiest way to get this file: install a browser extension like
// "Get cookies.txt LOCALLY", log into x.com, and export cookies for that
// site — it saves in the standard Netscape cookies.txt format, which is
// exactly what this reads. Just upload that exported file to data/twitter_cookies.txt
// via Pebble's File Manager.
//
// ⚠️ SECURITY: this file is equivalent to being logged into that X account.
// It's already excluded via .gitignore (like instagram_cookies.txt) so it
// won't get pushed to GitHub — but treat it like a password regardless.
// Ideally use a secondary/throwaway X account rather than a personal main
// account, since automated use of any account carries some risk of that
// account being flagged by X.
const TWITTER_COOKIES_FILE = path.join(__dirname, '../data/twitter_cookies.txt');

// Parses the standard Netscape cookies.txt format (what browser export
// extensions produce) into "name=value" strings tough-cookie can parse.
function parseNetscapeCookiesFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const cookieStrings = [];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // Lines can be prefixed with "#HttpOnly_" and are still valid data lines.
    if (line.startsWith('#HttpOnly_')) {
      line = line.slice('#HttpOnly_'.length);
    } else if (line.startsWith('#')) {
      continue; // regular comment line
    }

    const cols = line.split('\t');
    if (cols.length < 7) continue;

    const [, , , , , name, value] = cols;
    if (!name) continue;

    cookieStrings.push(`${name}=${value}`);
  }

  return cookieStrings;
}

const scraper = new Scraper();
let scraperReady = false;

async function initScraper() {
  if (!fs.existsSync(TWITTER_COOKIES_FILE)) {
    console.error('🐦 [TwitterTracker] Missing data/twitter_cookies.txt — upload your X/Twitter cookies via Pebble File Manager. See comments in utils/twitterTracker.js for instructions.');
    return false;
  }

  try {
    const cookieStrings = parseNetscapeCookiesFile(TWITTER_COOKIES_FILE);

    if (!cookieStrings.length) {
      console.error('🐦 [TwitterTracker] data/twitter_cookies.txt exists but no valid cookies could be parsed from it. Make sure it was exported in Netscape cookies.txt format.');
      return false;
    }

    await scraper.setCookies(cookieStrings);
    const loggedIn = await scraper.isLoggedIn();

    if (!loggedIn) {
      console.error('🐦 [TwitterTracker] Logged in check FAILED — cookies may be expired or invalid. Re-export fresh cookies from your browser and re-upload data/twitter_cookies.txt.');
      return false;
    }

    console.log('🐦 [TwitterTracker] ✅ Authenticated successfully via cookies.');
    return true;
  } catch (err) {
    console.error('🐦 [TwitterTracker] Error setting up cookie auth:', err.message);
    return false;
  }
}

// ── Persistence ───────────────────────────────────────────────────────────────
// State is keyed by username: { "Michael8uo2": { lastTweetId, backoffMs, failCount } }
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return {};
}

function saveState(state) {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[TwitterTracker] State save error:', e.message);
  }
}

function getAccountState(state, username) {
  const existing = state[username];
  // Migrate any older state formats automatically
  if (typeof existing === 'string') {
    state[username] = { lastTweetId: existing, backoffMs: 0, failCount: 0 };
  } else if (!existing || typeof existing !== 'object') {
    state[username] = { lastTweetId: null, backoffMs: 0, failCount: 0 };
  }
  return state[username];
}

// ── Fetch timeline for one account (authenticated, no proxies needed) ────────
async function fetchTimeline(username) {
  const raw = [];
  // getTweets is an AsyncGenerator, most-recent-first. Pull a small batch —
  // enough to skip past a pinned tweet/retweets/replies and still find
  // genuinely new original tweets.
  for await (const tweet of scraper.getTweets(username, 15)) {
    raw.push(tweet);
    if (raw.length >= 15) break;
  }

  const tweets = [];
  for (const t of raw) {
    if (!t.id) continue;
    if (t.isPin) continue;      // pinned tweet isn't necessarily the latest
    if (t.isRetweet) continue;
    if (t.isReply) continue;

    const images = (t.photos || []).map(p => p.url).filter(Boolean);
    const videoUrl = (t.videos && t.videos.length) ? t.videos[0].url : null;

    tweets.push({
      tweetId: t.id,
      tweetUrl: t.permanentUrl || `https://x.com/${username}/status/${t.id}`,
      text: (t.text || '').replace(/https?:\/\/t\.co\/\S+/g, '').trim(),
      images,
      videoUrl,
      pubDate: t.timeParsed || (t.timestamp ? new Date(t.timestamp * 1000) : null),
    });
  }

  // Sort newest-first by tweet ID (Twitter IDs are roughly chronological and
  // this avoids ever trusting positional order, which is what broke things
  // with the old syndication endpoint's pinned-tweet-first behavior).
  tweets.sort((a, b) => (BigInt(b.tweetId) > BigInt(a.tweetId) ? 1 : -1));

  return tweets;
}

// ── Discord embed ─────────────────────────────────────────────────────────────
function buildEmbed(tweet, account) {
  const avatarUrl = `https://unavatar.io/x/${account.username}`;
  const embed = new EmbedBuilder()
    .setColor(0x000000)
    .setAuthor({
      name:    `${account.displayName} just tweeted:`,
      iconURL: avatarUrl,
      url:     tweet.tweetUrl,
    })
    .setTimestamp(tweet.pubDate || new Date())
    .setFooter({ text: `@${account.username}  •  X (Twitter)` });

  if (tweet.text)           embed.setDescription(tweet.text.slice(0, 4096));
  if (tweet.images.length)  embed.setImage(tweet.images[0]);

  return embed;
}

function buildRow(tweet) {
  const fixUrl = tweet.tweetUrl.replace('x.com', 'fixupx.com');
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('View on X')
      .setURL(tweet.tweetUrl)
      .setStyle(ButtonStyle.Link)
      .setEmoji({ name: '🐦' }),
    new ButtonBuilder()
      .setLabel('Embed / Video')
      .setURL(fixUrl)
      .setStyle(ButtonStyle.Link)
      .setEmoji({ name: '▶️' }),
  );
}

// Discord's default (non-boosted) upload limit is 10MB. Stay safely under
// that since we don't know the server's boost tier; if a video is bigger
// than this, fall back to posting the plain link instead of failing silently.
const MAX_ATTACHMENT_BYTES = 9 * 1024 * 1024; // 9MB safety margin

function fetchBuffer(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_ATTACHMENT_BYTES * 1.5) {
          req.destroy();
          return reject(new Error('TOO_LARGE'));
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Posts one tweet to the channel. If it has a video/GIF, we download it
// server-side and upload it as a native Discord attachment (no visible
// link at all — Discord embeds can't play video via setImage, and
// spoiler-wrapping a link suppresses the auto-embed entirely, so a native
// upload is the only way to get both "no visible URL" and working playback).
// Falls back to a plain link if the file is too large or the download fails.
async function postTweet(channel, tweet, account) {
  await channel.send({ embeds: [buildEmbed(tweet, account)], components: [buildRow(tweet)] });

  if (tweet.videoUrl) {
    let mp4Buffer;
    try {
      mp4Buffer = await fetchBuffer(tweet.videoUrl);
    } catch (err) {
      console.warn(`[TwitterTracker] Could not download media for ${tweet.tweetId} (${err.message}) — falling back to link.`);
      await channel.send({ content: tweet.videoUrl });
      return;
    }

    // Try to convert genuine (silent) GIFs into a real animated .gif so they
    // auto-loop with no player controls, like an actual GIF in Discord.
    // Real videos (with audio) are left as-is and uploaded as mp4.
    let gifBuffer = null;
    if (await checkFfmpegAvailable()) {
      try {
        ensureTmpDir();
        const probePath = path.join(TMP_DIR, `${tweet.tweetId}_probe.mp4`);
        fs.writeFileSync(probePath, mp4Buffer);
        const isSilent = !(await hasAudioTrack(probePath));
        try { fs.unlinkSync(probePath); } catch { /* ignore */ }

        if (isSilent) {
          gifBuffer = await convertToGif(mp4Buffer, tweet.tweetId);
        }
      } catch (err) {
        console.warn(`[TwitterTracker] GIF detection/conversion error for ${tweet.tweetId}: ${err.message}`);
      }
    }

    try {
      if (gifBuffer && gifBuffer.length <= MAX_ATTACHMENT_BYTES) {
        await channel.send({ files: [new AttachmentBuilder(gifBuffer, { name: `${tweet.tweetId}.gif` })] });
        return;
      }
      if (gifBuffer) {
        console.warn(`[TwitterTracker] Converted GIF for ${tweet.tweetId} too large (${gifBuffer.length} bytes) — falling back to mp4.`);
      }

      if (mp4Buffer.length <= MAX_ATTACHMENT_BYTES) {
        await channel.send({ files: [new AttachmentBuilder(mp4Buffer, { name: `${tweet.tweetId}.mp4` })] });
        return;
      }

      throw new Error('TOO_LARGE');
    } catch (err) {
      console.warn(`[TwitterTracker] Could not upload media natively for ${tweet.tweetId} (${err.message}) — falling back to link.`);
      await channel.send({ content: tweet.videoUrl });
    }
  }
}

// ── GIF detection + conversion ────────────────────────────────────────────────
// X no longer hosts true .gif files — everything (real videos AND GIFs) gets
// served as mp4. But X-originated GIFs are always silent (no audio track),
// while real videos usually have one. We use that as the signal: only silent
// clips get converted to an actual animated .gif (so they auto-loop with no
// player controls, like a real GIF); videos with audio stay as mp4 uploads
// since converting those would destructively strip their sound.
const TMP_DIR = path.join(__dirname, '../tmp');

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function runFfmpegTool(bin, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 20 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

let ffmpegAvailable = null; // cached after first check

async function checkFfmpegAvailable() {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    await runFfmpegTool('ffmpeg', ['-version'], 5000);
    await runFfmpegTool('ffprobe', ['-version'], 5000);
    ffmpegAvailable = true;
    console.log('[TwitterTracker] ffmpeg/ffprobe available — GIF conversion enabled.');
  } catch {
    ffmpegAvailable = false;
    console.warn('[TwitterTracker] ffmpeg/ffprobe not available on this host — GIFs will upload as mp4 instead of true GIFs.');
  }
  return ffmpegAvailable;
}

async function hasAudioTrack(filePath) {
  const out = await runFfmpegTool('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', filePath,
  ], 10000);
  return out.split('\n').map(s => s.trim()).includes('audio');
}

// Converts a silent mp4 buffer into an animated GIF buffer via ffmpeg's
// two-pass palette method (much better quality/size than naive single-pass).
// Returns null on any failure so the caller can fall back to mp4 upload.
async function convertToGif(mp4Buffer, id) {
  ensureTmpDir();
  const inputPath   = path.join(TMP_DIR, `${id}_in.mp4`);
  const palettePath = path.join(TMP_DIR, `${id}_palette.png`);
  const outputPath  = path.join(TMP_DIR, `${id}_out.gif`);

  try {
    fs.writeFileSync(inputPath, mp4Buffer);

    await runFfmpegTool('ffmpeg', [
      '-i', inputPath,
      '-vf', 'fps=15,scale=480:-1:flags=lanczos,palettegen',
      '-y', palettePath,
    ]);

    await runFfmpegTool('ffmpeg', [
      '-i', inputPath,
      '-i', palettePath,
      '-filter_complex', 'fps=15,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse',
      '-y', outputPath,
    ]);

    return fs.readFileSync(outputPath);
  } catch (err) {
    console.warn(`[TwitterTracker] GIF conversion failed for ${id}: ${err.message}`);
    return null;
  } finally {
    for (const p of [inputPath, palettePath, outputPath]) {
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }
}


// Returns the delay (ms) to wait before polling this account again.
async function pollAccount(account, channel, state) {
  const username = account.username;
  const acctState = getAccountState(state, username);

  console.log(`[TwitterTracker] Polling @${username}...`);

  let items;
  try {
    items = await fetchTimeline(username);
  } catch (err) {
    acctState.failCount = (acctState.failCount || 0) + 1;
    acctState.backoffMs = Math.min(
      (acctState.backoffMs || MIN_BACKOFF_MS) * 2,
      MAX_BACKOFF_MS,
    );
    console.error(`[TwitterTracker] @${username} fetch error (fail #${acctState.failCount}): ${err.message} — next retry in ~${Math.round((BASE_INTERVAL_MS + acctState.backoffMs) / 60000)} min`);
    saveState(state);
    return BASE_INTERVAL_MS + acctState.backoffMs + Math.floor(Math.random() * JITTER_MS);
  }

  // Success — reset backoff/failcount
  acctState.backoffMs = 0;
  acctState.failCount = 0;

  if (!items.length) {
    console.log(`[TwitterTracker] @${username} checked — no original tweets found (all pinned/retweets/replies, or empty timeline)`);
    saveState(state);
    return BASE_INTERVAL_MS + Math.floor(Math.random() * JITTER_MS);
  }

  const lastId = acctState.lastTweetId;

  // First run for this account — just bookmark, don't post
  if (!lastId) {
    acctState.lastTweetId = items[0].tweetId;
    saveState(state);
    console.log(`[TwitterTracker] First run — bookmarked @${username} tweet ${items[0].tweetId}`);
    return BASE_INTERVAL_MS + Math.floor(Math.random() * JITTER_MS);
  }

  const newTweets = [];
  for (const item of items) {
    if (item.tweetId === lastId) break;
    newTweets.push(item);
  }

  if (newTweets.length) {
    acctState.lastTweetId = items[0].tweetId;
    saveState(state);

    const toPost = newTweets.reverse().slice(-MAX_NEW_PER_POLL);
    for (const tweet of toPost) {
      try {
        await postTweet(channel, tweet, account);
        console.log(`[TwitterTracker] ✅ Posted @${username} tweet ${tweet.tweetId}`);
        await new Promise(r => setTimeout(r, 1200));
      } catch (err) {
        console.error(`[TwitterTracker] Send error (@${username} ${tweet.tweetId}):`, err.message);
      }
    }
  } else {
    console.log(`[TwitterTracker] @${username} checked — no new tweets (latest seen: ${items[0].tweetId}, tracking since: ${lastId})`);
    saveState(state);
  }

  return BASE_INTERVAL_MS + Math.floor(Math.random() * JITTER_MS);
}

// ── Start ─────────────────────────────────────────────────────────────────────
let _started = false;

function scheduleAccountLoop(account, client, state, initialDelayMs) {
  const loop = async () => {
    const channel = client.channels.cache.get(CHANNEL_ID);
    let nextDelay = BASE_INTERVAL_MS + Math.floor(Math.random() * JITTER_MS);

    if (!channel) {
      console.error(`[TwitterTracker] Channel ${CHANNEL_ID} not found — retrying in 10 min`);
      nextDelay = 10 * 60 * 1000;
    } else if (!scraperReady) {
      console.error(`[TwitterTracker] Not authenticated — skipping @${account.username} poll, retrying in 10 min`);
      nextDelay = 10 * 60 * 1000;
    } else {
      try {
        nextDelay = await pollAccount(account, channel, state);
      } catch (err) {
        console.error(`[TwitterTracker] Unexpected error for @${account.username}:`, err.message);
      }
    }

    setTimeout(loop, nextDelay);
  };

  setTimeout(loop, initialDelayMs);
}

async function startTracker(client) {
  if (_started) return;
  _started = true;

  const names = ACCOUNTS.map(a => `@${a.username}`).join(', ');
  console.log(`🐦 [TwitterTracker] Starting up — will track ${names} → channel #${CHANNEL_ID}`);

  scraperReady = await initScraper();

  const state = loadState();

  if (!scraperReady) {
    console.error('🐦 [TwitterTracker] Skipping normal poll scheduling until authentication succeeds. Set TWITTER_COOKIES and restart the bot.');
    return;
  }

  console.log(`🐦 [TwitterTracker] Tracking ${names} (independent ~${BASE_INTERVAL_MS / 60000} min schedules per account)`);

  ACCOUNTS.forEach((account, i) => {
    const stagger = 20_000 + (i * (5 * 60 * 1000) / Math.max(ACCOUNTS.length, 1));
    scheduleAccountLoop(account, client, state, stagger);
  });
}

module.exports = { startTracker };
