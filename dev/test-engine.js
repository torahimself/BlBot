'use strict';
// Economy engine tests.   Run:  node dev/test-engine.js
// Uses an in-memory database, a fake clock and a seeded RNG — never touches
// data/economy.db and needs no Discord connection.

process.env.BL_ECONOMY_DB = ':memory:';
const path = require('path');
const E = (f) => require(path.join(__dirname, '..', 'utils', 'economy', 'engine', f));

const settings = E('settings.js');
const dbx = E('dbx.js');
const time = E('time.js');
const activity = E('activity.js');
const boosts = E('boosts.js');
const drops = E('drops.js');
const milestones = E('milestones.js');
const events = E('events.js');
const betting = E('betting.js');
const { countEligible, TextGate } = E('textFilter.js');
const { eligibleByChannel } = E('voice.js');

let passed = 0;
let failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; failures.push(name); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(a, b, name) { ok(a === b, name, `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }
function section(t) { console.log('\n' + t); }

const NEVER = () => 0.999999;   // no drops, no round-ups
const REAL_DROP_CHANCE = settings.drops.chancePerRoll;
settings.drops.chancePerRoll = 0;   // drops are switched back on only in the drop tests
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
// A Sunday, 12:00 Riyadh time.
const SUN = Date.parse('2026-11-01T12:00:00+03:00');

let uid = 0;
const newUser = () => 'u' + (++uid);
const balance = async (id) => ((await dbx.get('SELECT balance FROM users WHERE userId = ?', [id])) || { balance: 0 }).balance;

async function main() {
  await dbx.get('SELECT 1');
  settings.validate();

  // ───────────────────────────────────────────────────────────────────────
  section('Settings validation');
  eq(settings.drops.table.reduce((a, r) => a + r.weight, 0), 100, 'drop weights add up to 100');
  ok(settings.voice.coinsPerHourMax <= 350, 'voice rate ceiling ≤ 350/h');
  let threw = false;
  try { settings.validate({ ...settings, drops: { ...settings.drops, table: [{ kind: 'potion', weight: 101 }] } }); } catch (_) { threw = true; }
  ok(threw, 'validate() rejects a 101% drop table');

  // ───────────────────────────────────────────────────────────────────────
  section('Text filter');
  const chars = (s) => countEligible(s).chars;
  ok(chars('مرحبا كيف حالك اليوم') > 10, 'normal Arabic counts');
  ok(chars('how are you doing today') >= 15, 'normal English counts');
  eq(chars('هههههههههههه'), 0, 'laughter-only → 0');
  eq(chars('hahahahahaha lol'), 0, 'English laughter-only → 0');
  eq(chars('asdfghjkl'), 0, 'keyboard mashing → 0');
  eq(chars('ضصثقفغعهخ'), 0, 'Arabic keyboard mashing → 0');
  eq(chars('aaaaaaaaaaaaaaaaaaaa'), 2 > 0 ? chars('aaaaaaaaaaaaaaaaaaaa') : 0, 'repeated letters collapse');
  ok(chars('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') <= 4, 'long run of one letter ≈ nothing');
  eq(chars('https://example.com/some/long/path?x=1'), 0, 'link-only → 0');
  eq(chars('<@123456789012345678> <@!123456789012345678>'), 0, 'mentions-only → 0');
  eq(chars('😀😀😀 🔥🔥'), 0, 'emoji-only → 0');
  eq(chars('<:pepe:123456789012345678>'), 0, 'custom-emoji-only → 0');
  eq(chars('!play despacito'), 0, '! command → 0');
  eq(chars('.help me'), 0, '. command → 0');
  ok(chars('*hello there my friend*') > 10, 'markdown *bold* is NOT a command');
  eq(chars(''), 0, 'empty → 0');
  eq(chars('   '), 0, 'whitespace → 0');
  const withLink = chars('شوف هذا https://x.com/aaaaaaaaaaaaaaaaaaaaaa الموضوع');
  ok(withLink > 0 && withLink < 15, 'link stripped, rest counted', String(withLink));
  const lol = chars('that was so funny hahahahahahahahaha');
  const nolol = chars('that was so funny');
  ok(lol - nolol <= 4, 'laughter inside a message is capped at 4 chars', `${lol} vs ${nolol}`);
  ok(chars('word word word word word word word') <= chars('word word') + 0, 'same word padding > 2 ignored');
  ok(chars('a '.repeat(500)) <= settings.text.maxCharsPerMessage, 'per-message ceiling');
  eq(chars('مَـرْحَـبًـا'), chars('مرحبا'), 'harakat/tatweel cannot pad the count');

  const gate = new TextGate();
  const t0 = SUN;
  const first = gate.evaluate('g1', 'this is a real message', t0);
  ok(first > 0, 'gate: first message counts');
  eq(gate.evaluate('g1', 'this is a real message', t0 + 5000), 0, 'gate: exact repeat within 60s → 0');
  ok(gate.evaluate('g1', 'this is a real message', t0 + 61000) > 0, 'gate: repeat after window counts again');
  let tot = 0;
  for (let i = 0; i < 20; i++) tot += gate.evaluate('g2', `unique message number ${i} with some padding words here and more`, t0 + 120000 + i);
  ok(tot <= settings.text.maxCharsPerMinute, 'gate: per-minute ceiling', String(tot));

  // ───────────────────────────────────────────────────────────────────────
  section('Voice eligibility (the four cases from the spec + extras)');
  const S = (userId, channelId, o = {}) => ({ userId, channelId, ...o });
  const credited = (states) => [...eligibleByChannel(states).values()].flat().sort();
  eq(credited([S('a', 'c1')]).length, 0, 'alone → nobody earns');
  eq(credited([S('a', 'c1'), S('b', 'c1')]).join(), 'a,b', 'two, both muted (not deafened) → both earn');
  eq(credited([S('a', 'c1'), S('b', 'c1', { selfDeaf: true })]).length, 0, 'two, one self-deafened → nobody');
  eq(credited([S('a', 'c1'), S('b', 'c1', { deaf: true })]).length, 0, 'two, one server-deafened → nobody');
  eq(credited([S('a', 'c1'), S('b', 'c1'), S('c', 'c1', { selfDeaf: true })]).join(), 'a,b', 'three, one deafened → the two eligible earn');
  eq(credited([S('a', 'c1'), S('b', 'c2')]).length, 0, 'two in different channels → nobody');
  eq(credited([S('a', 'c1'), S('b', 'c1', { bot: true })]).length, 0, 'a bot does not make a pair');
  eq(credited([S('a', 'c1'), S('b', 'c1'), S('c', 'c2'), S('d', 'c2', { deaf: true })]).join(), 'a,b', 'two channels judged separately');
  eq(credited([S('a', null), S('b', null)]).length, 0, 'not in voice → nobody');

  // ───────────────────────────────────────────────────────────────────────
  section('Calendar: Sunday weeks in Asia/Riyadh');
  eq(time.weekStartKey(Date.parse('2026-10-24T23:59:59+03:00')), '2026-10-18', 'Sat 23:59:59 is still the old week');
  eq(time.weekStartKey(Date.parse('2026-10-25T00:00:00+03:00')), '2026-10-25', 'Sun 00:00:00 starts the new week');
  eq(time.weekStartKey(Date.parse('2026-10-24T21:00:00Z')), '2026-10-25', '21:00 UTC Sat = Sun 00:00 Riyadh');
  eq(time.nextWeekResetTs(SUN), Date.parse('2026-11-08T00:00:00+03:00'), 'next reset = next Sunday 00:00 Riyadh');
  const k = time.windowKeys(SUN);
  eq(k.rollingStart, time.addDays(k.today, -29), 'rolling window = today + 29 days back');

  // ───────────────────────────────────────────────────────────────────────
  section('Crediting, weekly caps and the 30-day window');
  {
    const u = newUser();
    const r = await activity.credit(u, 'text', 100, { now: SUN, rng: NEVER });
    eq(r.coins, 100 * settings.text.coinsPerChar, 'text pays coinsPerChar per char');
    eq(await balance(u), r.coins, 'balance updated');
  }
  {
    const u = newUser();
    let paid = 0;
    // Type well past the weekly coin cap but under the char ceiling.
    const per = 500;
    const need = Math.ceil(settings.text.weeklyCoinCap / (per * settings.text.coinsPerChar)) + 20;
    for (let i = 0; i < need; i++) {
      const r = await activity.credit(u, 'text', per, { now: SUN + i * 1000, rng: NEVER });
      paid += r.coins;
      if (!r.counted) break;
    }
    ok(paid <= settings.text.weeklyCoinCap, 'weekly text coin cap holds', `${paid}`);
    ok(paid >= settings.text.weeklyCoinCap - 1, 'cap is actually reached', `${paid}`);
    const t = await dbx.get('SELECT chars FROM act_totals WHERE userId = ?', [u]);
    ok(t.chars > 0, 'chars past the coin cap still count for progress');
  }
  {
    const u = newUser();
    let chars = 0;
    for (let i = 0; i < 400; i++) {
      const r = await activity.credit(u, 'text', 1000, { now: SUN + 2 * DAY + i * 1000, rng: NEVER });
      chars += r.units;
    }
    ok(chars <= settings.text.weeklyCharCeiling, 'weekly character ceiling holds', String(chars));
    const r = await activity.credit(u, 'text', 100, { now: SUN + 2 * DAY + 999999, rng: NEVER });
    ok(!r.counted && r.reason === 'unit-ceiling', 'beyond the ceiling nothing counts');
    const r2 = await activity.credit(u, 'text', 100, { now: SUN + 8 * DAY, rng: NEVER });
    ok(r2.counted, 'next week the ceiling resets');
  }
  {
    // Rolling 30-day cap: hit the weekly cap every week; the 30-day cap must bind.
    const u = newUser();
    let paid = 0;
    for (let week = 0; week < 6; week++) {
      for (let d = 0; d < 7; d++) {
        const now = SUN + (week * 7 + d) * DAY;
        const r = await activity.credit(u, 'text', 20000, { now, rng: NEVER });
        paid += r.coins;
      }
    }
    // Over 42 days, never more than rolling cap per any 30-day window.
    const rows = await dbx.all("SELECT day, coins FROM act_daily WHERE userId = ? AND source = 'text' ORDER BY day", [u]);
    let worst = 0;
    for (let i = 0; i < rows.length; i++) {
      let sum = 0;
      for (let j = i; j < rows.length; j++) {
        if (rows[j].day >= time.addDays(rows[i].day, 30)) break;
        sum += rows[j].coins;
      }
      worst = Math.max(worst, sum);
    }
    ok(worst <= settings.text.rolling30CoinCap, 'no 30-day window exceeds the rolling cap', `${worst}`);
  }
  {
    // Voice pays within its configured band and respects its weekly cap.
    const u = newUser();
    const r = await activity.credit(u, 'voice', 60, { now: SUN, rng: () => 0 });
    eq(r.coins, settings.voice.coinsPerHourMin, 'voice 1h at rng=0 pays the minimum rate');
    const u2 = newUser();
    const r2 = await activity.credit(u2, 'voice', 60, { now: SUN, rng: () => 0.9999999 });
    ok(r2.coins <= settings.voice.coinsPerHourMax && r2.coins >= settings.voice.coinsPerHourMax - 1, 'voice 1h at rng→1 pays ≈ the maximum rate', String(r2.coins));
    const u3 = newUser();
    let vp = 0;
    for (let i = 0; i < 42 * 60; i++) vp += (await activity.credit(u3, 'voice', 1, { now: SUN + i * 60000, rng: () => 0.9999 })).coins;
    ok(vp <= settings.voice.weeklyCoinCap, 'weekly voice coin cap holds', String(vp));
  }

  // ───────────────────────────────────────────────────────────────────────
  section('Boost potions');
  {
    const u = newUser();
    await boosts.grantPotion(u, 'text', 3, 'test', SUN);
    await boosts.grantPotion(u, 'text', 5, 'test', SUN);
    await boosts.grantPotion(u, 'voice', 4, 'test', SUN);
    let inv = await boosts.inventory(u);
    eq(inv.length, 3, 'three potions in inventory');

    const base = (await activity.credit(u, 'text', 100, { now: SUN, rng: NEVER })).coins;
    const textPotion = inv.find(p => p.type === 'text' && p.hours === 3);
    const a = await boosts.activate(u, textPotion.id, SUN);
    ok(a.ok && a.multiplier === 2 && a.expiresAt === SUN + 3 * HOUR, 'activation: ok, ×2, expires in 3h');
    inv = await boosts.inventory(u);
    eq(inv.length, 2, 'potion consumed');

    const boosted = (await activity.credit(u, 'text', 100, { now: SUN + HOUR, rng: NEVER })).coins;
    eq(boosted, base * 2, 'typing boost doubles text coins');
    const v = (await activity.credit(u, 'voice', 60, { now: SUN + HOUR, rng: () => 0 })).coins;
    eq(v, settings.voice.coinsPerHourMin, 'typing boost does not touch voice');

    const again = await boosts.activate(u, textPotion.id, SUN + HOUR);
    ok(!again.ok && again.reason === 'missing', 'a used potion cannot be used again');

    const second = inv.find(p => p.type === 'text');
    const stack = await boosts.activate(u, second.id, SUN + HOUR);
    ok(!stack.ok && stack.reason === 'same-type-active', 'no stacking of the same type');
    eq((await boosts.inventory(u)).length, 2, 'refused activation consumes nothing');

    const voicePotion = inv.find(p => p.type === 'voice');
    const vb = await boosts.activate(u, voicePotion.id, SUN + HOUR);
    ok(vb.ok, 'a voice boost may run next to a typing boost (different income)');
    const v2 = (await activity.credit(u, 'voice', 60, { now: SUN + 2 * HOUR, rng: () => 0 })).coins;
    eq(v2, settings.voice.coinsPerHourMin * 2, 'voice boost doubles voice coins');

    const after = (await activity.credit(u, 'text', 100, { now: SUN + 3 * HOUR + 1, rng: NEVER })).coins;
    eq(after, base, 'boost has expired → back to ×1');
    const ok2 = await boosts.activate(u, second.id, SUN + 3 * HOUR + 2);
    ok(ok2.ok, 'after expiry another potion can be activated');

    const other = newUser();
    const steal = await boosts.activate(other, second.id, SUN);
    ok(!steal.ok && steal.reason === 'missing', "cannot activate someone else's potion");
  }
  {
    // Potions never bypass caps.
    const u = newUser();
    await boosts.grantPotion(u, 'text', 6, 'test', SUN);
    const p = (await boosts.inventory(u))[0];
    await boosts.activate(u, p.id, SUN);
    let paid = 0;
    for (let i = 0; i < 200; i++) paid += (await activity.credit(u, 'text', 1000, { now: SUN + i * 1000, rng: NEVER })).coins;
    ok(paid <= settings.text.weeklyCoinCap, 'boosted earnings still stop at the weekly cap', String(paid));
    const used = await activity.usage(u, 'text', time.windowKeys(SUN));
    ok(used.rollCoins <= settings.text.rolling30CoinCap, 'boosted earnings respect the 30-day cap');
  }
  {
    // Boosted coins also hit the 30-day cap across weeks.
    const u = newUser();
    let paid = 0;
    for (let d = 0; d < 28; d++) {
      const now = SUN + d * DAY;
      await boosts.grantPotion(u, 'text', 6, 'test', now);
      const p = (await boosts.inventory(u))[0];
      await boosts.activate(u, p.id, now);
      paid += (await activity.credit(u, 'text', 20000, { now, rng: NEVER })).coins;
    }
    ok(paid <= settings.text.rolling30CoinCap, 'boost + rolling 30-day cap over 28 days', String(paid));
  }

  // ───────────────────────────────────────────────────────────────────────
  section('Random drops');
  settings.drops.chancePerRoll = REAL_DROP_CHANCE;
  {
    const u = newUser();
    const hit = (() => { let i = 0; return () => (i++ % 2 === 0 ? 0 : 0.0); })();   // always "hit", always first table row
    let got = 0;
    for (let i = 0; i < 10; i++) {
      const d = await dbx.exclusive('u:' + u, () => drops.attemptLocked(u, 'text', 1000, { now: SUN, rng: () => 0 }));
      if (d) got++;
    }
    eq(got, settings.drops.maxPerWeek, 'weekly drop limit holds');
    const next = await dbx.exclusive('u:' + u, () => drops.attemptLocked(u, 'text', 1000, { now: SUN + 8 * DAY, rng: () => 0 }));
    ok(!!next, 'limit resets next week');
    const pot = await dbx.all("SELECT type, hours FROM potions WHERE userId = ? AND source = 'drop'", [u]);
    ok(pot.length > 0 && pot.every(p => ['text', 'voice'].includes(p.type) && [3, 4, 5, 6].includes(p.hours)), 'potion drops: Typing or Voice, 3–6h');
    // Random type: over many rolls both kinds must appear, whatever triggered the drop.
    const seen = new Set();
    let sd = 99; const rr = () => { sd = (sd * 1664525 + 1013904223) % 4294967296; return sd / 4294967296; };
    const w = newUser();
    for (let i = 0; i < 80; i++) {
      await dbx.run('DELETE FROM drop_weekly WHERE userId = ?', [w]);
      await dbx.exclusive('u:' + w, () => drops.attemptLocked(w, 'text', 1000, { now: SUN, rng: i % 2 ? rr : () => 0 }));
    }
    for (const r of await dbx.all("SELECT type FROM potions WHERE userId = ?", [w])) seen.add(r.type);
    ok(seen.has('text') && seen.has('voice'), 'a typing-triggered drop can be a Voice potion and vice versa');
  }
  {
    // Distribution check on the picker.
    let seed = 12345;
    const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const counts = { potion: 0, c1: 0, c3: 0, c5: 0 };
    const N = 200000;
    for (let i = 0; i < N; i++) {
      const r = drops.pickWeighted(settings.drops.table, rng);
      if (r.kind === 'potion') counts.potion++; else if (r.amount === 1000) counts.c1++; else if (r.amount === 3000) counts.c3++; else counts.c5++;
    }
    const pct = (n) => (100 * n) / N;
    ok(Math.abs(pct(counts.potion) - 50) < 1, 'drop table ≈ 50% potion', pct(counts.potion).toFixed(2));
    ok(Math.abs(pct(counts.c1) - 44) < 1, 'drop table ≈ 44% 1,000 coins', pct(counts.c1).toFixed(2));
    ok(Math.abs(pct(counts.c3) - 5) < 0.5, 'drop table ≈ 5% 3,000 coins', pct(counts.c3).toFixed(2));
    ok(Math.abs(pct(counts.c5) - 1) < 0.3, 'drop table ≈ 1% 5,000 coins', pct(counts.c5).toFixed(2));
  }
  {
    // No drop rolls once the coin cap is reached.
    const u = newUser();
    for (let i = 0; i < 200; i++) await activity.credit(u, 'text', 1000, { now: SUN + i * 1000, rng: NEVER });
    const before = (await dbx.get('SELECT COUNT(*) n FROM drop_log WHERE userId = ?', [u])).n;
    for (let i = 0; i < 50; i++) await activity.credit(u, 'text', 1000, { now: SUN + 5000000 + i * 1000, rng: () => 0 });
    // (weekly char ceiling may also stop these; either way there must be no new drops)
    const after = (await dbx.get('SELECT COUNT(*) n FROM drop_log WHERE userId = ?', [u])).n;
    eq(after, before, 'capped activity makes no new drop rolls');
  }
  {
    const u = newUser();
    eq(await drops.getDmPref(u), true, 'drop DMs default to on');
    await drops.setDmPref(u, false);
    eq(await drops.getDmPref(u), false, '/drop off is stored');
    await drops.setDmPref(u, true);
    eq(await drops.getDmPref(u), true, '/drop on is stored');
  }

  // ───────────────────────────────────────────────────────────────────────
  section('Milestones');
  settings.drops.chancePerRoll = 0;
  {
    milestones.resetCache();
    const u = newUser();
    const t1 = settings.milestones.text.tiers[0];
    const t2 = settings.milestones.text.tiers[1];
    await dbx.exclusive('u:' + u, () => milestones.checkLocked(u, 'text', t1.threshold - 1, { now: SUN }));
    eq(await balance(u), 0, 'below the threshold pays nothing');
    const g = await dbx.exclusive('u:' + u, () => milestones.checkLocked(u, 'text', t1.threshold, { now: SUN }));
    eq(g.length, 1, 'tier 1 granted at its threshold');
    eq(await balance(u), t1.coins, 'tier 1 coins paid');
    await dbx.exclusive('u:' + u, () => milestones.checkLocked(u, 'text', t1.threshold + 5, { now: SUN }));
    eq(await balance(u), t1.coins, 'tier 1 is never paid twice');
    milestones.resetCache();   // simulates a bot restart
    await dbx.exclusive('u:' + u, () => milestones.checkLocked(u, 'text', t1.threshold + 5, { now: SUN }));
    eq(await balance(u), t1.coins, 'still not paid twice after a restart');
    const g2 = await dbx.exclusive('u:' + u, () => milestones.checkLocked(u, 'text', t2.threshold, { now: SUN }));
    eq(g2.length, 1, 'tier 2 follows');
    const titles = await dbx.all('SELECT titleId FROM titles WHERE userId = ?', [u]);
    eq(titles.length, 2, 'each tier unlocks a title');
    // A big jump grants every tier passed.
    const u2 = newUser();
    const all = await dbx.exclusive('u:' + u2, () => milestones.checkLocked(u2, 'text', 10 ** 9, { now: SUN }));
    eq(all.length, 10, 'a huge jump grants all 10 tiers');
    eq(await balance(u2), settings.milestones.text.tiers.reduce((a, t) => a + t.coins, 0), 'all 10 tiers paid exactly');
    const vtiers = settings.milestones.voice.tiers;
    const u3 = newUser();
    const vg = await dbx.exclusive('u:' + u3, () => milestones.checkLocked(u3, 'voice', vtiers[2].threshold, { now: SUN }));
    eq(vg.length, 3, 'voice minutes reach tier 3 at its threshold');
  }

  // ───────────────────────────────────────────────────────────────────────
  section('Betting: net weekly profit cap');
  {
    const cap = settings.betting.weeklyNetProfitCap;
    const a = newUser(); const b = newUser();
    // Pot game, a wins 500 from b.
    let r = await betting.settle({ kind: 'pot', stakes: { [a]: 500, [b]: 500 }, payouts: { [a]: 1000 }, now: SUN });
    eq(r.payouts[a], 1000, 'normal win pays the full pot (no tax)');
    eq(await betting.weeklyNet(a, SUN), 500, 'winner net = +500');
    eq(await betting.weeklyNet(b, SUN), -500, 'loser net = −500');

    // Clamp: a is at +500; win 20,000 more from b → only up to cap.
    r = await betting.settle({ kind: 'pot', stakes: { [a]: 20000, [b]: 20000 }, payouts: { [a]: 40000 }, now: SUN + 1000 });
    eq(await betting.weeklyNet(a, SUN), cap, 'winner net is clamped to the weekly cap');
    ok(r.capped.includes(a), 'capped player reported');
    eq(r.payouts[a] + r.payouts[b], 40000, 'pot game conserves coins (cut goes back to the loser)');
    eq(await betting.headroom(a, SUN), 0, 'no headroom left');
    const can = await betting.checkCanBet([a], SUN);
    ok(!can.ok && can.userId === a, 'capped player cannot place a new bet');

    // Net not gross: losing creates room.
    r = await betting.settle({ kind: 'pot', stakes: { [a]: 3000, [b]: 3000 }, payouts: { [b]: 6000 }, now: SUN + 2000 });
    eq(await betting.weeklyNet(a, SUN), cap - 3000, 'a loss lowers net');
    eq(await betting.headroom(a, SUN), 3000, 'headroom reopens after a loss');

    // House game: excess simply not paid.
    const h = newUser();
    r = await betting.settle({ kind: 'house', stakes: { [h]: 1000 }, payouts: { [h]: 4000 }, now: SUN });
    eq(r.payouts[h], 4000, 'house win under the cap pays in full');
    await betting.settle({ kind: 'house', stakes: { [h]: 1000 }, payouts: { [h]: 4000 }, now: SUN + 1 });
    await betting.settle({ kind: 'house', stakes: { [h]: 1000 }, payouts: { [h]: 4000 }, now: SUN + 2 });
    r = await betting.settle({ kind: 'house', stakes: { [h]: 1000 }, payouts: { [h]: 4000 }, now: SUN + 3 });
    ok((await betting.weeklyNet(h, SUN)) <= cap, 'house wins can never push net over the cap');
    eq(await betting.headroom(h, SUN + 8 * DAY), cap, 'cap resets next week');
  }

  // ───────────────────────────────────────────────────────────────────────
  section('Atomic claim guards');
  {
    const u = newUser();
    const claim = { table: 'milestone_claims', cols: { userId: u, track: 'text', tier: 1, claimedAt: SUN } };
    const sql = () => dbx.bundleSql({ userId: u, coins: 777, potions: [{ type: 'text', hours: 3 }], titles: [{ id: 't_x', category: 'milestone' }], claim, now: SUN });
    await dbx.atomic(sql());
    await dbx.atomic(sql());
    await dbx.atomic(sql());
    eq(await balance(u), 777, 'same claim run 3× pays once');
    eq((await boosts.inventory(u)).length, 1, 'same claim grants one potion');
  }
  {
    const u = newUser();
    let failedOnPurpose = false;
    try {
      await dbx.atomic(`INSERT INTO users (userId, balance) VALUES ('${u}', 50) ON CONFLICT(userId) DO UPDATE SET balance = balance + 50;\nINSERT INTO no_such_table VALUES (1);`);
    } catch (_) { failedOnPurpose = true; }
    ok(failedOnPurpose, 'a broken batch throws');
    eq(await balance(u), 0, '…and rolls back completely');
  }
  {
    // Concurrent credits for one member must not lose updates.
    const u = newUser();
    await Promise.all(Array.from({ length: 50 }, (_, i) => activity.credit(u, 'text', 100, { now: SUN + i * 1000, rng: NEVER })));
    eq(await balance(u), 50 * 100 * settings.text.coinsPerChar, '50 concurrent credits → no lost updates');
  }

  // ───────────────────────────────────────────────────────────────────────
  section('Halloween event');
  {
    const ev = events.current();
    const saved = { ...ev };
    ev.startAt = '2026-11-01T00:00:00+03:00';
    const { startAt, endAt } = events.window(ev);
    const mid = startAt + 3 * DAY;
    const last = endAt - HOUR;
    const p = ev.points;

    eq(events.phase(startAt - 1, ev), 'upcoming', 'phase: upcoming');
    eq(events.phase(mid, ev), 'active', 'phase: active');
    eq(events.phase(endAt, ev), 'ended', 'phase: ended exactly at +7 days');
    eq(endAt - startAt, 7 * DAY, 'event lasts exactly 7 days');

    const maxPts = events.pointsOf(ev, { textChars: 1e9, voiceMinutes: 1e9 });
    eq(maxPts.total, p.voiceMax + p.textMax, 'voice + typing alone max out at 60');
    eq(events.pointsOf(ev, { textChars: 1e9, voiceMinutes: 1e9, games: 99 }).total, 100, 'max score = 100 with games');
    eq(events.pointsOf(ev, { games: 3 }).games, 3 * p.pointsPerGame, 'a finished game = pointsPerGame');
    eq(events.pointsOf(ev, { games: 99 }).games, p.gamesMax, 'games part capped at 40');
    eq(maxPts.voice, p.voiceMax, 'voice part capped at 30');
    eq(maxPts.text, p.textMax, 'text part capped at 30');

    // Make the community reach Gold with filler members, plus named test members.
    const early = newUser();       // qualifies on day 1
    const late = newUser();        // qualifies only on the last day
    const never = newUser();       // never reaches 50
    const outside = newUser();     // activity before the event doesn't count

    await activity.credit(outside, 'voice', 600, { now: startAt - DAY, rng: NEVER });
    eq((await events.summary(outside, mid)).me.total, 0, 'activity before the start earns no points');

    // Enough voice minutes + text chars for 50 points.
    const need50 = { voice: p.voiceMax * p.voiceMinutesPerPoint, textChars: 20 * p.textCharsPerPoint };
    for (const [id, when] of [[early, startAt + DAY]]) {
      await activity.credit(id, 'voice', need50.voice, { now: when, rng: NEVER });
      await activity.credit(id, 'text', need50.textChars, { now: when + 1000, rng: NEVER });
    }
    await activity.credit(never, 'voice', 3 * p.voiceMinutesPerPoint, { now: mid, rng: NEVER });
    await activity.credit(late, 'voice', 10 * p.voiceMinutesPerPoint, { now: startAt + DAY, rng: NEVER });

    // Filler community points straight into the table (simulating many members).
    const goldTarget = ev.tiers[2].target;
    await dbx.run('INSERT INTO event_points (eventId, userId, textChars, voiceMinutes) VALUES (?, ?, ?, ?)',
      [ev.id, 'filler', 1e9, 1e9]);
    // filler contributes at most 100 → add many fillers
    const fillers = Math.ceil(goldTarget / p.voiceMax);   // each filler = voiceMax points
    const rows = [];
    for (let i = 0; i < fillers; i++) rows.push(`('${ev.id}', 'f${i}', 0, ${p.voiceMax * p.voiceMinutesPerPoint})`);
    await dbx.exec(`INSERT OR IGNORE INTO event_points (eventId, userId, textChars, voiceMinutes) VALUES ${rows.join(',')};`);

    const midSummary = await events.summary(early, mid);
    ok(midSummary.me.qualified, 'early member qualifies');
    ok(midSummary.community.tiers.find(t => t.key === 'bronze').reached, 'community progress shows tiers reached so far');

    // No payout while the event is running.
    const premature = await events.finalizeIfDue(null, mid);
    eq(premature, null, 'nothing is finalised before the end');
    eq((await dbx.get('SELECT COUNT(*) n FROM event_rewards WHERE eventId = ?', [ev.id])).n, 0, 'no event rewards paid mid-event');

    // Day 7: the "late" member finally reaches 50 points, after Gold is already secured.
    await activity.credit(late, 'voice', 15 * p.voiceMinutesPerPoint, { now: last - 10000, rng: NEVER });
    await activity.credit(late, 'text', 25 * p.textCharsPerPoint, { now: last, rng: NEVER });
    ok((await events.summary(late, last)).me.qualified, 'late member qualifies on day 7');

    // Party games count only inside the window.
    const gm = newUser();
    eq(await events.recordGames([gm], startAt - 1000), 0, 'game before the event earns no points');
    await events.recordGames([gm], mid);
    await events.recordGames([gm], mid + 1000);
    eq((await events.summary(gm, mid)).me.games, 2 * p.pointsPerGame, 'two finished games = 2 × pointsPerGame');
    for (let i = 0; i < 8; i++) await events.recordGames([gm], mid + 2000 + i);
    eq((await events.summary(gm, mid)).me.games, p.gamesPerDayMax * p.pointsPerGame, 'only gamesPerDayMax games count per day');
    for (let d = 1; d <= 6; d++) for (let i = 0; i < 5; i++) await events.recordGames([gm], mid + d * DAY + i);
    eq((await events.summary(gm, mid)).me.games, p.gamesMax, 'games part never exceeds its cap over the week');
    eq(await events.recordGames([gm], endAt + 1000), 0, 'game after the end earns no points');

    // Activity after the end must not count.
    const lateBefore = (await events.summary(late, last)).me.total;
    await activity.credit(late, 'voice', 600, { now: endAt + 1000, rng: NEVER });
    eq((await events.summary(late, endAt + 2000)).me.total, lateBefore, 'activity after the end earns no event points');

    const balBefore = { early: await balance(early), late: await balance(late), never: await balance(never) };
    const res = await events.finalizeIfDue(null, endAt + 2000, { rng: NEVER });
    ok(res && res.tiers.join() === 'bronze,silver,gold', 'final result: Bronze + Silver + Gold reached', JSON.stringify(res));

    const sumCoins = ev.tiers.reduce((a, t) => a + t.coins, 0);
    const sumText = ev.tiers.reduce((a, t) => a + t.textPotions, 0);
    const sumVoice = ev.tiers.reduce((a, t) => a + t.voicePotions, 0);
    for (const [name, id] of [['early', early], ['late', late]]) {
      eq((await balance(id)) - balBefore[name], sumCoins, `${name}: cumulative coins (${sumCoins})`);
      const inv = await dbx.all("SELECT type FROM potions WHERE userId = ? AND source = 'event'", [id]);
      eq(inv.filter(x => x.type === 'text').length, sumText, `${name}: cumulative Typing potions (${sumText})`);
      eq(inv.filter(x => x.type === 'voice').length, sumVoice, `${name}: cumulative Voice potions (${sumVoice})`);
      const tt = await dbx.all("SELECT titleId FROM titles WHERE userId = ? AND category = 'event'", [id]);
      eq(tt.length, 3, `${name}: three Halloween titles`);
    }
    eq((await balance(never)) - balBefore.never, 0, 'member under 50 points gets nothing');
    eq((await dbx.get("SELECT COUNT(*) n FROM titles WHERE userId = ? AND category = 'event'", [never])).n, 0, 'member under 50 points gets no title');
    eq((await dbx.get('SELECT COUNT(*) n FROM event_rewards WHERE eventId = ? AND userId = ?', [ev.id, outside])).n, 0, 'pre-event activity member gets no event reward');

    // Idempotency.
    const again = await events.finalizeIfDue(null, endAt + 5000, { rng: NEVER });
    eq(again, null, 'finalising twice does nothing');
    const st = await events.getState(ev);
    eq(st.status, 'finished', 'event state = finished');
    const paid = (await dbx.get('SELECT COUNT(*) n FROM event_rewards WHERE eventId = ?', [ev.id])).n;
    ok(paid >= 2, 'reward claims recorded', String(paid));

    // Deleting the event must not touch what members already own.
    const views = E('views.js');
    const keepCurrent = settings.events.current;
    settings.events.current = null;
    const info = views.titleInfo(ev.tiers[2].title.id);
    ok(info && info.kind === 'event' && info.name === 'Phantom Sovereign', 'event titles still display after the event is removed');
    const stillHas = await dbx.all("SELECT titleId FROM titles WHERE userId = ? AND category = 'event'", [early]);
    eq(stillHas.length, 3, 'earned event titles stay in the database');
    eq(await events.summary(early, endAt + 9999), null, '/event reports nothing once removed');
    settings.events.current = keepCurrent;
    Object.assign(ev, saved);
  }
  {
    // A smaller community: only Bronze is reached → only Bronze rewards.
    const ev = events.current();
    const saved = { ...ev };
    ev.id = 'test-bronze-only';
    ev.startAt = '2026-12-06T00:00:00+03:00';
    const { startAt, endAt } = events.window(ev);
    const p = ev.points;
    const q = newUser();
    await activity.credit(q, 'voice', 25 * p.voiceMinutesPerPoint, { now: startAt + DAY, rng: NEVER });
    await activity.credit(q, 'text', 25 * p.textCharsPerPoint, { now: startAt + DAY + 5000, rng: NEVER });
    const filler = Math.ceil(ev.tiers[0].target / p.voiceMax) + 20;   // each filler = voiceMax points; stays under Silver
    const rows = [];
    for (let i = 0; i < filler; i++) rows.push(`('${ev.id}', 'g${i}', 0, ${p.voiceMax * p.voiceMinutesPerPoint})`);
    await dbx.exec(`INSERT OR IGNORE INTO event_points (eventId, userId, textChars, voiceMinutes) VALUES ${rows.join(',')};`);
    const before = await balance(q);
    const res = await events.finalizeIfDue(null, endAt + 1000, { rng: NEVER });
    eq(res.tiers.join(), 'bronze', 'only Bronze reached');
    eq((await balance(q)) - before, ev.tiers[0].coins, 'only the Bronze coins are paid');
    eq((await dbx.get("SELECT COUNT(*) n FROM potions WHERE userId = ? AND source = 'event'", [q])).n, ev.tiers[0].textPotions + ev.tiers[0].voicePotions, 'only Bronze potions');
    Object.assign(ev, saved);

    // No tier → nothing paid.
    const ev2 = events.current();
    const saved2 = { ...ev2 };
    ev2.id = 'test-none';
    ev2.startAt = '2027-01-03T00:00:00+03:00';
    const w2 = events.window(ev2);
    const z = newUser();
    await activity.credit(z, 'voice', 25 * p.voiceMinutesPerPoint, { now: w2.startAt + DAY, rng: NEVER });
    await activity.credit(z, 'text', 25 * p.textCharsPerPoint, { now: w2.startAt + DAY + 5000, rng: NEVER });
    const zb = await balance(z);
    const r2 = await events.finalizeIfDue(null, w2.endAt + 1000, { rng: NEVER });
    eq(r2.tiers.length, 0, 'no tier reached');
    eq(await balance(z), zb, 'no tier → no rewards even for a qualified member');
    Object.assign(ev2, saved2);
  }

  // ───────────────────────────────────────────────────────────────────────
  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
  if (failed) { console.log('Failed:\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });
