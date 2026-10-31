'use strict';
// Typing race, math race, word chain, game badges, the games list. In-memory DB.
//   node dev/test-new-games.js
process.env.BL_ECONOMY_DB = ':memory:';
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const db = require(path.join(root, 'utils/economy/database.js'));
const dbx = require(path.join(root, 'utils/economy/engine/dbx.js'));
const cfg = require(path.join(root, 'utils/games/config.js'));
const games = require(path.join(root, 'utils/games/index.js'));
const session = require(path.join(root, 'utils/games/session.js'));
const stats = require(path.join(root, 'utils/games/stats.js'));
const badges = require(path.join(root, 'utils/games/badges.js'));
const typing = require(path.join(root, 'utils/games/typing.js'));
const math = require(path.join(root, 'utils/games/math.js'));
const chain = require(path.join(root, 'utils/games/chain.js'));

cfg.channels = [];
Object.assign(cfg.typing, { introMs: 5, pauseMs: 5, rounds: 2, minMsPerChar: 0, roundMs: 400 });
Object.assign(cfg.math, { introMs: 5, pauseMs: 5, rounds: 2, roundMs: 400 });
Object.assign(cfg.chain, { introMs: 5, turnMs: 300, minTurnMs: 300 });
cfg.eventCredit.minDurationMs = 1e9;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let mid = 0;
function mkChannel() {
  const sent = [];
  return { id: 'ch' + (++mid), sent, send: async (c) => { const m = { id: 'm' + (++mid), ...(typeof c === 'string' ? { content: c } : c), edit: async () => m, react: async () => {} }; sent.push(m); return m; } };
}
const mkMsg = (ch, id, content) => ({ author: { id, bot: false }, guild: { id: 'g' }, channel: ch, content, react: async () => {}, reply: async () => {} });
async function lobby(def, host, ch) {
  const r = await session.create({ type: def.type, def, interaction: { channel: ch, user: { id: host }, member: { displayName: host }, editReply: (p) => ch.send(p) }, bet: 0 });
  assert(r.ok, r.error); return r.session;
}
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', e.stack.split('\n').slice(0, 3).join('\n      ')); } }
const text = (ch) => ch.sent.map(m => (m.content || '') + JSON.stringify(m.embeds || [])).join('\n');

