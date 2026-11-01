'use strict';
// Streaks, levels, ranks, backgrounds and the new profile card. node dev/test-profile2.js
process.env.BL_ECONOMY_DB = ':memory:';
const fs = require('fs'), os = require('os');
const tmp = fs.mkdtempSync(require('path').join(os.tmpdir(), 'bg-'));
process.env.BL_BG_DIR = tmp;
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const db = require(path.join(root, 'utils/economy/database.js'));
const dbx = require(path.join(root, 'utils/economy/engine/dbx.js'));
const time = require(path.join(root, 'utils/economy/engine/time.js'));
const streaks = require(path.join(root, 'utils/economy/engine/streaks.js'));
const stats = require(path.join(root, 'utils/ui/profileStats.js'));
const views = require(path.join(root, 'utils/economy/engine/views.js'));
const R = require(path.join(root, 'utils/ui/render.js'));
const bgs = require(path.join(root, 'utils/ui/backgrounds.js'));
const prefs = require(path.join(root, 'utils/ui/prefs.js'));
const themes = require(path.join(root, 'utils/ui/themes.js'));
const profileCard = require(path.join(root, 'utils/ui/profileCard.js'));
const customize = require(path.join(root, 'utils/ui/customize.js'));
const blocklist = require(path.join(root, 'utils/blocklist.js'));

let passed = 0, failed = 0;
async function t(n, f) { try { await f(); passed++; console.log('  ✓', n); } catch (e) { failed++; console.log('  ✗', n, '\n     ', e.stack.split('\n').slice(0, 3).join('\n      ')); } }
const DAY = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 9, 20, 9, 0, 0);          // some Tuesday, 12:00 Riyadh

