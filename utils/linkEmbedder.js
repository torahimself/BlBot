'use strict';

// Role required to trigger link embedding (testing role)
const EMBED_ROLE_ID = '1502603423923699833';

// ── URL proxy services ────────────────────────────────────────────────────────
// Twitter/X    → fxtwitter  / fixupx   (adds proper video embed)
// TikTok       → vxtiktok              (adds proper video embed)
// Instagram    → ddinstagram           (adds proper video embed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Single regex that matches ALL supported platform URLs in one pass.
 * Using [^\s<>"']* instead of \S+ to avoid swallowing trailing punctuation.
 */
const LINK_REGEX =
  /https?:\/\/(?:(?:www\.)?(?:twitter\.com|x\.com|instagram\.com\/(?:p|reel|tv))|(?:(?:vm|vt|www)\.)?tiktok\.com)\/[^\s<>"']*/gi;

/**
 * Transform a single matched URL to its embed-friendly proxy equivalent.
 * Called inside a regex replace callback so no global-state concerns.
 */
function transformUrl(rawUrl) {
  // Trim trailing punctuation that the regex may have captured
  const url = rawUrl.replace(/[.,;!?)>\]]+$/, '');

  if (/twitter\.com/i.test(url)) {
    // twitter.com → fxtwitter.com
    return url.replace(/(?:www\.)?twitter\.com/, 'fxtwitter.com');
  }

  if (/x\.com/i.test(url)) {
    // x.com → fixupx.com
    return url.replace(/(?:www\.)?x\.com/, 'fixupx.com');
  }

  if (/(?:vm|vt)\.tiktok\.com/i.test(url)) {
    // vm.tiktok.com / vt.tiktok.com → vt.vxtiktok.com  (short-link format)
    return url.replace(/(?:vm|vt)\.tiktok\.com/, 'vt.vxtiktok.com');
  }

  if (/tiktok\.com/i.test(url)) {
    // www.tiktok.com / tiktok.com → vxtiktok.com
    return url.replace(/(?:www\.)?tiktok\.com/, 'vxtiktok.com');
  }

  if (/instagram\.com/i.test(url)) {
    // instagram.com → ddinstagram.com
    return url.replace(/(?:www\.)?instagram\.com/, 'ddinstagram.com');
  }

  return url; // fallback (shouldn't reach here)
}

/**
 * Check if content contains any supported link and, if so,
 * return the rewritten content with all links proxied.
 * Returns null when no supported link is found.
 */
function rewriteLinks(content) {
  LINK_REGEX.lastIndex = 0;
  if (!LINK_REGEX.test(content)) {
    LINK_REGEX.lastIndex = 0;
    return null;
  }
  LINK_REGEX.lastIndex = 0;

  const rewritten = content.replace(LINK_REGEX, transformUrl);
  LINK_REGEX.lastIndex = 0;
  return rewritten;
}

/**
 * Main entry point — call from the messageCreate event.
 * Deletes the original message and reposts it with embed-friendly URLs.
 * @returns {boolean} true if the message was intercepted.
 */
async function handleLinkEmbed(message) {
  // Only in guild text channels
  if (!message.guild || !message.channel?.isTextBased()) return false;
  if (message.author.bot) return false;

  // Role gate
  const member = message.member;
  if (!member?.roles?.cache?.has(EMBED_ROLE_ID)) return false;

  // Fast-path: no supported link in this message
  const rewritten = rewriteLinks(message.content);
  if (!rewritten) return false;

  const displayName = member.displayName || message.author.username;
  const repost = `📎 **${displayName}:**\n${rewritten}`;

  // Delete original — if no permission, abort so we don't spam a duplicate
  try {
    await message.delete();
  } catch (err) {
    if (err.code === 50013) {
      console.warn(`⚠️ [LinkEmbed] Bot lacks MANAGE_MESSAGES in #${message.channel.name} — skipping.`);
    } else {
      console.error(`❌ [LinkEmbed] Delete failed:`, err.message);
    }
    return false;
  }

  // Repost with proxied URLs (Discord will auto-embed the video)
  try {
    await message.channel.send(repost);
    console.log(`🔗 [LinkEmbed] Reposted link from ${displayName} in #${message.channel.name}`);
    return true;
  } catch (err) {
    console.error(`❌ [LinkEmbed] Send failed:`, err.message);
    return false;
  }
}

module.exports = { handleLinkEmbed };
