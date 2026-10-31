'use strict';
// حساب سريع — a sum appears, the first correct answer takes the round. Gets harder every round.
const cfg = require('./config.js');
const { makeRace } = require('./race.js');

const c = cfg.math;
const rnd = (a, b, rng = Math.random) => a + Math.floor(rng() * (b - a + 1));
const AR_DIGITS = /[٠-٩]/g;
const toLatin = (t) => String(t).replace(AR_DIGITS, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[−–]/g, '-');

/** → { text: "17 × 8", answer: 136 }. `level` 0.. grows the numbers. */
function problem(level, rng = Math.random) {
  const kind = level < 2 ? rnd(0, 1, rng) : level < 4 ? rnd(0, 3, rng) : rnd(1, 5, rng);
  const k = Math.min(level, 7);
  switch (kind) {
    case 0: { const a = rnd(10 + k * 6, 50 + k * 15, rng), b = rnd(10, 40 + k * 10, rng); return { text: `${a} + ${b}`, answer: a + b }; }
    case 1: { const a = rnd(30 + k * 10, 120 + k * 20, rng), b = rnd(10, a - 1, rng); return { text: `${a} − ${b}`, answer: a - b }; }
    case 2: { const a = rnd(3, 9 + k, rng), b = rnd(3, 9 + k, rng); return { text: `${a} × ${b}`, answer: a * b }; }
    case 3: { const b = rnd(2, 9, rng), q = rnd(3, 12 + k, rng); return { text: `${b * q} ÷ ${b}`, answer: q }; }
    case 4: { const a = rnd(3, 12, rng), b = rnd(3, 12, rng), x = rnd(5, 40, rng); return { text: `${a} × ${b} + ${x}`, answer: a * b + x }; }
    default: { const a = rnd(11, 25, rng), b = rnd(3, 9, rng), x = rnd(5, 30, rng); return { text: `${a} × ${b} − ${x}`, answer: a * b - x }; }
  }
}

function makeRound(i) {
  const p = problem(i);
  return {
    prompt: `احسب:\n\n# ${p.text} = ؟`,
    accept: (typed) => {
      const t = toLatin(typed).replace(/\s+/g, '');
      return /^-?\d+$/.test(t) && Number(t) === p.answer;
    },
    reveal: `الجواب: **${p.answer}**`,
  };
}

module.exports = Object.assign(makeRace({
  type: 'math', title: 'حساب سريع', emoji: '🧮', color: 0x57F287, c,
  intro: 'أول إجابة صحيحة تأخذ النقطة، والمسائل تصعب!',
  blurb: 'مسائل حساب تصعب شيئًا فشيئًا، وأول إجابة صحيحة تأخذ النقطة.',
  makeRound,
}), { problem, toLatin });
