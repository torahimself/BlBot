'use strict';
// Night-roles tests.  Run: node dev/test-night.js
process.env.BL_ECONOMY_DB = ':memory:';
const path = require('path');
const E = (f) => require(path.join(__dirname, '..', 'utils', 'economy', 'engine', f));
const settings = E('settings.js'); const dbx = E('dbx.js'); const time = E('time.js');
const activity = E('activity.js'); const night = E('night.js');
settings.drops.chancePerRoll = 0;

let passed = 0, failed = 0;
const ok = (c, n, x = '') => { if (c) { passed++; console.log('  ✓ ' + n); } else { failed++; console.log('  ✗ ' + n + ' ' + x); } };
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), n, `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);
const NEVER = () => 0.999999;
const R = (s) => Date.parse(s + '+03:00');
const VR = settings.nightRoles.voice.roleId, TR = settings.nightRoles.text.roleId;

// ── mocks ──
function mockWorld({ failAdd = new Set(), gone = new Set() } = {}) {
  const sent = [];
  const members = new Map();
  const mk = (id) => {
    if (members.has(id)) return members.get(id);
    const roles = new Set();
    const m = { id, roles: { cache: { has: (r) => roles.has(r) },
      add: async (r) => { if (failAdd.has(id)) throw new Error('Missing Permissions'); roles.add(r); },
      remove: async (r) => { roles.delete(r); } }, send: async (x) => sent.push(x) };
    m._roles = roles; members.set(id, m); return m;
  };
  const role = (rid) => ({ members: { values: () => [...members.values()].filter(m => m._roles.has(rid))[Symbol.iterator]() } });
  const guild = {
    roles: { cache: { has: (r) => r === VR || r === TR, get: role } },
    members: { fetch: async (id) => { if (gone.has(id)) { const e = new Error('Unknown Member'); e.code = 10007; throw e; } return mk(id); } },
  };
  const client = { guilds: { cache: { find: (f) => (f(guild) ? guild : undefined) } }, users: { fetch: async () => { sent.push('DM'); return { send: async () => sent.push('DM') }; } } };
  return { client, mk, members, sent, guild };
}
const holders = async (cat) => (await dbx.all('SELECT userId FROM night_holders WHERE category = ? ORDER BY userId', [cat])).map(r => r.userId);

(async () => {
  await dbx.get('SELECT 1'); settings.validate();

  console.log('\nNight window');
  ok(night.inWindow(R('2026-11-03T00:00:00')), '00:00 Riyadh is night');
  ok(night.inWindow(R('2026-11-03T05:59:59')), '05:59:59 is night');
  ok(!night.inWindow(R('2026-11-03T06:00:00')), '06:00 is not');
  ok(!night.inWindow(R('2026-11-02T23:59:59')), '23:59:59 is not');
  ok(night.inWindow(Date.parse('2026-11-02T21:00:00Z')), '21:00 UTC = 00:00 Riyadh');
  const saved = { ...settings.nightRoles };
  settings.nightRoles.startHour = 22; settings.nightRoles.endHour = 4;
  ok(night.inWindow(R('2026-11-03T23:00:00')) && night.inWindow(R('2026-11-03T03:59:00')) && !night.inWindow(R('2026-11-03T04:00:00')) && !night.inWindow(R('2026-11-03T21:59:00')), 'window wrapping past midnight (22→4)');
  Object.assign(settings.nightRoles, saved);

  console.log('\nCounting (credited units only)');
  const W1 = R('2026-11-01T00:00:00');      // Sunday: the week being ranked
  const DAY = 86400000;
  const nightAt = (d) => W1 + d * DAY + 2 * 3600000;       // 02:00
  const dayAt = (d) => W1 + d * DAY + 14 * 3600000;        // 14:00
  await activity.credit('a', 'text', 5000, { now: dayAt(0), rng: NEVER });
  eq((await dbx.all('SELECT * FROM night_totals WHERE userId = ?', ['a'])).length, 0, 'daytime activity is not counted');
  await activity.credit('a', 'text', 5000, { now: nightAt(0), rng: NEVER });
  eq((await dbx.get("SELECT units FROM night_totals WHERE userId='a' AND source='text'")).units, 5000, 'night typing counted');
  // unit ceiling: beyond it nothing is credited, so nothing is counted at night either
  const c = settings.text.weeklyCharCeiling;
  await activity.credit('cap', 'text', c, { now: dayAt(1), rng: NEVER });
  await activity.credit('cap', 'text', 1000, { now: nightAt(1), rng: NEVER });
  eq((await dbx.all("SELECT * FROM night_totals WHERE userId='cap'")).length, 0, 'over the weekly ceiling → nothing counted');
  await activity.credit('v', 'voice', 90, { now: nightAt(0), rng: NEVER });
  eq((await dbx.get("SELECT units FROM night_totals WHERE userId='v' AND source='voice'")).units, 90, 'night voice counted in minutes');

  console.log('\nRanking, thresholds, tie-break');
  for (let i = 1; i <= 8; i++) await activity.credit('t' + i, 'text', 3000 + i * 100, { now: nightAt(2), rng: NEVER });
  await activity.credit('tie_b', 'text', 9000, { now: nightAt(3), rng: NEVER });
  await activity.credit('tie_a', 'text', 9000, { now: nightAt(3), rng: NEVER });
  await activity.credit('low', 'text', 2999, { now: nightAt(3), rng: NEVER });
  for (let i = 1; i <= 7; i++) await activity.credit('vv' + i, 'voice', 60 + i * 10, { now: nightAt(2), rng: () => 0.9999999 });
  await activity.credit('vlow', 'voice', 59, { now: nightAt(2), rng: NEVER });
  const wk = '2026-11-01';
  eq(await night.rank('text', wk), ['tie_a', 'tie_b', 'a', 't8', 't7'], 'chat: top 5, tie → lower userId first, low excluded');
  eq((await night.rank('voice', wk)).length, 5, 'voice: exactly 5');
  ok(!(await night.rank('voice', wk)).includes('vlow'), 'below the voice minimum → excluded');
  eq(await night.rank('text', '2026-10-25'), [], 'an empty week gives nobody');

  console.log('\nDiscord sync');
  const w = mockWorld();
  const NOW = R('2026-11-08T10:00:00');     // next week → ranks 2026-11-01
  const r1 = await night.syncIfDue(w.client, NOW);
  eq(r1.week, wk, 'ranks the last COMPLETED week');
  eq(await holders('text'), ['a', 't7', 't8', 'tie_a', 'tie_b'], 'chat holders stored');
  ok([...w.members.values()].filter(m => m._roles.has(TR)).length === 5, 'exactly 5 members hold the chat role');
  ok([...w.members.values()].filter(m => m._roles.has(VR)).length === 5, 'exactly 5 members hold the voice role');
  ok(!w.mk('t5')._roles.has(TR), 'rank 6 does not get it');
  const before = JSON.stringify([...w.members.values()].map(m => [m.id, [...m._roles]]));
  await night.syncIfDue(w.client, NOW + 3600000);
  eq(JSON.stringify([...w.members.values()].map(m => [m.id, [...m._roles]])), before, 'a second sync changes nothing (idempotent)');
  eq(w.sent.length, 0, 'no DMs / messages sent');

  console.log('\nRotation');
  // Next week: a newcomer beats everyone; one old holder gets nothing.
  const W2 = R('2026-11-08T00:00:00');
  await activity.credit('newbie', 'text', 20000, { now: W2 + 2 * 3600000, rng: NEVER });
  for (const id of ['tie_a', 'tie_b', 't8', 't7']) await activity.credit(id, 'text', 4000, { now: W2 + DAY + 2 * 3600000, rng: NEVER });
  // 'a' does nothing this week.
  await night.syncIfDue(w.client, R('2026-11-15T09:00:00'));
  ok(w.mk('newbie')._roles.has(TR), 'new top member gains the role');
  ok(!w.mk('a')._roles.has(TR), 'member who dropped out loses it');
  eq((await holders('text')).includes('a'), false, 'holders table updated');
  ok([...w.members.values()].filter(m => m._roles.has(TR)).length === 5, 'still exactly 5 holders');
  // Someone outside the top gets the role by hand → removed by the sweep.
  w.mk('intruder')._roles.add(TR);
  await night.syncIfDue(w.client, R('2026-11-15T10:00:00'));
  ok(!w.mk('intruder')._roles.has(TR), 'a non-top cached member holding the role is cleaned up');

  console.log('\nFailure tolerance');
  const w2 = mockWorld({ failAdd: new Set(['t1']) });
  await dbx.run('DELETE FROM night_holders');
  const origWarn = console.warn; let warns = 0; console.warn = () => { warns++; };
  // week of 2026-11-01 has t1 in voice? use a user who is in the chat top 5 there: tie_a
  w2.guild.members.fetch = ((orig) => async (id) => orig(id))(w2.guild.members.fetch);
  const w3 = mockWorld({ failAdd: new Set(['tie_a']), gone: new Set(['tie_b']) });
  let threw = false;
  try { await night.syncIfDue(w3.client, NOW); await night.syncIfDue(w3.client, NOW + 1000); } catch (_) { threw = true; }
  console.warn = origWarn;
  ok(!threw, 'permission failures and departed members never throw');
  ok(!(await holders('text')).includes('tie_a') && !(await holders('text')).includes('tie_b'), 'failed / departed members are not recorded as holders');
  w3.mk('x');
  w3.guild.members.fetch = async (id) => w3.mk(id);
  w3.mk('tie_a'); const fixed = mockWorld();
  await night.syncIfDue(fixed.client, NOW);
  ok(fixed.mk('tie_a')._roles.has(TR), 'retried next cycle once it works');
  eq(w3.sent.length + fixed.sent.length, 0, 'still no DMs');

  console.log('\nPruning');
  await dbx.run("INSERT INTO night_totals (userId, week, source, units) VALUES ('old', '2025-01-05', 'text', 5)");
  await activity.pruneOld(NOW);
  eq((await dbx.all("SELECT * FROM night_totals WHERE userId='old'")).length, 0, 'old weeks are pruned');

  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
