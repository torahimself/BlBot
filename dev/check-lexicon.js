'use strict';
// Reports on utils/games/data/lexicon.js:
//   counts per category / letter, duplicates, entries that fail validation for their
//   own letter, and entries that appear in two categories.
// Run:  NODE_PATH=./vendor node dev/check-lexicon.js
const path = require('path');
const root = path.join(__dirname, '..');
const LEX = require(path.join(root, 'utils/games/data/lexicon.js'));
const rules = require(path.join(root, 'utils/games/categoryRules.js'));
const { foldLetters } = require(path.join(root, 'utils/games/arabic.js'));

const CATS = rules.CATS;
const LETTERS = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'];
const firstOf = (w) => foldLetters(rules.keyOf(w))[0];

let total = 0, problems = 0;
const seenIn = new Map();
console.log('letter  ' + CATS.map(c => c.padEnd(6)).join(' '));
const counts = {};
for (const c of CATS) { counts[c] = {}; for (const l of LETTERS) counts[c][l] = 0; }

CATS.forEach((cat, ci) => {
  const list = LEX[cat] || [];
  const dup = new Set(); const seen = new Set();
  for (const w of list) {
    total++;
    const k = rules.keyOf(w);
    if (seen.has(k)) dup.add(w); seen.add(k);
    const l = firstOf(w);
    if (counts[cat][l] !== undefined) counts[cat][l]++; else console.log(`?? ${cat}: "${w}" starts with unlisted letter ${l}`);
    if (!seenIn.has(k)) seenIn.set(k, new Set());
    seenIn.get(k).add(cat);
    const r = rules.validate(w, ci, l, { crossCheck: false, used: new Set() });
    if (!r.ok) { problems++; console.log(`FAIL ${cat}: "${w}" (${l}) → ${r.reason}`); }
  }
  if (dup.size) { problems += dup.size; console.log(`DUP ${cat}: ${[...dup].join(' ')}`); }
});

for (const l of LETTERS) console.log(l.padEnd(8) + CATS.map(c => String(counts[c][l]).padEnd(6)).join(' '));
console.log('totals  ' + CATS.map(c => String((LEX[c] || []).length).padEnd(6)).join(' ') + ' = ' + total);

const both = [...seenIn].filter(([, s]) => s.size > 1);
if (both.length) console.log('IN TWO CATEGORIES (ok if intended): ' + both.map(([k, s]) => `${k}[${[...s].join('/')}]`).join(' '));
const low = [];
for (const c of CATS) for (const l of LETTERS) if (counts[c][l] < 3) low.push(`${c}:${l}=${counts[c][l]}`);
if (low.length) console.log('LOW (<3): ' + low.join(' '));
console.log(problems ? `\n${problems} problem(s)` : '\nno problems');
process.exit(problems ? 1 : 0);
