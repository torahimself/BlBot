'use strict';
// Decides how many characters of a message are "eligible" for coins.
//
// Philosophy: a lightweight DENY-list, not a dictionary. Anything that looks
// like a normal Arabic or English message counts; obvious spam does not.
// Excluded messages are silently ignored — nobody is ever told.
//
// Eligible characters are the LETTERS AND DIGITS that survive cleaning
// (spaces, punctuation, links, mentions, emoji never count).

const settings = require('./settings');

const URL_RE = /(?:https?:\/\/|www\.)\S+/gi;
const MENTION_RE = /<(?:@[!&]?|#)\d+>/g;            // <@id> <@!id> <@&id> <#id>
const CUSTOM_EMOJI_RE = /<a?:\w+:\d+>/g;             // <:name:id> <a:name:id>
const TIMESTAMP_RE = /<t:\d+(?::[a-zA-Z])?>/g;
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200d\ufe0f\u20e3]/gu;
// Arabic harakat, Quranic marks and tatweel (ـ) — removed so they can't pad a count.
const ARABIC_MARKS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640]/g;
const EDGE_PUNCT_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const NON_ALNUM_RE = /[^\p{L}\p{N}]/gu;

// Bot-command style prefixes: "!play", ".help", "?rank", "$bal", "-p song" …
// ('>' is NOT here: it is Discord's quote syntax and is normal chat.)
const COMMAND_RE = /^[!.$%?\-+=;\/][A-Za-z0-9\u0600-\u06FF]/;

// ── Laughter ─────────────────────────────────────────────────────────────────
// Repeated laughter is common in Arabic and English chat. Inside a real message
// it is shrunk to a couple of characters; a message that is ONLY laughter earns
// nothing.
function isLaughter(w) {
  return (
    /^[يا]?[هخ]{2,}$/.test(w) ||             // هههههه  خخخخ  يهههه
    /^(?:ها){2,}ه?$/.test(w) ||             // هاهاها
    /^(?:ha){2,}h?$/.test(w) ||              // hahaha
    /^(?:he){2,}h?$/.test(w) ||              // hehehe
    /^h{2,}$/.test(w) ||                     // hhhh
    /^(?:lo+l+)+$/.test(w) ||                // lol  loool  lolol
    /^l+m+f?a+o+$/.test(w) ||                // lmao  lmfao
    /^x+d+$/.test(w) ||                      // xd  xdd
    /^(?:ja){2,}j?$/.test(w) ||              // jajaja
    /^k{3,}$/.test(w)                        // kkkk
  );
}

// ── Keyboard mashing ─────────────────────────────────────────────────────────
// Five keys in a row, left→right or right→left, on one keyboard row.
const KEY_ROWS = [
  'qwertyuiop', 'asdfghjkl', 'zxcvbnm',                 // Latin
  'ضصثقفغعهخحجد', 'شسيبلاتنمكط', 'ئءؤرلاىةوزظ',          // Arabic
];
const RUN = 5;
const KEY_RUNS = new Set();
for (const row of KEY_ROWS) {
  const chars = [...row];
  for (let i = 0; i + RUN <= chars.length; i++) {
    const seg = chars.slice(i, i + RUN);
    KEY_RUNS.add(seg.join(''));
    KEY_RUNS.add([...seg].reverse().join(''));
  }
}
function hasKeyboardRun(w) {
  const chars = [...w];
  for (let i = 0; i + RUN <= chars.length; i++) {
    if (KEY_RUNS.has(chars.slice(i, i + RUN).join(''))) return true;
  }
  return false;
}

// A token (already lower-cased, collapsed, letters/digits only) is junk if it
// is a huge blob, a handful of repeated characters, a keyboard run, or a long
// Latin string with no vowels.
function isJunk(w) {
  const chars = [...w];
  const len = chars.length;
  if (len > 30) return true;
  if (len >= 6 && new Set(chars).size / len <= 0.34) return true;   // abababab
  if (len >= RUN && hasKeyboardRun(w)) return true;                  // asdfgh / ضصثقف
  if (len >= 6 && /^[a-z]+$/.test(w) && !/[aeiouy]/.test(w)) return true;  // hjgfdss
  return false;
}

