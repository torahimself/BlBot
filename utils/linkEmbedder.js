'use strict';

// Role required to trigger link embedding (testing role)
const EMBED_ROLE_ID = '1502603423923699833';

// ── Proxy services ────────────────────────────────────────────────────────────
// Twitter/X    → fxtwitter.com  /  fixupx.com  (reliable, maintained)
// TikTok       → tnktok.com                    (replaced unreliable vxtiktok)
// Instagram    → instagramez.com               (replaced unreliable ddinstagram)
// ─────────────────────────────────────────────────────────────────────────────
// To swap a proxy later, just change the string below — nothing else needs editing.
const PROXY = {
  tiktok:    'tnktok.com',
  instagram: 'instagramez.com',
};

// ── Three focused regexes (one per platform, easy to read/debug) ──────────────

// Matches twitter.com and x.com URLs
const TWITTER_RE = /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s<>"')]+/gi;

// Matches all TikTok URL formats: www, vm (short link), vt (another short variant)
const TIKTOK_RE  = /https?:\/\/(?:(?:vm|vt|www)\.)?tiktok\.com\/[^\s<>"')]+/gi;

// Matches Instagram posts, reels, reels (plural), TV, stories
const INSTA_RE   = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv|stories)\/[^\s<>"')]+/gi;

// ── Transform helpers ─────────────────────────────────────────────────────────

function transformTwitter(url) {
  // x.com → fixupx.com, twitter.com → fxtwitter.com
  if (/\/\/(?:www\.)?x\.com\//i.test(url)) {
    return url.replace(/(?:www\.)?x\.com/, 'fixupx.com');
  }
  return url.replace(/(?:www\.)?twitter\.com/, 'fxtwitter.com');
}

function transformTikTok(url) {
  // Preserves any subdomain (vm., vt., www.) — just swaps the domain name
  return url.replace(/tiktok\.com/, PROXY.tiktok);
}

function transformInstagram(url) {
  return url.replace(/(?:www\.)?instagram\.com/, PROXY.instagram);
}

// ── Main rewrite function ─────────────────────────────────────────────────────

function rewriteLinks(content) {
  let result  = content;
  let found   = false;

  // Reset all regex lastIndex (they're global)
  const reset = () => {
    TWITTER_RE.lastIndex = 0;
    TIKTOK_RE.lastIndex  = 0;
    INSTA_RE.lastIndex   = 0;
  };

  reset();

  if (TWITTER_RE.test(result)) {
    TWITTER_RE.lastIndex = 0;
    result = result.replace(TWITTER_RE, url => {
      found = true;
      return transformTwitter(url.replace(/[.,;!?)>\]]+$/, ''));
    });
  }
  TWITTER_RE.lastIndex = 0;

  if (TIKTOK_RE.test(result)) {
    TIKTOK_RE.lastIndex = 0;
    result = result.replace(TIKTOK_RE, url => {
      found = true;
      return transformTikTok(url.replace(/[.,;!?)>\]]+$/, ''));
    });
  }
  TIKTOK_RE.lastIndex = 0;

  if (INSTA_RE.test(result)) {
    INSTA_RE.lastIndex = 0;
    result = result.replace(INSTA_RE, url => {
      found = true;
      return transformInstagram(url.replace(/[.,;!?)>\]]+$/, ''));
    });
  }
  INSTA_RE.lastIndex = 0;

  return found ? result : null;
}

// ── Discord message handler ───────────────────────────────────────────────────

async function handleLinkEmbed(message) {
  if (!message.guild || !message.channel?.isTextBased()) return false;
  if (message.author.bot) return false;

  const member = message.member;
  if (!member?.roles?.cache?.has(EMBED_ROLE_ID)) return false;

  const rewritten = rewriteLinks(message.content);
  if (!rewritten) return false;

  const displayName = member.displayName || message.author.username;
  const repost = `📎 **${displayName}:**\n${rewritten}`;

  // Delete original first — if we lack permission, abort cleanly
  try {
    await message.delete();
  } catch (err) {
    if (err.code === 50013) {
      console.warn(`⚠️ [LinkEmbed] Missing MANAGE_MESSAGES in #${message.channel.name}`);
    } else {
      console.error(`❌ [LinkEmbed] Delete failed:`, err.message);
    }
    return false;
  }

  try {
    await message.channel.send(repost);
    console.log(`🔗 [LinkEmbed] Reposted ${displayName}'s link in #${message.channel.name}`);
    return true;
  } catch (err) {
    console.error(`❌ [LinkEmbed] Send failed:`, err.message);
    return false;
  }
}

module.exports = { handleLinkEmbed };
