'use strict';
// Answer validation for the categories game (إنسان حيوان نبات جماد بلاد).
// Pure functions — no Discord, no database — so they are easy to test.
//
// validate() sorts a message into ONE of three outcomes (the game only ever acts on the first two):
//   • {ok:true}              a clear answer: in this category's list, right letter → points at once
//   • {ok:true, vote:true}   a plausible answer that is not in the list (a real Arabic word, or a name) →
//                            the other players vote
//   • {ok:false, reason}     anything else: chat, «ما أدري», wrong letter, a word from another category,
//                            made-up or misspelled words … → IGNORED by the game (no message, the turn's clock keeps running)
// Pipeline: non-answer phrases → format → length/junk → forms of the word (with / without «ال») →
//           category list → other categories → letter → fabricated «letter + word» → plausibility.
// «ال» is only an article when it is spelled with a plain alef: «السمك» = «سمك», but «ألمانيا» (hamza) is
// a whole word that starts with «أ».

const { foldLetters } = require('./arabic.js');
const { hasKeyboardRun } = require('../economy/engine/textFilter.js');
const { COUNTRIES } = require('./countries.js');
const LEXICON = require('./data/lexicon.js');

const CATS = ['إنسان', 'حيوان', 'نبات', 'جماد', 'بلاد'];

const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;   // harakat, Quranic marks, tatweel
const FOREIGN = /[A-Za-z0-9٠-٩۰-۹]/;
const NOT_ARABIC = /[^ء-يٱپچژڤکگی\s]/g;

const hasArticle = (raw) => /^[اٱ]ل/.test(raw.replace(MARKS, '')) && foldLetters(raw).length >= 4;   // «ال» with a plain alef

/** All spellings of one typed word that could be the real word: as typed, and without the article «ال». */
function wordForms(raw) {
  const full = foldLetters(raw);
  return hasArticle(raw) ? [full, full.slice(2)] : [full];
}

/** Every key an answer could be known by (words combined: with / without the article), most literal first. */
function formsOf(text) {
  const raw = String(text || '').replace(MARKS, '').replace(/[\p{P}\p{S}]/gu, ' ').replace(NOT_ARABIC, ' ');
  const words = raw.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return [];
  let out = [''];
  for (const w of words) {
    const f = wordForms(w);
    out = out.flatMap(prefix => f.map(x => (prefix ? prefix + ' ' : '') + x));
  }
  return [...new Set(out)];
}

/** The single key a LIST entry is stored under (an entry with a plain «ال» is stored without it). */
function keyOf(text) {
  const raw = String(text || '').replace(MARKS, '').replace(/[\p{P}\p{S}]/gu, ' ').replace(NOT_ARABIC, ' ');
  return raw.split(/\s+/).filter(Boolean).map(w => (hasArticle(w) ? foldLetters(w).slice(2) : foldLetters(w))).join(' ');
}

// ── lexicon sets ─────────────────────────────────────────────────────────────
const SETS = CATS.map((cat) => new Set((LEXICON[cat] || []).map(keyOf).filter(Boolean)));
for (const c of COUNTRIES) { SETS[4].add(keyOf(c.ar)); SETS[4].add(keyOf(c.capAr)); }
const ANY = new Set(SETS.flatMap(s => [...s]));

// ── general Arabic dictionary (lazy: only read the first time an unknown word shows up) ──────────
let DICT = null;
function dict() {
  if (DICT) return DICT;
  try {
    DICT = new Set(require('fs').readFileSync(require('path').join(__dirname, 'data', 'arwords.txt'), 'utf8').split('\n').filter(Boolean));
  } catch (err) {
    console.error('[Categories] arwords.txt missing — unknown words are judged by vote only:', err.message);
    DICT = new Set();
  }
  return DICT;
}
const PROCLITICS = ['و', 'ف', 'ب', 'ك', 'ل', 'وال', 'فال', 'بال', 'كال', 'لل'];
/** One word (folded, without «ال») is a real Arabic word. */
function isWord(w) {
  const d = dict();
  if (d.has(w)) return true;
  for (const p of PROCLITICS) if (w.length - p.length >= 3 && w.startsWith(p) && d.has(w.slice(p.length))) return true;
  return false;
}
/** Every word of the answer is a real word (true), or the dictionary could not be loaded (null). */
function isRealAnswer(key) {
  if (!dict().size) return null;
  return key.split(' ').every(isWord);
}

