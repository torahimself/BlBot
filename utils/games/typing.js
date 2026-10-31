'use strict';
// أسرع كتابة — the sentence appears, the first player to type it correctly takes the round.
const cfg = require('./config.js');
const { foldLetters } = require('./arabic.js');
const PHRASES = require('./data/phrases.js');
const { makeRace } = require('./race.js');

const c = cfg.typing;
const clean = (t) => foldLetters(String(t || '')).replace(/[\p{P}\p{S}]/gu, ' ').replace(/\s+/g, ' ').trim();

function phrases(n, rng = Math.random) {
  const a = [...PHRASES];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

let picked = [];
function makeRound(i, total) {
  if (i === 0) picked = phrases(total);
  const text = picked[i];
  const want = clean(text);
  return {
    prompt: `اكتب الجملة التالية بأسرع ما يمكن:\n\n## ${text}`,
    // A human cannot type faster than ~14 characters a second: anything quicker is a paste of a stale message.
    accept: (typed, ms) => clean(typed) === want && ms >= [...want].length * c.minMsPerChar,
    reveal: `الجملة: **${text}**`,
  };
}

module.exports = Object.assign(makeRace({
  type: 'typing', title: 'أسرع كتابة', emoji: '⚡', color: 0xFEE75C, c,
  intro: 'اكتب الجملة كما تظهر، الأسرع يفوز بالنقطة!',
  blurb: 'تظهر جملة عربية وعلى اللاعبين كتابتها بأسرع ما يمكن. الأكثر نقاطًا يفوز!',
  makeRound,
}), { clean, phrases });
