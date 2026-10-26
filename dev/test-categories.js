'use strict';
// Tests for إنسان حيوان نبات جماد بلاد (turn-based). Run: node dev/test-categories.js
// Validation cases come from the owner's bug report (س بطيخ / سفراولة …); the game flow runs the
// real utils/games/categories.js against a mocked session with tiny timers.
process.env.BL_ECONOMY_DB = ':memory:';
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const cfg = require(path.join(root, 'utils/games/config.js'));
const rules = require(path.join(root, 'utils/games/categoryRules.js'));
const cats = require(path.join(root, 'utils/games/categories.js'));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const v = (text, i, letter, opts) => rules.validate(text, i, letter, opts);

// ── mocks ────────────────────────────────────────────────────────────────────
let mid = 0;
function mkChannel() {
  const sent = [];
  return { id: 'c', sent, send: async (c) => { const m = { id: 'm' + (++mid), ...(typeof c === 'string' ? { content: c } : c), edit: async (x) => { Object.assign(m, x); return m; } }; sent.push(m); return m; } };
}
function fakeSession(ids) {
  const players = new Map(ids.map(id => [id, { id, name: id, active: false }]));
  const s = {
    id: 'cs', type: 'categories', channel: mkChannel(), status: 'running', players, timers: new Set(), options: {}, data: {},
    finishCalls: [],
    get ids() { return [...players.keys()]; },
    mention: (id) => `<@${id}>`, name: (id) => id,
    markActive(id) { players.get(id).active = true; },
    async finish(o) { this.finishCalls.push(o); this.status = 'done'; return { noteText: '' }; },
    async abort(reason) { this.status = 'done'; this.abortReason = reason; cats.cleanup(this); },
  };
  return s;
}
let msgId = 0;
const mkMsg = (uid, content, id) => ({ id: id || 'x' + (++msgId), author: { id: uid }, content });

// Answers that must be valid for the test letters, per category (name, animal, plant, object, country).
const LETTERS = ['س', 'م', 'ب', 'ج', 'ك'];
const BANK = {
  'س': ['سلمان', 'سمك', 'سفرجل', 'سيارة', 'سوريا'],
  'م': ['محمد', 'ماعز', 'موز', 'مفتاح', 'مصر'],
  'ب': ['بدر', 'بقرة', 'بطيخ', 'باب', 'بلجيكا'],
  'ج': ['جابر', 'جمل', 'جزر', 'جرس', 'جيبوتي'],
  'ك': ['كريم', 'كلب', 'كرز', 'كرسي', 'كندا'],
};

const SAVED = JSON.parse(JSON.stringify({ ...cfg.categories, letters: null }));
const SAVED_LETTERS = [...cfg.categories.letters];
function tune(extra = {}) {
  const c = cfg.categories;
  Object.assign(c, { turnMs: 80, introMs: 0, pauseMs: 0, betweenTurnsMs: 0, roundPauseMs: 0, rounds: 5, maxAttempts: null, maxIdleCategories: 99, ...extra });
  c.letters.splice(0, c.letters.length, ...LETTERS);
}
function restore() {
  const c = cfg.categories;
  for (const k of Object.keys(SAVED)) if (k !== 'letters') c[k] = SAVED[k];
  c.letters.splice(0, c.letters.length, ...SAVED_LETTERS);
}

/**
 * Plays a whole game. strategy({uid, ci, letter, letterIdx, attempt, turn, s}) → string (typed answer) | null (silence).
 * `hook(info, s)` runs when a turn becomes active (before the strategy answers).
 */
async function play(ids, strategy, { hook, timeout = 30000 } = {}) {
  const s = fakeSession(ids);
  const seen = new Set();
  const prompts = [];
  const attempts = new Map();
  const timer = setInterval(() => {
    const turn = s.data && s.data.turn;
    if (!turn || !turn.active || turn.resolved || seen.has(turn)) return;
    seen.add(turn);
    const key = `${s.data.letterIdx}:${turn.ci}`;
    const attempt = (attempts.get(key) || 0) + 1; attempts.set(key, attempt);
    const info = { uid: turn.userId, ci: turn.ci, letter: turn.letter, letterIdx: s.data.letterIdx, attempt, turn, s };
    prompts.push({ uid: info.uid, ci: info.ci, letter: info.letter, letterIdx: info.letterIdx, attempt });
    if (hook) hook(info, s);
    const text = strategy(info);
    if (text != null) cats.onMessage(s, mkMsg(info.uid, text));
  }, 2);
  const game = cats.start(s);
  const guard = setTimeout(() => { s.status = 'done'; cats.cleanup(s); }, timeout);
  await game;
  clearTimeout(guard); clearInterval(timer);
  return { s, prompts, finish: s.finishCalls[0] };
}
const good = (info) => BANK[info.letter][info.ci];
const text = (s) => s.channel.sent.map(m => (m.content || '') + ' ' + (m.embeds || []).map(e => JSON.stringify(e.toJSON ? e.toJSON() : e)).join(' ')).join('\n');

