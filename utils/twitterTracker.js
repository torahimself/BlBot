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

// Base interval per account. Each account is polled on its OWN independent
// schedule, offset from the others, so one account getting rate-limited
// does not block/delay the other.
const BASE_INTERVAL_MS   = 60 * 60 * 1000;   // ~60 min base per account
const JITTER_MS          = 15 * 60 * 1000;   // ± up to 15 min random jitter
const MAX_BACKOFF_MS     = 6 * 60 * 60 * 1000; // cap backoff at 6h
const MIN_BACKOFF_MS     = 20 * 60 * 1000;   // first backoff step 20 min
const MAX_NEW_PER_POLL   = 5;

const STATE_FILE = path.join(__dirname, '../data/twitter_tracker.json');

// Rotate between a few realistic desktop user-agents to look less bot-like.
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Fetch methods tried in order. If the direct request gets blocked/rate-limited,
// we retry the SAME request routed through a public proxy, so it hits Twitter
// from a different IP instead of Bubblehost's (likely already-flagged) IP.
const FETCH_METHODS = [
  { name: 'direct',     build: (url) => url },
  { name: 'allorigins', build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
  { name: 'corsproxy',  build: (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}` },
];

// ── Persistence ───────────────────────────────────────────────────────────────
// State is keyed by username:
// { "Michael8uo2": { lastTweetId, backoffMs, failCount } }
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

  // Migrate old format where state[username] was just a plain tweetId string
  if (typeof existing === 'string') {
    state[username] = { lastTweetId: existing, backoffMs: 0, failCount: 0 };
  } else if (!existing || typeof existing !== 'object') {
    state[username] = { lastTweetId: null, backoffMs: 0, failCount: 0 };
  }

  return state[username];
}

// ── HTTP GET → text (follows redirects) ──────────────────────────────────────
function fetchHtml(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent':      randomUA(),
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control':   'no-cache',
        'Referer':         'https://twitter.com/',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHtml(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        const err = new Error(`HTTP ${res.statusCode}`);
        err.statusCode = res.statusCode;
        return reject(err);
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

// ── Fetch timeline for one account (tries direct, then proxy fallbacks) ──────
async function fetchTimeline(username) {
  // Cache-bust: syndication.twitter.com is fronted by a CDN that can serve a
  // stale snapshot for several minutes. Appending a changing query param
  // forces a fresh fetch instead of a cached one.
  const targetUrl = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${username}?dnt=1&_=${Date.now()}`;
  let lastErr;

  for (const method of FETCH_METHODS) {
    try {
      const html = await fetchHtml(method.build(targetUrl));

      const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]*)<\/script>/);
      if (!match?.[1]) throw new Error('Could not find __NEXT_DATA__ in response');

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

      if (method.name !== 'direct') {
        console.log(`[TwitterTracker] @${username} fetched via fallback proxy: ${method.name}`);
      }
      return tweets;
    } catch (err) {
      lastErr = err;
      // Only fall through to the next method on blocking-type errors.
      // (429 = rate limited, 403 = forbidden, timeout = likely also blocked)
      const isBlockingError = err.statusCode === 429 || err.statusCode === 403 || err.message === 'timeout';
      if (!isBlockingError) throw err; // real parsing/logic error, no point retrying via proxy
      // else: try next method in the loop
    }
  }

  throw lastErr;
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

    if (err.statusCode === 429 || err.statusCode === 403) {
      acctState.backoffMs = Math.min(
        (acctState.backoffMs || MIN_BACKOFF_MS) * 2,
        MAX_BACKOFF_MS,
      );
      console.warn(`[TwitterTracker] @${username} blocked/rate-limited on all methods (fail #${acctState.failCount}) — next retry in ~${Math.round((BASE_INTERVAL_MS + acctState.backoffMs) / 60000)} min`);
    } else {
      console.error(`[TwitterTracker] @${username} fetch error:`, err.message);
      // Non-429 errors get a smaller fixed backoff bump, not full exponential
      acctState.backoffMs = Math.min((acctState.backoffMs || 0) + 5 * 60 * 1000, MAX_BACKOFF_MS);
    }

    saveState(state);
    return BASE_INTERVAL_MS + acctState.backoffMs + Math.floor(Math.random() * JITTER_MS);
  }

  // Success — reset backoff/failcount
  acctState.backoffMs  = 0;
  acctState.failCount  = 0;

  if (!items.length) {
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
        await channel.send({ embeds: [buildEmbed(tweet, account)], components: [buildRow(tweet)] });
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
// Each account runs on its own independent loop/timer, staggered on startup,
// so a 429 on one account only affects that account's own schedule.
let _started = false;

function scheduleAccountLoop(account, client, state, initialDelayMs) {
  const loop = async () => {
    const channel = client.channels.cache.get(CHANNEL_ID);
    let nextDelay = BASE_INTERVAL_MS + Math.floor(Math.random() * JITTER_MS);

    if (!channel) {
      console.error(`[TwitterTracker] Channel ${CHANNEL_ID} not found — retrying in 10 min`);
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

function startTracker(client) {
  if (_started) return;
  _started = true;

  const names = ACCOUNTS.map(a => `@${a.username}`).join(', ');
  console.log(`🐦 [TwitterTracker] Tracking ${names} → channel #${CHANNEL_ID} (independent ~${BASE_INTERVAL_MS / 60000} min schedules per account)`);

  const state = loadState();

  // Stagger each account's first poll so they never hit the API at the exact
  // same moment (spread evenly across the first 10 minutes, plus 60s base delay).
  ACCOUNTS.forEach((account, i) => {
    const stagger = 60_000 + (i * (10 * 60 * 1000) / Math.max(ACCOUNTS.length, 1));
    scheduleAccountLoop(account, client, state, stagger);
  });
}

module.exports = { startTracker };