// "aaaaaa" → "aa"   (any character repeated 3+ times is shrunk to 2)
const collapse = (w) => w.replace(/(.)\1{2,}/gu, '$1$1');

/**
 * Pure function: how many characters of `content` are eligible.
 * @returns {{ chars: number, norm: string }}  norm = normalised text, used by
 *          the gate to spot the same message being repeated.
 */
function countEligible(content) {
  const raw = typeof content === 'string' ? content.trim() : '';
  if (!raw) return { chars: 0, norm: '' };
  if (COMMAND_RE.test(raw)) return { chars: 0, norm: '' };

  const cleaned = raw
    .replace(URL_RE, ' ')
    .replace(MENTION_RE, ' ')
    .replace(CUSTOM_EMOJI_RE, ' ')
    .replace(TIMESTAMP_RE, ' ')
    .replace(EMOJI_RE, ' ')
    .replace(ARABIC_MARKS_RE, '');

  let chars = 0;
  let laughTokens = 0;
  let realTokens = 0;
  const seen = new Map();
  const kept = [];

  for (const token of cleaned.split(/\s+/)) {
    if (!token) continue;
    const letters = token.replace(EDGE_PUNCT_RE, '').replace(NON_ALNUM_RE, '');
    if (!letters) continue;
    const w = letters.toLowerCase();

    if (isLaughter(w)) { laughTokens++; continue; }

    const c = collapse(w);
    if (isJunk(c)) continue;

    // The same word more than twice in one message is padding.
    const n = (seen.get(c) || 0) + 1;
    seen.set(c, n);
    if (n > 2) continue;

    chars += [...c].length;
    realTokens++;
    kept.push(c);
  }

  if (realTokens === 0) return { chars: 0, norm: '' };          // laughter-only / junk-only
  chars += Math.min(laughTokens * 2, 4);                        // a little laughter is fine
  return { chars: Math.min(chars, settings.text.maxCharsPerMessage), norm: kept.join(' ') };
}

/**
 * Stateful wrapper: adds the repeated-message and per-minute limits.
 * One instance is shared by the whole bot.
 */
class TextGate {
  constructor() {
    this.minute = new Map();   // userId -> { mk, used }
    this.recent = new Map();   // userId -> [{ norm, at }]
    this._lastPrune = 0;
  }

  evaluate(userId, content, now = Date.now()) {
    this._prune(now);
    const { chars, norm } = countEligible(content);
    if (chars <= 0) return 0;

    // Same message again within the window → nothing.
    const list = this.recent.get(userId) || [];
    const win = settings.text.duplicateWindowMs;
    const fresh = list.filter(r => now - r.at < win);
    if (fresh.some(r => r.norm === norm)) { this.recent.set(userId, fresh); return 0; }
    fresh.push({ norm, at: now });
    this.recent.set(userId, fresh.slice(-6));

    // Per-minute ceiling on credited characters.
    const mk = Math.floor(now / 60000);
    let rec = this.minute.get(userId);
    if (!rec || rec.mk !== mk) { rec = { mk, used: 0 }; this.minute.set(userId, rec); }
    const room = Math.max(0, settings.text.maxCharsPerMinute - rec.used);
    const credited = Math.min(chars, room);
    rec.used += credited;
    return credited;
  }

  _prune(now) {
    if (now - this._lastPrune < 5 * 60 * 1000) return;
    this._lastPrune = now;
    const mk = Math.floor(now / 60000);
    for (const [k, v] of this.minute) if (v.mk < mk - 1) this.minute.delete(k);
    for (const [k, v] of this.recent) {
      const keep = v.filter(r => now - r.at < settings.text.duplicateWindowMs);
      if (keep.length) this.recent.set(k, keep); else this.recent.delete(k);
    }
  }
}

module.exports = { countEligible, TextGate, isLaughter, isJunk, hasKeyboardRun, collapse };