(async () => {
  // ═══════════════════════ validation ═══════════════════════
  console.log('Validation (bug report §3)');
  await t('the test bank itself is valid for every letter and category', () => {
    for (const L of LETTERS) BANK[L].forEach((a, i) => assert(v(a, i, L).ok, `${a} / ${rules.CATS[i]} / ${L}: ${JSON.stringify(v(a, i, L))}`));
  });
  await t('«س بطيخ» (the letter alone, then a word) is rejected', () => {
    assert.strictEqual(v('س بطيخ', 2, 'س').ok, false);
    assert.strictEqual(v('س بطيخ', 2, 'س').reason, 'single');
  });
  await t('«سفراولة» (the letter glued onto a real word) is rejected as fabricated', () => {
    const r = v('سفراولة', 2, 'س');
    assert(!r.ok && r.reason === 'fabricated', JSON.stringify(r));
    assert(!v('سبطيخ', 2, 'س').ok, 'سبطيخ');
    assert(!v('سرمان', 2, 'س').ok, 'سرمان');
  });
  await t('real answers: سمك (animal), سفرجل (plant), سيارة (object), سلمان (name)', () => {
    assert(v('سمك', 1, 'س').ok); assert(v('سفرجل', 2, 'س').ok); assert(v('سيارة', 3, 'س').ok); assert(v('سلمان', 0, 'س').ok);
  });
  await t('countries: سعودية and السعودية (with ال) both start with س', () => {
    assert(v('سعودية', 4, 'س').ok); assert(v('السعودية', 4, 'س').ok);
    assert.strictEqual(v('السعودية', 4, 'س').key, v('سعودية', 4, 'س').key, 'same key → counted as the same answer');
  });
  await t('أ / إ / آ / ا fold to the same letter, both ways', () => {
    for (const L of ['ا', 'أ', 'إ', 'آ']) { assert(v('أحمد', 0, L).ok, 'أحمد/' + L); assert(v('احمد', 0, L).ok); assert(v('إيمان', 0, L).ok); assert(v('آدم', 0, L).ok); }
    assert(v('الأسد', 1, 'ا').ok, 'ال is ignored: الأسد starts with ا');
  });
  await t('harakat, punctuation and extra spaces do not break a valid answer', () => {
    assert(v('سَلْمَان', 0, 'س').ok); assert(v('سلمان!', 0, 'س').ok); assert(v('  سلمان   ', 0, 'س').ok);
    assert(v('«سمك»', 1, 'س').ok); assert(v('سلـــمان', 0, 'س').ok, 'tatweel');
    assert.strictEqual(v('سَلْمَان!', 0, 'س').answer, 'سلمان', 'the stored answer is the cleaned text');
  });
  await t('Latin letters and digits are rejected', () => {
    assert.strictEqual(v('Salman', 0, 'س').reason, 'format'); assert.strictEqual(v('سلمان2', 0, 'س').reason, 'format');
    assert(!v('sمك', 1, 'س').ok); assert(!v('123', 3, 'س').ok);
  });
  await t('a wrong first letter is rejected', () => {
    assert.strictEqual(v('محمد', 0, 'س').reason, 'letter'); assert.strictEqual(v('جمل', 1, 'س').reason, 'letter');
  });
  await t('a duplicate in the same game is rejected (even with ال / hamza / harakat variants)', () => {
    const used = new Set([v('سعودية', 4, 'س').key]);
    assert.strictEqual(v('السعودية', 4, 'س', { used }).reason, 'dup');
    assert.strictEqual(v('سَعودية', 4, 'س', { used }).reason, 'dup');
    assert(v('سوريا', 4, 'س', { used }).ok);
  });
  await t('empty / one letter / keyboard mashing / repeated letters are rejected', () => {
    assert(!v('', 0, 'س').ok); assert(!v('س', 0, 'س').ok); assert(!v('سسسسسس', 0, 'س').ok); assert(!v('ضصثقفغعه', 3, 'ض').ok);
  });
  await t('plausible words that are not in the word list still pass (the game is not dictionary-limited)', () => {
    assert(v('سنجاب', 1, 'س').ok, 'سنجاب'); assert(v('سبانخ', 2, 'س').ok, 'سبانخ'); assert(v('سبورة', 3, 'س').ok, 'سبورة');
    assert(v('سفيان', 0, 'س').ok, 'a rare name'); assert(v('فارنا', 4, 'ف').ok, 'unknown words are not rejected as «not a place»');
  });
  await t('a real word from ANOTHER category is wrong (a car is not an animal)', () => {
    assert.strictEqual(v('سيارة', 1, 'س').reason, 'category');
  });

  // ═══════════════════════ game flow ═══════════════════════
  console.log('Game flow (bug report §4)');
  await t('prompt: random player is MENTIONED with category, letter and the 15 s (production value)', async () => {
    tune({ turnMs: 15000 });
    const s = fakeSession(['A', 'B', 'C']);
    const p = cats.start(s);
    for (let i = 0; i < 200 && !(s.data.turn && s.data.turn.active); i++) await sleep(5);
    const turn = s.data.turn;
    assert(turn && turn.active, 'a turn is running');
    const prompt = s.channel.sent.find(m => /دورك/.test(m.content || ''));
    assert(prompt.content.includes(`<@${turn.userId}>`), 'mentions the player');
    assert(prompt.content.includes(rules.CATS[0]) && prompt.content.includes(turn.letter), 'category + letter');
    assert(/15 ثانية/.test(prompt.content), 'time limit shown');
    assert.deepStrictEqual(prompt.allowedMentions.users, [turn.userId], 'only that player is pinged');
    assert(['A', 'B', 'C'].includes(turn.userId));
    s.status = 'done'; cats.cleanup(s); await p; restore();
  });
  await t('everyone answers right: +10 each, 5 letters × 5 categories, letters in the announced order', async () => {
    tune();
    const { s, prompts, finish } = await play(['A', 'B', 'C'], good);
    restore();
    assert.strictEqual(prompts.length, 25, '25 turns, one per category');
    const order = s.data.letters;
    assert.strictEqual(new Set(order).size, 5, 'five different letters');
    prompts.forEach((p, i) => { assert.strictEqual(p.letterIdx, Math.floor(i / 5)); assert.strictEqual(p.ci, i % 5); assert.strictEqual(p.letter, order[Math.floor(i / 5)]); });
    const total = [...s.data.totals.values()].reduce((a, b) => a + b, 0);
    assert.strictEqual(total, 250, '25 × 10 points');
    assert(finish && finish.winners.length >= 1);
    assert.strictEqual(prompts.filter(p => p.attempt > 1).length, 0, 'no retries needed');
  });
  await t('timeout or a wrong answer → ANOTHER player gets the SAME category and letter (never skipped)', async () => {
    tune();
    const { s, prompts } = await play(['A', 'B', 'C'], (i) => {
      if (i.attempt === 1) return i.ci % 2 ? null : 'Hello';     // silence on odd categories, a wrong answer on even ones
      return good(i);
    });
    restore();
    const by = new Map();
    for (const p of prompts) { const k = `${p.letterIdx}:${p.ci}`; (by.get(k) || by.set(k, []).get(k)).push(p); }
    assert.strictEqual(by.size, 25, 'every category was played');
    for (const [k, list] of by) {
      assert.strictEqual(list.length, 2, `${k}: first player failed, second answered`);
      assert.notStrictEqual(list[0].uid, list[1].uid, `${k}: a different player`);
      assert.strictEqual(list[0].letter, list[1].letter, 'same letter');
    }
    assert.strictEqual([...s.data.totals.values()].reduce((a, b) => a + b, 0), 250, 'the failed player scored nothing, the category was still won');
    const out = text(s);
    assert(/انتهى الوقت/.test(out), 'timeout message'); assert(/إجابة غير صحيحة/.test(out), 'wrong-answer message');
    assert(!/لم يُجَب/.test(out), 'nothing was given up');
  });
  await t('nobody can answer one category → after the attempts «لم يُجَب» and the game moves on', async () => {
    tune({ maxAttempts: 3 });
    const { s, prompts } = await play(['A', 'B', 'C'], (i) => (i.letterIdx === 0 && i.ci === 0 ? null : good(i)));
    restore();
    const first = prompts.filter(p => p.letterIdx === 0 && p.ci === 0);
    assert.strictEqual(first.length, 3, 'exactly maxAttempts tries');
    assert.strictEqual(new Set(first.map(p => p.uid)).size, 3, 'each player got one chance before anyone repeats');
    assert(prompts.some(p => p.letterIdx === 0 && p.ci === 1), 'then the next category');
    assert.strictEqual(s.data.board[0].cats[0].status, 'failed');
    assert(/لم يُجَب/.test(text(s)));
    assert.strictEqual([...s.data.totals.values()].reduce((a, b) => a + b, 0), 240, '24 answered categories');
    assert(s.finishCalls.length === 1, 'game still completes');
  });
  await t('nobody answers anything: the game stops after maxIdleCategories and nobody wins', async () => {
    tune({ maxAttempts: 2, maxIdleCategories: 3 });
    const { s, prompts, finish } = await play(['A', 'B'], () => null);
    restore();
    assert.strictEqual(prompts.length, 6, '3 categories × 2 attempts, then it stops');
    assert.deepStrictEqual(finish.winners, [], 'no winner');
    assert(/لم يتفاعل أحد/.test(text(s)));
  });
  await t('only the active player\'s message counts; others are ignored', async () => {
    tune({ turnMs: 400 });
    const s = fakeSession(['A', 'B', 'C']);
    const p = cats.start(s);
    for (let i = 0; i < 200 && !(s.data.turn && s.data.turn.active); i++) await sleep(5);
    const turn = s.data.turn; const other = ['A', 'B', 'C'].find(x => x !== turn.userId);
    cats.onMessage(s, mkMsg(other, BANK[turn.letter][turn.ci]));
    assert.strictEqual(turn.resolved, false, 'another player\'s correct word does not resolve the turn');
    assert.strictEqual(s.data.totals.get(other), 0);
    cats.onMessage(s, mkMsg(turn.userId, BANK[turn.letter][turn.ci]));
    assert.strictEqual(turn.resolved, true);
    await sleep(40);                                                   // the game loop books the points right after
    assert.strictEqual(s.data.totals.get(turn.userId), 10);
    s.status = 'done'; cats.cleanup(s); await p; restore();
  });
  await t('a late answer after the timer expired is ignored (no points)', async () => {
    tune({ turnMs: 60 });
    const s = fakeSession(['A', 'B']);
    const p = cats.start(s);
    for (let i = 0; i < 200 && !(s.data.turn && s.data.turn.active); i++) await sleep(5);
    const turn = s.data.turn; const ans = BANK[turn.letter][turn.ci];
    await sleep(90);                                                   // timer fired
    assert.strictEqual(turn.resolved, true); assert.strictEqual(turn.done !== null, true);
    cats.onMessage(s, mkMsg(turn.userId, ans));
    assert.strictEqual(s.data.totals.get(turn.userId), 0, 'late answer scored nothing');
    s.status = 'done'; cats.cleanup(s); await p; restore();
  });
  await t('the same message delivered twice (or two answers) scores only once', async () => {
    tune({ turnMs: 400 });
    const s = fakeSession(['A', 'B', 'C']);
    const p = cats.start(s);
    for (let i = 0; i < 200 && !(s.data.turn && s.data.turn.active); i++) await sleep(5);
    const turn = s.data.turn; const ans = BANK[turn.letter][turn.ci];
    const m = mkMsg(turn.userId, ans, 'same-id');
    cats.onMessage(s, m); cats.onMessage(s, m); cats.onMessage(s, mkMsg(turn.userId, ans));
    await sleep(40);
    assert.strictEqual(s.data.totals.get(turn.userId), 10, 'exactly +10');
    s.status = 'done'; cats.cleanup(s); await p; restore();
  });
  await t('an answer already used in the game cannot be reused by the next player', async () => {
    tune({ maxAttempts: 2 });
    const used = [];
    const { s } = await play(['A', 'B'], (i) => {
      if (i.letterIdx === 0 && i.ci === 0) { if (i.attempt === 1) { used.push(i.uid); return good(i); } }
      return good(i);
    });
    restore();
    assert.strictEqual(s.data.board[0].cats[0].answer, BANK[s.data.letters[0]][0]);
    const again = rules.validate(BANK[s.data.letters[0]][0], 0, s.data.letters[0], { used: s.data.used });
    assert.strictEqual(again.reason, 'dup');
  });
  await t('a player who leaves while it is their turn is skipped at once and never asked again', async () => {
    tune({ turnMs: 2000 });
    let left = false;
    const { s, prompts, finish } = await play(['A', 'B', 'C'], (i) => {
      if (!left && i.letterIdx === 0 && i.ci === 1) { left = true; cats.leave(i.s, i.uid); return null; }
      return good(i);
    });
    restore();
    const quitter = prompts.find(p => p.letterIdx === 0 && p.ci === 1).uid;
    const after = prompts.filter(p => !(p.letterIdx === 0 && p.ci <= 1));
    assert(after.every(p => p.uid !== quitter), 'the leaver is never picked again');
    assert(prompts.filter(p => p.letterIdx === 0 && p.ci === 1).length === 2, 'same category was handed to someone else');
    assert(/غير متاح/.test(text(s)), 'skip message');
    assert(finish && !finish.winners.includes(quitter), 'a leaver cannot win');
  });
  await t('the leaver may have the most points but still cannot win', async () => {
    tune({ maxIdleCategories: 3, maxAttempts: 4 });
    let quit = false;
    const { s, finish } = await play(['A', 'B', 'C'], (i) => {
      if (i.letterIdx === 0) return i.uid === 'A' ? good(i) : null;               // only A scores in round 1 (50 points)
      if (!quit) { quit = true; cats.leave(i.s, 'A'); }
      return i.uid === 'B' && i.ci === 0 ? good(i) : null;                        // afterwards B scores a single category
    });
    restore();
    assert(s.data.totals.get('A') > s.data.totals.get('B'), 'A has the most points: ' + JSON.stringify([...s.data.totals]));
    assert.deepStrictEqual(finish.winners, ['B'], 'the winner is someone who stayed');
  });
  await t('fewer than 2 players left → the game ends with a clear message', async () => {
    tune({ turnMs: 2000 });
    const { s, finish } = await play(['A', 'B'], (i) => { if (i.letterIdx === 0 && i.ci === 1) { cats.leave(i.s, 'B'); return null; } return good(i); });
    restore();
    assert(/لم يبقَ لاعبون كافون/.test(text(s)), 'stop note');
    assert(finish && finish.winners.length <= 1 && !finish.winners.includes('B'));
  });
  await t('board: shows letters, finished categories with answer + player + points, past rounds, scores', async () => {
    tune({ turnMs: 2000 });
    let snap = null;
    await play(['A', 'B', 'C'], good, { hook: (i, s) => { if (i.letterIdx === 1 && i.ci === 2 && !snap) snap = cats.boardEmbed(s).toJSON(); } });
    restore();
    assert(snap, 'board captured in round 2');
    const d = snap.description;
    assert(/الحرف الحالي/.test(d) && /⏳/.test(d), 'current letter and the live turn');
    assert(/الجولات السابقة/.test(d), 'previous rounds listed');
    assert(/\(\+10\)/.test(d) && /<@[ABC]>/.test(d), 'answer, player and points of finished categories');
    assert(/✅/.test(d) && /⬜/.test(d), 'done and upcoming categories');
    assert(snap.fields[0].value.includes('**'), 'score table');
    assert(/▶️/.test(d) && /⬜/.test(d), 'letter progress');
  });
  await t('end of each letter: round summary + running totals; end of game: final board and winner', async () => {
    tune();
    const { s, finish } = await play(['A', 'B', 'C'], good);
    restore();
    const summaries = s.channel.sent.filter(m => (m.embeds || []).some(e => /نتائج حرف/.test(e.toJSON().title || '')));
    assert.strictEqual(summaries.length, 5, 'one summary per letter');
    const last = summaries[4].embeds[0].toJSON();
    assert.strictEqual(last.fields[0].name, 'نقاط هذه الجولة'); assert.strictEqual(last.fields[1].name, 'المجموع');
    const sumRound = (e) => e.toJSON().fields[0].value.match(/\*\*\+?(\d+)\*\*/g).map(x => Number(x.replace(/\D/g, ''))).reduce((a, b) => a + b, 0);
    summaries.forEach(m => assert.strictEqual(sumRound(m.embeds[0]), 50, 'each letter hands out 5 × 10'));
    const top = Math.max(...s.data.totals.values());
    assert(finish.winners.every(id => s.data.totals.get(id) === top), 'winners = highest total');
    assert(/انتهت اللعبة/.test(text(s)));
  });
  await t('no stale timers: after the game ends nothing is left running', async () => {
    tune();
    const { s } = await play(['A', 'B', 'C'], good);
    restore();
    assert.strictEqual(s.timers.size, 0, 'all turn timers cleared');
    assert.strictEqual(s.data.turn, null);
  });

  restore();
  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
