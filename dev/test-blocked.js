'use strict';
// Quiet block list. node dev/test-blocked.js
process.env.BL_ECONOMY_DB = ':memory:';
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const db = require(path.join(root, 'utils/economy/database.js'));
const dbx = require(path.join(root, 'utils/economy/engine/dbx.js'));
const activity = require(path.join(root, 'utils/economy/engine/activity.js'));
const events = require(path.join(root, 'utils/economy/engine/events.js'));
const night = require(path.join(root, 'utils/economy/engine/night.js'));
const bl = require(path.join(root, 'utils/blocklist.js'));
const msgEvent = require(path.join(root, 'events/messageCreate.js'));
const intEvent = require(path.join(root, 'events/interactionCreate.js'));

let passed = 0, failed = 0;
async function t(n, f) { try { await f(); passed++; console.log('  ✓', n); } catch (e) { failed++; console.log('  ✗', n, '\n     ', e.stack.split('\n').slice(0, 3).join('\n      ')); } }
const dms = [];
const client = { users: { fetch: async (id) => ({ send: async (c) => { dms.push([id, c]); } }) } };
function mkCmd(userId, name, opts = []) {
  const it = { user: { id: userId }, client, commandName: name, options: { data: opts }, calls: [], replied: false, deferred: false,
    isChatInputCommand: () => true, isMessageComponent: () => false, isModalSubmit: () => false, isButton: () => false, isStringSelectMenu: () => false,
    deferReply: async (o) => { it.calls.push('defer'); }, deleteReply: async () => { it.calls.push('delete'); }, reply: async (o) => { it.calls.push(['reply', o.content]); }, editReply: async () => { it.calls.push('edit'); } };
  return it;
}

(async () => {
  await db.ready;
  bl._set(['B1']);

  await t('a blocked member earns nothing (text / voice) and nothing is saved', async () => {
    const r1 = await activity.credit('B1', 'text', 500); assert.strictEqual(r1.counted, false);
    const r2 = await activity.credit('B1', 'voice', 30); assert.strictEqual(r2.counted, false);
    assert(!(await dbx.get('SELECT 1 FROM users WHERE userId = ?', ['B1'])));
    assert(!(await dbx.get('SELECT 1 FROM event_points WHERE userId = ?', ['B1'])));
    const ok = await activity.credit('OK1', 'text', 500); assert(ok.counted);
  });
  await t('blocked slash command: silent (defer + delete), one DM, command never runs', async () => {
    dms.length = 0;
    const it = mkCmd('B1', 'balance'); const handled = await bl.gateInteraction(it);
    assert(handled); assert.deepStrictEqual(it.calls, ['defer', 'delete']);
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(dms.length, 1); assert(/access/.test(dms[0][1]));
    await bl.gateInteraction(mkCmd('B1', 'profile')); await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(dms.length, 1, 'DM at most once a day');
  });
  await t('staff tools still work for/against blocked members', async () => {
    assert(!(await bl.gateInteraction(mkCmd('B1', 'warn'))), 'a blocked staff member keeps staff tools');
    const w = mkCmd('STAFF', 'warn', [{ type: 6, user: { id: 'B1' } }]);
    assert(!(await bl.gateInteraction(w)), 'warning a blocked member is allowed');
    const j = mkCmd('STAFF', 'jail', [{ type: 6, user: { id: 'B1' } }]); assert(!(await bl.gateInteraction(j)));
  });
  await t('challenging / trading with a blocked member gets a neutral refusal', async () => {
    const it = mkCmd('OK1', 'coinflip', [{ type: 6, user: { id: 'B1' } }]);
    assert(await bl.gateInteraction(it));
    assert(it.calls[0][0] === 'reply' && !/block/i.test(it.calls[0][1]));
    const self = mkCmd('OK1', 'coinflip', [{ type: 6, user: { id: 'OK2' } }]); assert(!(await bl.gateInteraction(self)));
  });
  await t('blocked buttons / selects / forms are swallowed silently, staff warn buttons are not', async () => {
    const btn = { user: { id: 'B1' }, client, customId: 'pg:1:join', isChatInputCommand: () => false, deferUpdate: async () => { btn.done = true; } };
    assert(await bl.gateInteraction(btn)); assert(btn.done);
    const wh = { user: { id: 'B1' }, client, customId: 'warnhist_x', isChatInputCommand: () => false, deferUpdate: async () => {} };
    assert(!(await bl.gateInteraction(wh)));
  });
  await t('interactionCreate stops before running anything for a blocked member', async () => {
    const it = mkCmd('B1', 'work'); await intEvent.execute(it);
    assert.deepStrictEqual(it.calls, ['defer', 'delete']);
  });
  await t('blocked chat messages: ignored (no coins, no game); game triggers only earn the DM', async () => {
    dms.length = 0; bl._set(['B2']);
    const m = (c) => ({ author: { id: 'B2', bot: false }, content: c, client, guild: { id: 'g' }, channel: { id: 'c' }, reply: async () => { throw new Error('must not reply'); } });
    await msgEvent.execute(m('hello everybody this is a long message to type here')); await msgEvent.execute(m('.علم'));
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(dms.length, 1);
    assert(!(await dbx.get('SELECT 1 FROM users WHERE userId = ?', ['B2'])));
    bl._set(['B1']);
  });
  await t('event totals and night ranking leave blocked members out', async () => {
    const ev = events.current(); if (!ev) return;
    await dbx.run('INSERT INTO event_points (eventId, userId, textChars, voiceMinutes, games) VALUES (?, ?, 9999, 9999, 9)', [ev.id, 'B1']);
    await dbx.run('INSERT OR REPLACE INTO event_points (eventId, userId, textChars, voiceMinutes, games) VALUES (?, ?, 120, 8, 1)', [ev.id, 'OK1']);
    const agg = await events.communityAgg ? await events.communityAgg(ev) : null;
    if (agg) assert.strictEqual(agg.participants, 1);
    const time = require(path.join(root, 'utils/economy/engine/time.js'));
    const wk = time.addDays(time.weekStartKey(Date.now()), -7);
    await dbx.run("INSERT INTO night_totals (userId, week, source, units) VALUES ('B1', ?, 'voice', 900), ('OK1', ?, 'voice', 100)", [wk, wk]);
    assert.deepStrictEqual(await night.rank('voice', wk), ['OK1']);
  });
  await t('nobody blocked → no overhead, no SQL change', () => { bl._set([]); assert.strictEqual(bl.sqlExclude(), ''); assert(!bl.isBlocked('B1')); bl._set(['B1']); });

  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
