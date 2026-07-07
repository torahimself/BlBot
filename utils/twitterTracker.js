'use strict';

const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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

const POLL_MS          = 45 * 60 * 1000; // 45 minutes base
const MAX_NEW_PER_POLL = 5;

const STATE_FILE = path.join(__dirname, '../data/twitter_tracker.json');

// ── Persistence ───────────────────────────────────────────────────────────────
// State is keyed by username: { "Michael8uo2": "lastTweetId", ... }
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

// ── HTTP GET → text (follows redirects) ──────────────────────────────────────
function fetchHtml(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control':   'no-cache',
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

// ── Fetch timeline for one account ───────────────────────────────────────────
async function fetchTimeline(username) {
  const url  = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${username}`;
  const html = await fetchHtml(url);

  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]*)<\/script>/);
  if (!match?.[1]) throw new Error('Could not find __NEXT_DATA__ in syndication response');

  const data    = JSON.parse(match[1]);
  const entries = data?.props?.pageProps?.timeline?.entries;
  if (!Array.isArray(entries)) throw new Error('No timeline entries found in response');

  const tweets = [];
  for (const entry of entries) {
    const t = entry?.content?.tweet;
    if (!t) continue;

    const tweetId = t.id_str || String(t.id);
    if (!tweetId) continue;

    // Skip retweets and replies
    if (t.retweeted_status) continue;
    if (t.in_reply_to_status_id_str) continue;
    if ((t.full_text || t.text || '').startsWith('RT @')) continue;

    const text     = (t.full_text || t.text || '').replace(/https?:\/\/t\.co\/\S+/g, '').trim();
    const tweetUrl = `https://x.com/${username}/status/${tweetId}`;
    const pubDate  = t.created_at;

    const images = [];
    const media  = t.entities?.media || t.extended_entities?.media || [];
    for (const m of media) {
      if (m.media_url_https) images.push(m.media_url_https);
    }

    tweets.push({ tweetId, tweetUrl, text, images, pubDate });
  }

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
    .setTimestamp(tweet.pubDate ? new Date(tweet.pubDate) : new Date())
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

// ── Poll one account ──────────────────────────────────────────────────────────
async function pollAccount(account, channel, state) {
  const username = account.username;
  let items;

  try {
    items = await fetchTimeline(username);
  } catch (err) {
    if (err.message.includes('429')) throw err; // bubble up for backoff
    console.error(`[TwitterTracker] Error fetching @${username}:`, err.message);
    return; // skip this account this round, don't crash others
  }

  if (!items.length) return;

  const lastId = state[username] || null;

  // First run for this account — just bookmark, don't post
  if (!lastId) {
    state[username] = items[0].tweetId;
    saveState(state);
    console.log(`[TwitterTracker] First run — bookmarked @${username} tweet ${items[0].tweetId}`);
    return;
  }

  const newTweets = [];
  for (const item of items) {
    if (item.tweetId === lastId) break;
    newTweets.push(item);
  }

  if (!newTweets.length) return;

  state[username] = items[0].tweetId;
  saveState(state);

  const toPost = newTweets.reverse().slice(-MAX_NEW_PER_POLL);
  for (const tweet of toPost) {
    try {
      await channel.send({ embeds: [buildEmbed(tweet, account)], components: [buildRow(tweet)] });
      console.log(`[TwitterTracker] ✅ Posted @${username} tweet ${tweet.tweetId}`);
      await new Promise(r => setTimeout(r, 1200));
    } catch (err) {
      console.error(`[TwitterTracker] Send error (@${username} ${tweet.tweetId}):`, err.message);
    }
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
let _started  = false;
let _backoffMs = 0;

function startTracker(client) {
  if (_started) return;
  _started = true;

  const names = ACCOUNTS.map(a => `@${a.username}`).join(', ');
  console.log(`🐦 [TwitterTracker] Tracking ${names} → channel #${CHANNEL_ID} (every ~${POLL_MS / 60000} min)`);

  const runPoll = async () => {
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (!channel) return;

    const state = loadState();
    let hit429  = false;

    for (const account of ACCOUNTS) {
      try {
        await pollAccount(account, channel, state);
        // small gap between accounts to avoid hammering the API
        await new Promise(r => setTimeout(r, 3000));
      } catch (err) {
        if (err.message.includes('429')) {
          hit429 = true;
          console.warn(`[TwitterTracker] Rate limited on @${account.username}`);
        } else {
          console.error(`[TwitterTracker] Unexpected error for @${account.username}:`, err.message);
        }
      }
    }

    return hit429;
  };

  const scheduleNext = (extraMs = 0) => {
    const jitter = Math.floor(Math.random() * 5 * 60 * 1000); // ±5 min jitter
    const delay  = POLL_MS + jitter + extraMs;
    setTimeout(async () => {
      try {
        const hit429 = await runPoll();
        if (hit429) {
          _backoffMs = Math.min((_backoffMs || 15 * 60 * 1000) * 2, 2 * 60 * 60 * 1000);
          console.warn(`[TwitterTracker] Backing off ${_backoffMs / 60000} extra min`);
          scheduleNext(_backoffMs);
        } else {
          _backoffMs = 0;
          scheduleNext();
        }
      } catch (err) {
        console.error('[TwitterTracker] Poll loop error:', err.message);
        scheduleNext();
      }
    }, delay);
  };

  // First poll after 60s to let Discord fully connect
  setTimeout(async () => {
    try {
      await runPoll();
    } catch (err) {
      if (err.message.includes('429')) {
        _backoffMs = 15 * 60 * 1000;
        console.warn(`[TwitterTracker] Rate limited on first poll — waiting ${_backoffMs / 60000} min extra`);
      } else {
        console.error('[TwitterTracker] First poll error:', err.message);
      }
    }
    scheduleNext(_backoffMs);
  }, 60_000);
}

module.exports = { startTracker };
