'use strict';
// Reads a chat message as a street-photo (جيو) guess. COUNTRIES ONLY.
//
// A message is a guess only when it is a standalone country name, optionally with a short lead-in
// («الدولة ألمانيا», «أعتقد أنها عمان», «it's Germany», «the country is Oman»). Everything else —
// conversation that merely mentions a country, questions, capitals («برلين»), random text — is
// NOT a guess and is ignored by the game (no reaction, no pin).
//
// Names come from the explicit country list (countries.js: Arabic, English and aliases). Capital
// cities are deliberately NOT looked at: «عمان» is Oman, never Jordan's capital Amman.

const { foldLetters, normalize } = require('./arabic.js');
const { COUNTRIES } = require('./countries.js');
const { GEO } = require('./geoPoints.js');

// normalised country name → country. A name used by two countries is a data error (caught by the tests).
const INDEX = new Map();
const CLASHES = [];
for (const c of COUNTRIES) {
  if (!GEO[c.code]) continue;
  for (const k of c.keys) {
    if (INDEX.has(k) && INDEX.get(k).code !== c.code) CLASHES.push(k);
    else INDEX.set(k, c);
  }
}

// Words that may come BEFORE the country name («the country is …», «أعتقد أنها …»).
const LEADS = new Set([
  'الدوله', 'دوله', 'البلد', 'بلد', 'هي', 'هو', 'هذي', 'هذه', 'هذا', 'اعتقد', 'اظن', 'اكيد', 'غالبا', 'ربما',
  'انها', 'انه', 'اعتقد', 'اظنها', 'اعتقدها', 'جوابي', 'الجواب', 'اجابتي', 'في', 'انا', 'اقول', 'اختار', 'اخترت',
  'the', 'country', 'is', 'it', 'its', 'it\'s', 'i', 'think', 'guess', 'say', 'this', 'that', 'probably', 'definitely',
  'answer', 'my', 'im', 'sure', 'choose', 'pick', 'in',
].map(w => foldLetters(w).toLowerCase()));

const clean = (s) => foldLetters(String(s || '').toLowerCase())
  .replace(/<[^>]*>/g, ' ')                  // mentions, emoji, timestamps
  .replace(/https?:\/\/\S+/g, ' ')
  .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
  .replace(/\s+/g, ' ').trim();

/**
 * @returns {object|null} the country (from countries.js) the message names, or null when it is not a guess.
 */
function parseGuess(text) {
  const raw = String(text == null ? '' : text);
  if (!raw || raw.length > 60) return null;
  if (/[?؟]/.test(raw)) return null;          // a question is conversation, not an answer
  const words = clean(raw).split(' ').filter(Boolean);
  if (!words.length || words.length > 6) return null;
  // drop lead-in words (never the last one — that must be the country)
  let i = 0;
  while (i < words.length - 1 && LEADS.has(words[i])) i++;
  const name = normalize(words.slice(i).join(' '));
  if (!name) return null;
  return INDEX.get(name) || null;
}

/** The map point the pin of a country is drawn at. */
function pinOf(country) {
  const [lat, lon] = GEO[country.code].points[0];
  return { lat, lon, label: `${country.ar} ${country.flag}`, code: country.code };
}

module.exports = { parseGuess, pinOf, INDEX, CLASHES };