// true when a and b differ by exactly ONE typo: a replaced, missing, extra or swapped letter.
function oneTypoApart(a, b) {
  if (a === b) return false;
  const x = [...a], y = [...b];
  const dl = x.length - y.length;
  if (Math.abs(dl) > 1) return false;
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  if (dl === 0) {
    if (x.slice(i + 1).join('') === y.slice(i + 1).join('')) return true;                          // one letter replaced
    return x[i] === y[i + 1] && x[i + 1] === y[i] && x.slice(i + 2).join('') === y.slice(i + 2).join(''); // two swapped
  }
  const [long, short] = dl > 0 ? [x, y] : [y, x];
  return long.slice(i + 1).join('') === short.slice(i).join('');                                    // one letter missing/extra
}

/** A word of THIS category this answer is probably a misspelling of (same first letter), or null. Only a hint. */
function nearMiss(key, i) {
  if ([...key.replace(/\s/g, '')].length < 4 || key.includes(' ')) return null;
  for (const w of SETS[i]) if (w[0] === key[0] && !w.includes(' ') && oneTypoApart(key, w)) return w;
  return null;
}
const inLexicon = (key, i) => SETS[i].has(key);
const inSet = (forms, i) => forms.filter(f => SETS[i].has(f));

// ── things that are talk, not answers ───────────────────────────────────────
// «ما أدري», «مدري», «لا أعرف», «نسيت», questions, filler. They are never answers (and never start a vote).
const FILLER_FIRST = new Set(['ما', 'لا', 'مو', 'مب', 'ماني', 'مني', 'ايش', 'شو', 'وش', 'ليش', 'كيف', 'هل', 'يعني', 'والله', 'طيب', 'اوك', 'اوكي',
  'ايوه', 'اي', 'نعم', 'اظن', 'اعتقد', 'خلني', 'استنى', 'انتظر', 'لحظه', 'ثواني', 'دقيقه', 'هذا', 'هذي', 'هاذي', 'هذه', 'مين', 'وين', 'متى', 'ليه', 'احم', 'امم']);
const FILLER_WHOLE = new Set(['مدري', 'مادري', 'ماعرف', 'ماعلم', 'نسيت', 'يعني', 'والله', 'طيب', 'اوك', 'اوكي', 'لحظه', 'ثواني', 'شو', 'ايش', 'وش', 'ليش', 'كيف', 'هل',
  'احم', 'امم', 'مدري والله', 'ولا شي', 'ولا شيء']);
/** True when the text is chat («ما أدري», «مدري», «ايش اكتب») and could never be a category answer. */
function isNonAnswer(text) {
  const words = String(text || '').replace(MARKS, '').replace(/[\p{P}\p{S}]/gu, ' ').split(/\s+/).filter(Boolean).map(w => foldLetters(w));
  if (!words.length) return false;
  const joined = words.join(' ');
  if (FILLER_WHOLE.has(joined)) return true;
  if (words.length >= 2 && FILLER_FIRST.has(words[0])) return true;
  if (/^(?:ما|لا|مو|مب)ا?(?:ادري|اعرف|اعلم|عارف|اتذكر|يحضرني|عندي|اعرفها|اعرفه)$/.test(words.join(''))) return true;
  return false;
}

/** A word that is not in the category's list but could still be right → the players may vote on it. */
function plausible(key, i, real) {
  const words = key.split(' ');
  if (i === 0) return words.length <= 2 && words.every(w => w.length >= 3);          // names: any 1–2 word name; players judge
  if (words.length > 3) return false;
  return real !== false;                                                              // real Arabic words only (null = no dictionary → let players decide)
}

/**
 * @param {string} text   what the player typed
 * @param {number} i      category index (0 إنسان … 4 بلاد)
 * @param {string} letter required letter (any hamza form)
 * @param {{used?:Set<string>, crossCheck?:boolean}} [opts]
 * @returns {{ok:boolean, reason?:string, key?:string, answer?:string, vote?:boolean}}
 *   reason: empty | nonanswer | format | short | long | letter | single | junk | fabricated | category | dup | implausible
 */
