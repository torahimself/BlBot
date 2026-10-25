'use strict';
// Arabic / English text normalisation shared by the games.
//
// normalize("الإمارات") === normalize("امارات") === normalize("الامارات")
// so players can type a name with or without ال, hamza, taa marbuta, diacritics...

const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;   // harakat, tatweel
const NON_LETTER = /[^\p{L}\p{N}]/gu;

function foldLetters(s) {
  return s
    .replace(MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/گ/g, 'ك').replace(/ک/g, 'ك').replace(/ی/g, 'ي').replace(/پ/g, 'ب').replace(/چ/g, 'ج').replace(/ڤ/g, 'ف')
    .replace(/[۰-۹٠-٩]/g, '');
}

// Comparable key for a name: lower-case, folded, no spaces/punctuation, no leading "ال"/"the".
function normalize(input) {
  let s = String(input || '').toLowerCase().trim();
  s = foldLetters(s);
  s = s.replace(/^the\s+/, '');
  s = s.split(/\s+/).map(w => (w.startsWith('ال') && w.length > 3 ? w.slice(2) : w)).join(' ');
  return s.replace(NON_LETTER, '');
}

const isArabicOnly = (s) => /^[ء-يٱپچژڤکگی\s]+$/.test(String(s || '').replace(MARKS, '').trim());

// First letter of a word as a folded letter (ال stripped), for the letters game.
function firstLetter(word) {
  const n = normalize(word);
  return n ? [...n][0] : '';
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

module.exports = { normalize, foldLetters, isArabicOnly, firstLetter, levenshtein };
