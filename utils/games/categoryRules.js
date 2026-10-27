'use strict';
// Answer validation for the categories game (إنسان حيوان نبات جماد بلاد).
// Pure functions — no Discord, no database — so they are easy to test.
//
// An answer is accepted when ALL of this holds:
//   1. it is Arabic letters only (spaces allowed; diacritics, tatweel and
//      punctuation are ignored; digits / Latin letters are refused);
//   2. 2–25 characters, not junk (letters repeated 3+ times, keyboard runs…);
//   3. it really STARTS with the required letter — أ إ آ ا count as the same
//      letter, and a leading «ال» is ignored («الأسد» starts with ا);
//   4. the first word is not just the letter on its own («س بطيخ»);
//   5. it is not fabricated by gluing the letter onto a real word («سفراولة»);
//   6. it was not already given in this game.
// Words in the lexicon (data/lexicon.js) for THIS category are accepted straight away.
// Any other answer is not guessed at: validate() returns {ok:true, vote:true, dict, suggestion}
// and the game asks the other players to confirm it (see categories.js). `dict` says whether it
// is a real Arabic word (data/arwords.txt, ~255k words) — it breaks a tie / a vote nobody cast.
// A one-letter misspelling of a known word is only a `suggestion`, never a rejection.

const { foldLetters } = require('./arabic.js');
const { hasKeyboardRun } = require('../economy/engine/textFilter.js');
const { COUNTRIES } = require('./countries.js');
const LEXICON = require('./data/lexicon.js');

const CATS = ['إنسان', 'حيوان', 'نبات', 'جماد', 'بلاد'];

const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;   // harakat, Quranic marks, tatweel
const FOREIGN = /[A-Za-z0-9٠-٩۰-۹]/;
const NOT_ARABIC = /[^ء-يٱپچژڤکگی\s]/g;

// Letters of one word, folded (أ→ا, ى→ي, ة→ه …), and with a leading «ال» removed.
function wordKey(w, stripAl = true) {
  let k = foldLetters(w);
  if (stripAl && k.startsWith('ال') && k.length >= 4) k = k.slice(2);
  return k;
}

/** Comparable key of a whole answer ('' if it has no Arabic letters). */
function keyOf(text) {
  const raw = String(text || '').replace(MARKS, '').replace(/[\p{P}\p{S}]/gu, ' ').replace(NOT_ARABIC, ' ');
  return raw.split(/\s+/).filter(Boolean).map(w => wordKey(w)).join(' ');
}

// ── lexicon sets ─────────────────────────────────────────────────────────────
const SETS = CATS.map((cat) => new Set((LEXICON[cat] || []).map(keyOf).filter(Boolean)));
for (const c of COUNTRIES) { SETS[4].add(keyOf(c.ar)); SETS[4].add(keyOf(c.capAr)); }
const ANY = new Set(SETS.flatMap(s => [...s]));
// Words of the four non-name categories: used to spot a misspelling of a known word.
const KNOWN = [...new Set([1, 2, 3, 4].flatMap(j => [...SETS[j]]))];

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

/** A known word this answer is probably a misspelling of (same first letter), or null. */
function nearMiss(key) {
  if ([...key.replace(/\s/g, '')].length < 4) return null;
  for (const w of KNOWN) if (w[0] === key[0] && oneTypoApart(key, w)) return w;
  return null;
}
const inLexicon = (key, i) => SETS[i].has(key);

/**
 * @param {string} text   what the player typed
 * @param {number} i      category index (0 إنسان … 4 بلاد)
 * @param {string} letter required letter (any hamza form)
 * @param {{used?:Set<string>, crossCheck?:boolean}} [opts]
 * @returns {{ok:boolean, reason?:string, key?:string, answer?:string}}
 *   reason: empty | format | short | long | letter | single | junk | fabricated | category | dup
 *   ok with vote:true → not in the category list; players must confirm (dict: real word? / suggestion)
 */
function validate(text, i, letter, opts = {}) {
  const used = opts.used || null;
  const crossCheck = opts.crossCheck !== false;
  const t = String(text == null ? '' : text).trim();
  if (!t) return { ok: false, reason: 'empty' };
  if (FOREIGN.test(t)) return { ok: false, reason: 'format' };

  const stripped = t.replace(MARKS, '').replace(/[\p{P}\p{S}]/gu, ' ').trim();
  if (!stripped || /[^ء-يٱپچژڤکگی\s]/.test(stripped)) return { ok: false, reason: 'format' };

  const rawWords = stripped.split(/\s+/).filter(Boolean);
  const folded0 = foldLetters(rawWords[0]);
  if (folded0.length < 2 || folded0 === 'ال') return { ok: false, reason: 'single' };   // «س بطيخ», «ال بطيخ»

  const key = keyOf(t);
  const letters = key.replace(/\s/g, '');
  // Very short words («دي») only count when they are really in this category's list.
  if (letters.length < 2 || (letters.length < 3 && !inLexicon(key, i))) return { ok: false, reason: 'short' };
  if (key.length > 25) return { ok: false, reason: 'long' };

  // junk: the same letter 3+ times in a row, one repeated letter, keyboard runs
  if (/(.)\1\1/u.test(letters) || new Set(letters).size < 2) return { ok: false, reason: 'junk' };
  for (const w of key.split(' ')) {
    if (w.length >= 5 && hasKeyboardRun(w)) return { ok: false, reason: 'junk' };
    if (w.length >= 6 && new Set(w).size / w.length <= 0.34) return { ok: false, reason: 'junk' };
  }

  if ([...key][0] !== [...foldLetters(String(letter))][0]) return { ok: false, reason: 'letter' };

  if (used && used.has(key)) return { ok: false, reason: 'dup', key };

  if (inLexicon(key, i)) return { ok: true, key, answer: stripped.replace(/\s+/g, ' ') };

  // Not in this category's list. A real word from ANOTHER category (a car as an
  // animal) is wrong. Names (إنسان) are left alone: many names are also words.
  if (crossCheck && i !== 0) {
    for (const j of [1, 2, 3, 4]) if (j !== i && inLexicon(key, j) && !inLexicon(key, i)) return { ok: false, reason: 'category', key };
  }

  // Fabrication: the letter glued onto a real word («س» + «فراولة»).
  const words = key.split(' ');
  const first = [...words[0]];
  if (first.length - 1 >= 3) {
    const rest = [first.slice(1).join(''), ...words.slice(1)].join(' ');
    if (ANY.has(rest) && !ANY.has(key)) return { ok: false, reason: 'fabricated', key };
  }
  // Not in this category's list: the other players decide. A near miss of a known word is only a hint.
  const near = nearMiss(key);
  return { ok: true, vote: true, dict: isRealAnswer(key), suggestion: near || undefined, key, answer: stripped.replace(/\s+/g, ' ') };
}

const REASONS_AR = {
  empty: 'رسالة فارغة',
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

module.exports = { validate, keyOf, CATS, REASONS_AR, inLexicon, SETS, isRealAnswer, nearMiss };
