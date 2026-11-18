'use strict';
// Writes every BlBot icon as a 128px PNG into assets/icons/ (+ a contact sheet) and a blank emoji-ids.json.
// Upload the PNGs as Discord emojis and paste their ids into emoji-ids.json to see them in plain Discord text too.
//   node dev/make-icons.js
const fs = require('fs'); const path = require('path');
const R = require('../utils/ui/render.js'); const icons = require('../utils/ui/icons.js');
const out = path.join(__dirname, '..', 'assets', 'icons'); fs.mkdirSync(out, { recursive: true });
const names = icons.names();
for (const n of names) { const { c, g } = R.newCanvas(128, 128); icons.paint(g, n, 0, 0, 128); fs.writeFileSync(path.join(out, `bl_${n}.png`), c.toBuffer('image/png')); }
const idf = path.join(out, 'emoji-ids.json');
if (!fs.existsSync(idf)) fs.writeFileSync(idf, JSON.stringify(Object.fromEntries(names.map(n => [n, ''])), null, 2) + '\n');
const cols = 8, cell = 120, rows = Math.ceil(names.length / cols);
const { c, g } = R.newCanvas(cols * cell, rows * cell); g.fillStyle = "#2a2d45"; g.fillRect(0, 0, c.width, c.height);
names.forEach((n, i) => icons.paint(g, n, (i % cols) * cell + 12, Math.floor(i / cols) * cell + 8, 96));
fs.writeFileSync(process.argv[2] || path.join(out, '_sheet.png'), c.toBuffer('image/png'));
console.log(`${names.length} icons written to ${out}`);