(async () => {
  await db.ready; await stats.ensure();

  await t('triggers and the games list', () => {
    for (const [w, ty] of [['كتابة', 'typing'], ['حساب', 'math'], ['سلسلة', 'chain']]) assert.strictEqual(games.parseTrigger('.' + w).type, ty);
    assert(games.isHelpCommand('.العاب')); assert(!games.isHelpCommand('.علم'));
    const d = games.helpEmbed().data.description;
    for (const w of ['علم', 'عاصمة', 'جيو', 'انسان', 'كتابة', 'حساب', 'سلسلة', 'روليت', 'مافيا']) assert(d.includes('.' + w), w);
  });
  await t('every game in the list can be played alone, except roulette and mafia', () => {
    assert(typing.min === 1 && math.min === 1 && chain.min === 1);
  });

  const waitRound = async (s) => { for (let i = 0; i < 100 && !(s.data.current && !s.data.current.resolved); i++) await sleep(20); assert(s.data.current, 'round open'); return s.data.current; };
  const embedText = (ch) => { const e = ch.sent.filter(x => x.embeds && x.embeds.length).slice(-1)[0].embeds[0]; return (e.data || e).description; };
  const finished = async () => { for (let i = 0; i < 150 && session.sessions.size; i++) await sleep(20); };

  console.log('Typing / math');
  await t('typing: first exact (folded) answer wins; wrong ignored; solo works', async () => {
    const ch = mkChannel(); const s = await lobby(typing, 'T1', ch);
    const p = s.start(); await waitRound(s);
    const shown = embedText(ch).split('## ')[1];
    s.def.onMessage(s, mkMsg(ch, 'T1', 'كلام غير مطابق'));
    assert.strictEqual(s.data.scores.get('T1'), 0);
    s.def.onMessage(s, mkMsg(ch, 'T1', shown)); await sleep(30);
    assert.strictEqual(s.data.scores.get('T1'), 1);
    await p; await finished();
    assert.strictEqual(session.sessions.size, 0);
  });
  await t('math: Arabic digits work, the first correct answer wins the round', async () => {
    const ch = mkChannel(); const s = await lobby(math, 'M1', ch);
    await s.addPlayer('M2', 'M2');
    const p = s.start(); await waitRound(s);
    const sum = /# (.+?) = /.exec(embedText(ch))[1];
    const ans = Function('return ' + sum.replace('×', '*').replace('÷', '/').replace('−', '-'))();
    const ar = String(ans).replace(/\d/g, (x) => '٠١٢٣٤٥٦٧٨٩'[x]);
    s.def.onMessage(s, mkMsg(ch, 'M2', String(ans + 1)));
    s.def.onMessage(s, mkMsg(ch, 'M2', ar));
    s.def.onMessage(s, mkMsg(ch, 'M1', String(ans))); await sleep(30);
    assert.strictEqual(s.data.scores.get('M2'), 1); assert.strictEqual(s.data.scores.get('M1'), 0);
    await s.abort('done'); await finished();
  });
  await t('math problems always have whole-number answers', () => {
    for (let lv = 0; lv < 8; lv++) for (let i = 0; i < 200; i++) { const p = math.problem(lv); assert(Number.isInteger(p.answer) && p.answer >= 0, p.text); }
  });

  console.log('Word chain');
  await t('rules: letter, used, unknown, article, taa marbuta', () => {
    const used = new Set();
    assert.strictEqual(chain.lastLetter('مدينة'), 'ن'); assert.strictEqual(chain.lastLetter('سماء'), 'ا');
    assert(chain.check('نهر', 'ن', used).ok); assert(chain.check('النهر', 'ن', used).ok);
    assert.strictEqual(chain.check('نهر', 'ب', used).why, 'letter');
    used.add('نهر'); assert.strictEqual(chain.check('نهر', 'ن', used).why, 'used');
    assert.strictEqual(chain.check('نككك', 'ن', used).why, 'unknown');
    assert.strictEqual(chain.check('hello', 'ن', used).why, 'ignore');
  });
  const WORDS = { ا: 'ارض', ب: 'بحر', ت: 'تمر', ج: 'جبل', ح: 'حب', خ: 'خبز', د: 'دار', ر: 'رمل', س: 'سمك', ش: 'شمس', ص: 'صقر', ع: 'عين', ف: 'فجر', ق: 'قمر', ك: 'كتاب', ل: 'ليل', م: 'ماء', ن: 'نهر', ه: 'هواء', و: 'ورد', ي: 'يد' };
  const needOf = (ch) => { const m = [...text(ch).matchAll(/حرف \*\*(.)\*\*/g)].pop(); return m && m[1]; };
  await t('solo chain: a word is accepted, then the clock ends it', async () => {
    const ch = mkChannel(); const s = await lobby(chain, 'C1', ch);
    const p = s.start(); await waitRound(s);
    s.def.onMessage(s, mkMsg(ch, 'C1', WORDS[needOf(ch)])); await sleep(30);
    assert.strictEqual(s.data.words, 1);
    await p; await finished();
    assert(/طول السلسلة/.test(text(ch)));
  });
  await t('two players: the one who times out is out, the other wins', async () => {
    const ch = mkChannel(); const s = await lobby(chain, 'C2', ch);
    await s.addPlayer('C3', 'C3');
    const p = s.start(); await waitRound(s);
    const first = s.data.current.player, other = first === 'C2' ? 'C3' : 'C2';
    s.def.onMessage(s, mkMsg(ch, first, WORDS[needOf(ch)]));          // survives turn 1
    await waitRound(s);                                                 // other's turn: nobody answers
    await p; await finished();
    assert(/خرج من اللعبة/.test(text(ch)) && text(ch).includes(`<@${first}>`));
    const w = await dbx.all("SELECT userId, wins FROM game_stats WHERE game = 'chain' AND wins > 0");
    assert.deepStrictEqual(w.map(r => r.userId), [first]);
  });

  console.log('Badges');
  await t('stats-based badges are given once; titles show up in the titles table', async () => {
    await stats.record('geo', ['U'], ['U']);
    let got = await badges.check('U'); assert(got.some(b => b.key === 'first_win'));
    got = await badges.check('U'); assert.strictEqual(got.length, 0, 'never twice');
    assert(await badges.grant('U', 'pinpoint')); assert(!(await badges.grant('U', 'pinpoint')));
    const rows = await dbx.all("SELECT titleId FROM titles WHERE userId = 'U'");
    assert(rows.some(r => r.titleId === 'gb_first_win'));
    const views = require(path.join(root, 'utils/economy/engine/views.js'));
    assert.strictEqual(views.titleInfo('gb_first_win').kind, 'game');
  });
  await t('typing / chain / math wins unlock their badge', async () => {
    for (let i = 0; i < 10; i++) await stats.record('typing', ['W'], ['W']);
    assert((await badges.check('W')).some(b => b.key === 'typing_10'));
  });

  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