function validate(text, i, letter, opts = {}) {
  const used = opts.used || null;
  const crossCheck = opts.crossCheck !== false;
  const t = String(text == null ? '' : text).trim();
  if (!t) return { ok: false, reason: 'empty' };
  if (isNonAnswer(t)) return { ok: false, reason: 'nonanswer' };                  // «ما أدري» is not an animal
  if (FOREIGN.test(t)) return { ok: false, reason: 'format' };

  const stripped = t.replace(MARKS, '').replace(/[\p{P}\p{S}]/gu, ' ').trim();
  if (!stripped || /[^ء-يٱپچژڤکگی\s]/.test(stripped)) return { ok: false, reason: 'format' };
  const answer = stripped.replace(/\s+/g, ' ');

  const rawWords = stripped.split(/\s+/).filter(Boolean);
  const folded0 = foldLetters(rawWords[0]);
  if (folded0.length < 2 || folded0 === 'ال') return { ok: false, reason: 'single' };   // «س بطيخ», «ال بطيخ»

  const forms = formsOf(t);
  if (!forms.length) return { ok: false, reason: 'long' };
  const want = [...foldLetters(String(letter))][0];
  const lettersOf = (f) => f.replace(/\s/g, '');
  const starts = (f) => [...f][0] === want;

  // The best reading of the answer that is in this category's list (prefer one that starts with the letter).
  const hits = inSet(forms, i);
  const hit = hits.find(starts) || hits[0] || null;
  const key = hit || forms[forms.length - 1];                // unknown word: «ال» is an article → use the word without it

  // Very short words («دي») only count when they are really in this category's list.
  if (lettersOf(key).length < 2 || (lettersOf(key).length < 3 && !hit)) return { ok: false, reason: 'short' };
  if (key.length > 25) return { ok: false, reason: 'long' };

  // junk: the same letter 3+ times in a row, one repeated letter, keyboard runs
  const L = lettersOf(key);
  if (/(.)\1\1/u.test(L) || new Set(L).size < 2) return { ok: false, reason: 'junk' };
  for (const w of key.split(' ')) {
    if (w.length >= 5 && hasKeyboardRun(w)) return { ok: false, reason: 'junk' };
    if (w.length >= 6 && new Set(w).size / w.length <= 0.34) return { ok: false, reason: 'junk' };
  }

  if (!starts(key)) return { ok: false, reason: 'letter' };
  if (used && used.has(key)) return { ok: false, reason: 'dup', key };

  if (hit) return { ok: true, key, answer };                // a listed word: accepted at once

  // Not in this category's list. A real word from ANOTHER category (a car as an animal, a city as an
  // animal) is wrong. Names (إنسان) are left alone: many names are also words.
  if (crossCheck && i !== 0) {
    for (const j of [1, 2, 3, 4]) if (j !== i && inSet(forms, j).length) return { ok: false, reason: 'category', key };
  }

  // Fabrication: the letter glued onto a real word («س» + «فراولة»).
  const words = key.split(' ');
  const first = [...words[0]];
  if (first.length - 1 >= 3) {
    const rest = [first.slice(1).join(''), ...words.slice(1)].join(' ');
    if (ANY.has(rest) && !ANY.has(key)) return { ok: false, reason: 'fabricated', key };
  }

  // Plausible but unlisted → the players vote. Made-up or unrelated text is simply ignored.
  const real = isRealAnswer(key);
  if (!plausible(key, i, real)) return { ok: false, reason: 'implausible', key };
  const near = nearMiss(key, i);
  return { ok: true, vote: true, dict: real, suggestion: near || undefined, key, answer };
}

const REASONS_AR = {
  empty: 'رسالة فارغة',
  nonanswer: 'ليست إجابة',
  implausible: 'كلمة غير معروفة',
  format: 'يجب أن تكون الإجابة بالحروف العربية فقط',
  single: 'اكتب الكلمة كاملة وليس الحرف وحده',
  short: 'الكلمة قصيرة جدًا',
  long: 'الكلمة طويلة جدًا',
  junk: 'إجابة غير مقبولة',
  letter: 'لا تبدأ بالحرف المطلوب',
  fabricated: 'كلمة غير صحيحة',
  category: 'لا تنتمي إلى هذه الفئة',
  dup: 'هذه الإجابة استُخدمت من قبل',
  vote: 'لم يوافق اللاعبون على هذه الكلمة',
};

module.exports = { validate, keyOf, formsOf, isNonAnswer, CATS, REASONS_AR, inLexicon, SETS, isRealAnswer, nearMiss };
