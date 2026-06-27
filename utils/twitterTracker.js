'use strict';

const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// ── Config ────────────────────────────────────────────────────────────────────
const USERNAME     = 'Emmaoinkk';
const DISPLAY_NAME = 'Emma';
const CHANNEL_ID   = '1437107048348123136';
const AVATAR_URL   = `https://unavatar.io/x/${USERNAME}`;
const POLL_MS      = 5 * 60 * 1000;   // every 5 minutes
const MAX_NEW_PER_POLL = 5;            // safety cap: don't flood on catch-up

// RSS sources tried in order — first success wins
const RSS_SOURCES = [
  `https://rsshub.app/twitter/user/${USERNAME}`,
  `https://nitter.privacydev.net/${USERNAME}/rss`,
  `https://nitter.poast.org/${USERNAME}/rss`,
  `https://xcancel.com/${USERNAME}/rss`,
];

const STATE_FILE = path.join(__dirname, '../data/twitter_tracker.json');

// ── Persistence ───────────────────────────────────────────────────────────────
function loadLastId() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).lastTweetId || null;
    }
  } catch { /* ignore */ }
  return null;
}

function saveLastId(id) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastTweetId: id }, null, 2));
  } catch (e) {
    console.error('[TwitterTracker] State save error:', e.message);
  }
}

// ── HTTP fetch (follows redirects, timeout) ───────────────────────────────────
function fetchUrl(url, ttl = 12_000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      timeout: ttl,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0)' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, ttl).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── RSS parsing ───────────────────────────────────────────────────────────────
function tagContent(xml, tag) {
  // Try CDATA first, then plain
  const cdataRe = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const plainRe = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(cdataRe) || xml.match(plainRe);
  return m ? m[1].trim() : '';
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractImages(html) {
  const out = [];
  const re = /<img[^>]+src="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let url = m[1];
    // Skip emoji / tiny images
    if (/emoji|_normal\.|_mini\.|profile_image/i.test(url)) continue;
    // Convert nitter /pic/media proxy → pbs.twimg.com
    const mediaMatch = url.match(/\/pic\/media[%2F/]+(.+)/i);
    if (mediaMatch) {
      url = `https://pbs.twimg.com/media/${decodeURIComponent(mediaMatch[1])}`;
    }
    // Skip remaining relative URLs
    if (!url.startsWith('http')) continue;
    out.push(url);
  }
  return out;
}

function parseTweetId(url) {
  const m = (url || '').match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}

function parseRss(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1];
    const rawTitle  = tagContent(raw, 'title');
    const desc      = tagContent(raw, 'description');
    const link      = tagContent(raw, 'link');
    const pubDate   = tagContent(raw, 'pubDate');
    const tweetId   = parseTweetId(link) || parseTweetId(tagContent(raw, 'guid'));
    if (!tweetId) continue;

    // Tweet text — strip "Username: " prefix and any HTML
    const titleText = rawTitle.replace(/^[^:]+:\s*/, '').trim();
    const descText  = stripHtml(desc);
    const text      = descText.length > titleText.length ? descText : titleText;

    // Skip retweets and replies
    if (/^RT @/i.test(text) || text.startsWith('@')) continue;

    const tweetUrl = `https://x.com/${USERNAME}/status/${tweetId}`;
    const images   = extractImages(desc);

    items.push({ tweetId, tweetUrl, text, images, pubDate });
  }
  return items;
}

// ── Discord embed ─────────────────────────────────────────────────────────────
function buildEmbed(tweet) {
  const embed = new EmbedBuilder()
    .setColor(0x000000)
    .setAuthor({
      name: `${DISPLAY_NAME} just tweeted:`,
      iconURL: AVATAR_URL,
      url: tweet.tweetUrl,
    })
    .setTimestamp(tweet.pubDate ? new Date(tweet.pubDate) : new Date())
    .setFooter({ text: `@${USERNAME}  •  X (Twitter)` });

  if (tweet.text) {
    embed.setDescription(tweet.text.slice(0, 4096));
  }
  if (tweet.images.length > 0) {
    embed.setImage(tweet.images[0]);
  }

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

// ── Polling ───────────────────────────────────────────────────────────────────
async function fetchTweets() {
  let lastErr;
  for (const src of RSS_SOURCES) {
    try {
      const xml = await fetchUrl(src);
      if (xml && xml.includes('<item>')) return parseRss(xml);
    } catch (err) {
      lastErr = err;
      console.warn(`[TwitterTracker] Source failed (${src}): ${err.message}`);
    }
  }
  throw lastErr || new Error('All RSS sources failed');
}

async function poll(client) {
  try {
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (!channel) return; // not cached yet — will succeed next poll

    const items = await fetchTweets();
    if (!items.length) return;

    const lastId = loadLastId();

    // First ever run — just bookmark latest, don't post old tweets
    if (!lastId) {
      saveLastId(items[0].tweetId);
      console.log(`[TwitterTracker] First run — bookmarked @${USERNAME} tweet ${items[0].tweetId}`);
      return;
    }

    // Collect tweets newer than the last seen one
    const newTweets = [];
    for (const item of items) {
      if (item.tweetId === lastId) break;
      newTweets.push(item);
    }

    if (!newTweets.length) return;

    // Update bookmark
    saveLastId(items[0].tweetId);

    // Post oldest-first, with safety cap
    const toPost = newTweets.reverse().slice(-MAX_NEW_PER_POLL);
    for (const tweet of toPost) {
      try {
        await channel.send({
          embeds:     [buildEmbed(tweet)],
          components: [buildRow(tweet)],
        });
        console.log(`[TwitterTracker] Posted @${USERNAME} tweet ${tweet.tweetId}`);
        await new Promise(r => setTimeout(r, 1200));
      } catch (err) {
        console.error(`[TwitterTracker] Send error (${tweet.tweetId}):`, err.message);
      }
    }
  } catch (err) {
    console.error('[TwitterTracker] Poll error:', err.message);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
let _started = false;

function startTracker(client) {
  if (_started) return;
  _started = true;

  console.log(`🐦 [TwitterTracker] Tracking @${USERNAME} → #${CHANNEL_ID} (every ${POLL_MS / 60000} min)`);

  // First poll after 20 s (let channel cache settle)
  setTimeout(() => poll(client), 20_000);
  setInterval(() => poll(client), POLL_MS);
}

module.exports = { startTracker };