(async () => {
  await db.ready;

  console.log('Streaks');
  await t('first activity starts a streak of 1; the same day again changes nothing', async () => {
    const r = await streaks.touch('S1', T0); assert.strictEqual(r.current, 1);
    streaks._forget(); assert.strictEqual(await streaks.touch('S1', T0 + 3600e3), null);
    assert.strictEqual((await streaks.get('S1', T0)).current, 1);
  });
  await t('consecutive days add up; a missed day resets to 1 but keeps the best', async () => {
    for (let i = 1; i <= 4; i++) { streaks._forget(); await streaks.touch('S1', T0 + i * DAY); }
    let g = await streaks.get('S1', T0 + 4 * DAY); assert.strictEqual(g.current, 5); assert.strictEqual(g.best, 5); assert.strictEqual(g.total, 5);
    streaks._forget(); await streaks.touch('S1', T0 + 7 * DAY);       // skipped 2 days
    g = await streaks.get('S1', T0 + 7 * DAY); assert.strictEqual(g.current, 1); assert.strictEqual(g.best, 5);
  });
  await t('a streak shows as 0 once a whole day was missed (before the next activity)', async () => {
    assert.strictEqual((await streaks.get('S1', T0 + 7 * DAY + DAY)).current, 1, 'yesterday still counts');
    assert.strictEqual((await streaks.get('S1', T0 + 7 * DAY + 2 * DAY)).current, 0);
  });
  await t('streak badges are granted once, when reached (3 and 7 days)', async () => {
    for (let i = 0; i < 7; i++) { streaks._forget(); await streaks.touch('S2', T0 + i * DAY); }
    const rows = await dbx.all("SELECT titleId FROM titles WHERE userId = 'S2' ORDER BY titleId");
    assert.deepStrictEqual(rows.map(r => r.titleId), ['st_3', 'st_7']);
    assert.strictEqual(views.titleInfo('st_7').kind, 'streak');
    streaks._forget(); await streaks.touch('S2', T0 + 7 * DAY);
    assert.strictEqual((await dbx.all("SELECT 1 FROM titles WHERE userId = 'S2'")).length, 2);
  });
  await t('the day boundary is Riyadh midnight, not UTC', async () => {
    const lateRiyadh = Date.UTC(2026, 9, 20, 20, 59, 0);          // 23:59 Riyadh
    const earlyNext = Date.UTC(2026, 9, 20, 21, 1, 0);            // 00:01 Riyadh next day
    streaks._forget(); await streaks.touch('S3', lateRiyadh); streaks._forget(); await streaks.touch('S3', earlyNext);
    assert.strictEqual((await streaks.get('S3', earlyNext)).current, 2);
  });
  await t('blocked members get no streak', async () => {
    blocklist._set(['S4']); streaks._forget();
    assert.strictEqual(await streaks.touch('S4', T0), null); assert.strictEqual((await streaks.get('S4', T0)).total, 0);
    blocklist._set([]);
  });

  console.log('Levels and ranks');
  await t('levels grow with xp and never exceed the cap; progress is a fraction', () => {
    const a = stats.levelOf(0), b = stats.levelOf(stats.cumXp(10)), c = stats.levelOf(stats.cumXp(10) + 5);
    assert.strictEqual(a.level, 0); assert.strictEqual(b.level, 10); assert.strictEqual(c.level, 10);
    assert(c.frac > 0 && c.frac < 1); assert.strictEqual(stats.levelOf(1e12).level, stats.MAX_LEVEL);
    assert(stats.xpOf({ voiceMinutes: 100, chars: 400, plays: 2, days: 3 }) === 200 + 20 + 30 + 120);
  });
  await t('ranks count the members ahead of you (blocked members are not counted)', async () => {
    for (const [id, bal, vm, ch] of [['R1', 500, 50, 5000], ['R2', 900, 80, 3000], ['R3', 100, 10, 9000]]) {
      await dbx.run('INSERT INTO users (userId, balance) VALUES (?, ?)', [id, bal]);
      await dbx.run('INSERT INTO act_totals (userId, chars, voiceMinutes) VALUES (?, ?, ?)', [id, ch, vm]);
    }
    let ex = await stats.gather('R1', { balance: 500, chars: 5000, voiceMinutes: 50 });
    assert.deepStrictEqual([ex.ranks.coins, ex.ranks.voice, ex.ranks.text], [2, 2, 2]);
    blocklist._set(['R2']);
    ex = await stats.gather('R1', { balance: 500, chars: 5000, voiceMinutes: 50 });
    assert.deepStrictEqual([ex.ranks.coins, ex.ranks.voice, ex.ranks.text], [1, 1, 2]);
    blocklist._set([]);
  });
  await t('profileData carries the extras, and a member with nothing still works', async () => {
    const d = await views.profileData('NOBODY'); assert(d.extra && d.extra.level.level === 0 && d.extra.streak.current === 0);
  });

  console.log('Backgrounds');
  await t('ten drawn backgrounds with unique ids; free ones need nothing; rules unlock correctly', () => {
    const all = bgs.all(); assert(all.length >= 10); assert.strictEqual(new Set(all.map(b => b.id)).size, all.length);
    assert(all.filter(b => !b.unlock).length >= 2, 'a few free ones');
    const gold = bgs.byId('gold'), forest = bgs.byId('forest'), sakura = bgs.byId('sakura'), hal = bgs.byId('halloween');
    assert(!bgs.isUnlocked(gold, { bestStreak: 29 })); assert(bgs.isUnlocked(gold, { bestStreak: 30 }));
    assert(!bgs.isUnlocked(forest, { level: 7 })); assert(bgs.isUnlocked(forest, { level: 8 }));
    assert(!bgs.isUnlocked(sakura, { titleIds: ['ms_voice_1'] })); assert(bgs.isUnlocked(sakura, { titleIds: ['gb_first_win'] }));
    assert(bgs.isUnlocked(hal, { titleIds: ['event_halloween2026_gold'] }));
    assert(/streak/.test(bgs.describe(gold)) && bgs.describe(bgs.byId('void')) === 'Free');
  });
  await t('every background paints a card (full + compact) without errors', async () => {
    const data = { balance: 1, chars: 1, voiceMinutes: 1, titles: [], extra: {} };
    for (const b of bgs.all()) for (const layout of ['full', 'compact']) {
      const png = await profileCard.render({ name: 'T', avatar: null, data, prefs: { ...themes.DEFAULTS, bg: b.id, layout } });
      assert(png.length > 5000, b.id);
    }
  });
  await t('your own pictures: listed from backgrounds.json, bad entries skipped, unlock rules read', async () => {
    const { c } = R.newCanvas(300, 200); const g = c.getContext('2d'); g.fillStyle = '#336'; g.fillRect(0, 0, 300, 200);
    fs.writeFileSync(path.join(tmp, 'a.png'), c.toBuffer('image/png'));
    fs.writeFileSync(path.join(tmp, 'backgrounds.json'), JSON.stringify([
      { id: 'mine', file: 'a.png', label: 'Mine', unlock: { streak: 5, level: 3 } }, { id: 'free', file: 'a.png' },
      { id: 'gone', file: 'missing.png' }, { id: 'bad id!', file: 'a.png' }, { file: 'a.png' }, 'junk',
    ]));
    bgs._reset();
    const ids = bgs.all().map(b => b.id); assert(ids.includes('c_mine') && ids.includes('c_free')); assert(!ids.some(i => /gone|bad/.test(i)));
    assert.deepStrictEqual(bgs.byId('c_mine').unlock, { streak: 5, level: 3 }); assert.strictEqual(bgs.byId('c_free').unlock, null);
    const png = await profileCard.render({ name: 'T', avatar: null, data: { balance: 1, chars: 1, voiceMinutes: 1, titles: [], extra: {} }, prefs: { ...themes.DEFAULTS, bg: 'c_mine' } });
    assert(png.length > 5000);
  });
  await t('a missing backgrounds.json just means no custom pictures', () => {
    fs.rmSync(path.join(tmp, 'backgrounds.json')); bgs._reset(); assert(!bgs.all().some(b => b.id.startsWith('c_')));
  });
  await t('a saved background is remembered; an unknown one is ignored', async () => {
    await prefs.set('P1', { bg: 'embers' }); assert.strictEqual((await prefs.get('P1')).bg, 'embers');
    await prefs.set('P1', { bg: 'does-not-exist' }); assert.strictEqual((await prefs.get('P1')).bg, null);
  });

  console.log('Customize → Background');
  const calls = (it) => it.calls;
  function mk(userId, customId, extra = {}) {
    const it = { customId, user: { id: userId, username: userId, globalName: userId, displayAvatarURL: () => null }, member: null, calls: [], deferred: false, replied: false,
      isStringSelectMenu: () => !!extra.values, isModalSubmit: () => false, isButton: () => !extra.values, ...extra };
    for (const m of ['deferReply', 'deferUpdate', 'reply', 'editReply', 'followUp']) it[m] = async (o) => { it.calls.push([m, o]); it.deferred = it.deferred || m.startsWith('defer'); return {}; };
    return it;
  }
  await t('a locked background is refused with a private note; a free one is saved; «theme default» clears it', async () => {
    let it = mk('BG1', 'ui:bg:BG1', { values: ['gold'] }); await customize.handle(it);
    assert.strictEqual((await prefs.get('BG1')).bg, null, 'locked → unchanged');
    const note = it.calls.find(c => c[0] === 'followUp'); assert(note && note[1].flags === 64 && /locked/.test(note[1].content) && /streak/.test(note[1].content));
    it = mk('BG1', 'ui:bg:BG1', { values: ['galaxy'] }); await customize.handle(it); assert.strictEqual((await prefs.get('BG1')).bg, 'galaxy');
    it = mk('BG1', 'ui:bg:BG1', { values: ['theme'] }); await customize.handle(it); assert.strictEqual((await prefs.get('BG1')).bg, null);
  });
  await t('reaching the streak unlocks it (and the menu marks it unlocked)', async () => {
    await dbx.run("INSERT INTO streaks (userId, current, best, total, lastDay) VALUES ('BG2', 1, 30, 40, '2020-01-01')");
    let it = mk('BG2', 'ui:bg:BG2', { values: ['gold'] }); await customize.handle(it); assert.strictEqual((await prefs.get('BG2')).bg, 'gold');
    const panel = it.calls.find(c => c[0] === 'editReply')[1];
    const menu = panel.components[0].components[0]; assert.strictEqual(menu.data.custom_id, 'ui:bg:BG2');
    assert(menu.options.length <= 25);
    assert(/Royal Gold/.test(menu.data.placeholder));
  });

  console.log('Titles next to the name');
  await t('chosen titles show in the chosen order (max 3, only owned ones); empty = best three automatically', () => {
    const data = { balance: 1, chars: 1, voiceMinutes: 1, titles: ['ms_voice_1', 'ms_voice_2', 'ms_text_1', 'gb_first_win', 'st_3'].map((id, i) => ({ titleId: id, earnedAt: i })) };
    const auto = profileCard.model(data, themes.DEFAULTS);
    assert.strictEqual(auto.chips.length, 3); assert.strictEqual(auto.badges.length, 2);
    const m = profileCard.model(data, { ...themes.DEFAULTS, chips: ['st_3', 'NOT_MINE', 'gb_first_win', 'ms_voice_1', 'ms_text_1'] });
    assert.deepStrictEqual(m.chips.map(c => c.id), ['st_3', 'gb_first_win', 'ms_voice_1']);
    assert.deepStrictEqual(m.badges.map(c => c.id).sort(), ['ms_text_1', 'ms_voice_2']);
    assert.strictEqual(m.featured.id, 'st_3');
    assert.deepStrictEqual(profileCard.model(data, { ...themes.DEFAULTS, chips: ['NOT_MINE'] }).chips.length, 3, 'nothing valid → automatic');
  });
  await t('the menu saves at most 3 titles and the panel offers a multi-select', async () => {
    await dbx.run("INSERT INTO titles (userId, titleId, category, earnedAt) VALUES ('CH1', 'ms_voice_1', 'm', 1), ('CH1', 'gb_first_win', 'game', 2)");
    let it = mk('CH1', 'ui:ch:CH1', { values: ['ms_voice_1', 'gb_first_win', 'a', 'b'] }); await customize.handle(it);
    assert.deepStrictEqual((await prefs.get('CH1')).chips, ['ms_voice_1', 'gb_first_win', 'a']);
    const panel = it.calls.find(c => c[0] === 'editReply')[1];
    const menu = panel.components.flatMap(r => r.components).find(c => c.data.custom_id === 'ui:ch:CH1');
    assert(menu && menu.data.min_values === 0 && menu.data.max_values === 2, 'up to 3, never more than the titles owned');
    assert.strictEqual(panel.components.length, 5);
  });

  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
