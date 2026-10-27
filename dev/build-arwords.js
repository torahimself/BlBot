'use strict';
// Builds utils/games/data/arwords.txt from the Ayaspell Arabic Hunspell dictionary
// (LibreOffice/dictionaries → ar/ar.dic, GPL 2 / LGPL 2.1 / MPL 1.1).
// Usage: node dev/build-arwords.js /path/to/ar.dic
// Folded like the game does, with prefixed forms (و ف ب ك ل … + word) removed because the game
// strips one prefix at lookup time. Only needed to REBUILD the list; the game just reads the .txt.
const fs = require('fs');
const path = require('path');
const { foldLetters } = require('../utils/games/arabic.js');
const src = process.argv[2];
if (!src) { console.error('usage: node dev/build-arwords.js ar.dic'); process.exit(1); }
const lines = fs.readFileSync(src, 'utf8').split('\n').slice(1);
const all = new Set();
for (const l of lines) {
  const w = l.trim().split('/')[0];
  if (!w || w.startsWith('#') || /[^ء-يً-ٰٟـأإآ]/.test(w)) continue;
  const k = foldLetters(w).replace(/[ً-ٰٟـ]/g, '');
  if (k.length >= 3 && k.length <= 25) all.add(k);
}
const PRE = ['و', 'ف', 'ب', 'ك', 'ل', 'ال', 'وال', 'فال', 'بال', 'كال', 'لل', 'ولل', 'فلل', 'س', 'وس', 'فس'];
const keep = [];
for (const w of all) {
  let derived = false;
  for (const p of PRE) if (w.length - p.length >= 3 && w.startsWith(p) && all.has(w.slice(p.length))) { derived = true; break; }
  if (!derived) keep.push(w);
}
keep.sort();
const out = path.join(__dirname, '../utils/games/data/arwords.txt');
fs.writeFileSync(out, keep.join('\n') + '\n');
console.log('unique', all.size, '→ kept', keep.length, '(' + (fs.statSync(out).size / 1e6).toFixed(2) + ' MB)');
