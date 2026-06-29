'use strict';

const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// ── Config ────────────────────────────────────────────────────────────────────
const USERNAME     = 'Michael8uo2';
const DISPLAY_NAME = 'Mori';
const CHANNEL_ID   = '1437107048348123136';
const AVATAR_URL   = `https://unavatar.io/x/${USERNAME}`;
const POLL_MS      = 30 * 60 * 1000;
const MAX_NEW_PER_POLL = 5;

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
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastTweetId: id }, null, 2));
  } catch (e) {
    console.error('[TwitterTracker] State save error:', e.message);
  }
}

// ── HTTP GET → text (follows redirects) ──────────────────────────────────────
function fetchHtml(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHtml(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Fetch timeline from Twitter's own syndication API ─────────────────────────
// This is the same endpoint used by embedded Twitter widgets on websites.
// It returns HTML containing a __NEXT_DATA__ JSON blob with tweet data.
// No auth, no scraping third parties — this is Twitter's own public endpoint.
async function fetchTimeline() {
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${USERNAME}`;
  const html = await fetchHtml(url);

  // Extract the __NEXT_DATA__ JSON blob embedded in the page
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]*)<\/script>/);
  if (!match?.[1]) throw new Error('Could not find __NEXT_DATA__ in syndication response');

  const data = JSON.parse(match[1]);
  const entries = data?.props?.pageProps?.timeline?.entries;
  if (!Array.isArray(entries)) throw new Error('No timeline entries found in response');

  const tweets = [];
  for (const entry of entries) {
    const t = entry?.content?.tweet;
    if (!t) continue;

    const tweetId  = t.id_str || String(t.id);
    if (!tweetId) continue;

    // Skip retweets and replies
    if (t.retweeted_status) continue;
    if (t.in_reply_to_status_id_str) continue;
    if ((t.full_text || t.text || '').startsWith('RT @')) continue;

    const text     = (t.full_text || t.text || '').replace(/https?:\/\/t\.co\/\S+/g, '').trim();
    const tweetUrl = `https://x.com/${USERNAME}/status/${tweetId}`;
    const pubDate  = t.created_at;

    // Extract images from media entities
    const images = [];
    const media = t.entities?.media || t.extended_entities?.media || [];
    for (const m of media) {
      if (m.media_url_https) images.push(m.media_url_https);
    }

    tweets.push({ tweetId, tweetUrl, text, images, pubDate });
  }

  return tweets;
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

  if (tweet.text) embed.setDescription(tweet.text.slice(0, 4096));
  if (tweet.images.length > 0) embed.setImage(tweet.images[0]);

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
async function poll(client) {
  try {
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (!channel) return;

    const items = await fetchTimeline();
    if (!items.length) return;

    const lastId = loadLastId();

    if (!lastId) {
      saveLastId(items[0].tweetId);
      console.log(`[TwitterTracker] First run — bookmarked @${USERNAME} tweet ${items[0].tweetId}`);
      return;
    }

    const newTweets = [];
    for (const item of items) {
      if (item.tweetId === lastId) break;
      newTweets.push(item);
    }

    if (!newTweets.length) return;

    saveLastId(items[0].tweetId);

    const toPost = newTweets.reverse().slice(-MAX_NEW_PER_POLL);
    for (const tweet of toPost) {
      try {
        await channel.send({ embeds: [buildEmbed(tweet)], components: [buildRow(tweet)] });
        console.log(`[TwitterTracker] ✅ Posted @${USERNAME} tweet ${tweet.tweetId}`);
        await new Promise(r => setTimeout(r, 1200));
      } catch (err) {
        console.error(`[TwitterTracker] Send error (${tweet.tweetId}):`, err.message);
      }
    }
  } catch (err) {
    if (err.message.includes('429')) {
      console.warn('[TwitterTracker] Rate limited by X — will retry next poll cycle');
    } else {
      console.error('[TwitterTracker] Poll error:', err.message);
    }
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
let _started = false;

function startTracker(client) {
  if (_started) return;
  _started = true;
  console.log(`🐦 [TwitterTracker] Tracking @${USERNAME} via X syndication API → #${CHANNEL_ID} (every ~${POLL_MS / 60000} min)`);
  // Initial poll after 30s
  setTimeout(() => poll(client), 30_000);

  // Subsequent polls at 30 min ± up to 5 min jitter to avoid hitting rate limits
  const scheduleNext = () => {
    const jitter = Math.floor(Math.random() * 5 * 60 * 1000);
    setTimeout(() => { poll(client); scheduleNext(); }, POLL_MS + jitter);
  };
  setTimeout(scheduleNext, POLL_MS);
}

module.exports = { startTracker };
