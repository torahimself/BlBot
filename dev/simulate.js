'use strict';
// Economy simulator.   Run:  node dev/simulate.js [--weeks 104] [--seed 7] [--members 120] [--quick]
//
// Drives the REAL engine (utils/economy/engine/*) against an in-memory database
// with a fake clock and a seeded random generator, so weeks of activity run in
// seconds and the numbers are repeatable. It never touches data/economy.db.
//
// What it reports (see the section titles in the output):
//   1  assumptions (what "casual / regular / active / heavy" mean)
//   2  time to 100,000 coins for every archetype and path
//   3  typing milestones (incl. 2.5M characters) and voice milestones
//   4  random drops per week
//   5  cap audit: no week / 30-day window ever exceeds its cap, boosts included
//   6  steady-state income per 30 days (can the 100k role be re-bought forever?)
//   7  betting: net-profit cap with a hostile gambler
//   8  Halloween event: points per archetype, tier outcomes for a given server size
//
// Change numbers in utils/economy/engine/settings.js and run again.

process.env.BL_ECONOMY_DB = ':memory:';
const path = require('path');
const E = (f) => require(path.join(__dirname, '..', 'utils', 'economy', 'engine', f));

const settings = E('settings.js');
const dbx = E('dbx.js');
const time = E('time.js');
const activity = E('activity.js');
const boosts = E('boosts.js');
const betting = E('betting.js');
const events = E('events.js');

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? Number(argv[i + 1]) : def;
};
const QUICK = argv.includes('--quick');
const SEED = arg('seed', 7);
const HORIZON_WEEKS = arg('weeks', QUICK ? 30 : 104);
const MEMBERS = arg('members', 120);

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const START = Date.parse('2026-11-01T00:00:00+03:00');       // a Sunday, Riyadh midnight

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Archetypes ───────────────────────────────────────────────────────────────
// ELIGIBLE characters = letters/digits that survive the filter (≈ 75–80% of the
// raw characters typed). Change these if your server's real numbers differ:
// /econdebug week prints the real percentiles.
const ARCHETYPES = {
  casual:  { charsPerDay:  400, voiceHoursPerWeek:  1, voiceDays: 1, work: 0.5, eventGames: 1 },
  regular: { charsPerDay: 1500, voiceHoursPerWeek:  6, voiceDays: 3, work: 0.8, eventGames: 4 },
  active:  { charsPerDay: 4000, voiceHoursPerWeek: 14, voiceDays: 5, work: 0.9, eventGames: 8 },
  heavy:   { charsPerDay: 9000, voiceHoursPerWeek: 25, voiceDays: 6, work: 1.0, eventGames: 10 },
};

let userCounter = 0;
const nextId = (p) => `${p}${++userCounter}`;

/**
 * Simulates one member for `days` days. Returns the full history.
 *   path: { text, voice, work, boosts }  booleans
 */
async function simulate(name, prof, days, path, opts = {}) {
  const rng = mulberry32(SEED * 1000 + userCounter * 17 + 3);
  const userId = nextId(name + '_');
  const start = opts.start ?? START;
  const rec = {
    userId, name, days,
    first100k: null,            // day index when balance first ≥ 100,000
    firstActivity100k: null,    // same, counting only activity coins (no milestones/drops/work)
    textTier: Array(10).fill(null), voiceTier: Array(10).fill(null),
    dropsByWeek: [], drops: { potion: 0, c1000: 0, c3000: 0, c5000: 0 },
    potionsActivated: 0,
    balanceByDay: [],
  };
  let activityCoins = 0;
  let dropsThisWeek = 0;

  const note = (r, d) => {
    if (!r) return;
    activityCoins += r.coins || 0;
    for (const m of r.milestones || []) (m.track === 'text' ? rec.textTier : rec.voiceTier)[m.tier - 1] ??= d;
    if (r.drop) {
      dropsThisWeek++;
      if (r.drop.kind === 'potion') rec.drops.potion++;
      else rec.drops['c' + r.drop.amount] = (rec.drops['c' + r.drop.amount] || 0) + 1;
    }
  };

  for (let d = 0; d < days; d++) {
    const dayStart = start + d * DAY;
    if (d % 7 === 0 && d > 0) { rec.dropsByWeek.push(dropsThisWeek); dropsThisWeek = 0; }

    // /work once a day (the real cooldown is 24 h)
    if (path.work && rng() < prof.work) {
      const reward = 250 + Math.floor(rng() * 751);
      await dbx.run('INSERT INTO users (userId, balance) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET balance = balance + ?', [userId, reward, reward]);
    }

    // Typing: 8 bursts between 10:00 and 21:00 on days the member is around.
    if (path.text && prof.charsPerDay > 0) {
      const dayFactor = 0.5 + rng();                                  // 0.5–1.5, mean 1
      const dayChars = prof.charsPerDay * dayFactor;
      const bursts = 8;
      for (let b = 0; b < bursts; b++) {
        const now = dayStart + (10 + b * 1.5) * HOUR;
        if (path.boosts) await useBoosts(userId, 'text', now, rec);
        const units = Math.round(dayChars / bursts);
        note(await activity.credit(userId, 'text', units, { now, rng }), d);
      }
    }

    // Voice: on `voiceDays` days a week, hours split into 1-hour credits in the evening.
    if (path.voice && prof.voiceHoursPerWeek > 0 && rng() < prof.voiceDays / 7) {
      const hrs = prof.voiceHoursPerWeek / prof.voiceDays * (0.7 + rng() * 0.6);
      let minutes = Math.round(hrs * 60);
      let t = dayStart + 19 * HOUR;
      if (path.boosts) await useBoosts(userId, 'voice', t, rec);
      while (minutes > 0) {
        const m = Math.min(60, minutes);
        note(await activity.credit(userId, 'voice', m, { now: t, rng }), d);
        minutes -= m;
        t += m * 60000;
      }
    }

    const bal = (await dbx.get('SELECT balance FROM users WHERE userId = ?', [userId]) || { balance: 0 }).balance;
    rec.balanceByDay.push(bal);
    if (rec.first100k === null && bal >= 100000) {
      rec.first100k = d + 1;
      if (opts.stopAt100k) break;
    }
  }
  rec.dropsByWeek.push(dropsThisWeek);
  rec.activityCoins = activityCoins;
  rec.finalBalance = rec.balanceByDay[rec.balanceByDay.length - 1] || 0;
  rec.ranDays = rec.balanceByDay.length;
  return rec;
}

// The "smart" player: uses a potion whenever he has one and none is running.
async function useBoosts(userId, type, now, rec) {
  const running = await boosts.activeBoosts(userId, now);
  if (running.find(b => b.type === type)) return;
  const inv = await boosts.inventory(userId);
  const p = inv.find(x => x.type === type);
  if (!p) return;
  const r = await boosts.activate(userId, p.id, now);
  if (r.ok) rec.potionsActivated++;
}

// ── Formatting ───────────────────────────────────────────────────────────────
const wk = (days) => (days === null || days === undefined ? '—' : (days / 7).toFixed(1) + ' wk');
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const num = (n) => Math.round(n).toLocaleString('en-US');
function table(rows, widths) {
  return rows.map(r => r.map((c, i) => (i === 0 ? pad(c, widths[i]) : rpad(c, widths[i]))).join('  ')).join('\n');
}
const out = [];
const log = (s = '') => { console.log(s); out.push(s); };

// ── Audits over a finished run ───────────────────────────────────────────────
async function auditCaps(userId) {
  const rows = await dbx.all('SELECT day, source, coins, units FROM act_daily WHERE userId = ? ORDER BY day', [userId]);
  const res = { text: { weekMax: 0, rollMax: 0, weekUnits: 0 }, voice: { weekMax: 0, rollMax: 0, weekUnits: 0 } };
  // NOTE: the engine prunes nothing during a run, so all buckets are present.
  for (const src of ['text', 'voice']) {
    const mine = rows.filter(r => r.source === src);
    const byWeek = new Map();
    for (const r of mine) {
      const w = time.weekStartKey(time.startOfDayTs(r.day) + 12 * HOUR);
      const cur = byWeek.get(w) || { coins: 0, units: 0 };
      cur.coins += r.coins; cur.units += r.units;
      byWeek.set(w, cur);
    }
    for (const v of byWeek.values()) {
      res[src].weekMax = Math.max(res[src].weekMax, v.coins);
      res[src].weekUnits = Math.max(res[src].weekUnits, v.units);
    }
    for (let i = 0; i < mine.length; i++) {
      let sum = 0;
      for (let j = i; j < mine.length; j++) {
        if (mine[j].day >= time.addDays(mine[i].day, 30)) break;
        sum += mine[j].coins;
      }
      res[src].rollMax = Math.max(res[src].rollMax, sum);
    }
  }
  return res;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  await dbx.get('SELECT 1');
  settings.validate();
  settings.rng = mulberry32(SEED);
  settings.events.current = null;                  // economy runs are event-free
  const horizonDays = HORIZON_WEEKS * 7;
  const T = settings.text, V = settings.voice;

  log('══════════════════════════════════════════════════════════════════');
  log(' BL ECONOMY SIMULATION   seed ' + SEED + ' · horizon ' + HORIZON_WEEKS + ' weeks');
  log('══════════════════════════════════════════════════════════════════');

  // 1 ───────────────────────────────────────────────────────────────────────
  log('\n[1] SETTINGS UNDER TEST');
  log(`  typing   ${T.coinsPerChar}/char · cap ${num(T.weeklyCoinCap)}/week, ${num(T.rolling30CoinCap)}/30d · ceiling ${num(T.weeklyCharCeiling)} chars/week`);
  log(`  voice    ${V.coinsPerHourMin}–${V.coinsPerHourMax}/h · cap ${num(V.weeklyCoinCap)}/week, ${num(V.rolling30CoinCap)}/30d · ceiling ${V.weeklyMinuteCeiling / 60} h/week`);
  log(`  drops    ${settings.drops.chancePerRoll} per roll (1/voice-min, 1/${settings.drops.charsPerRoll} chars) · max ${settings.drops.maxPerWeek}/week`);
  log('  archetypes (eligible chars per day · voice hours per week · /work):');
  for (const [n, a] of Object.entries(ARCHETYPES)) {
    log(`    ${pad(n, 8)} ${rpad(num(a.charsPerDay), 6)} chars/day (${num(a.charsPerDay * 7)}/wk) · ${a.voiceHoursPerWeek} h voice/wk · work ${Math.round(a.work * 100)}% of days`);
  }

  // 2 ───────────────────────────────────────────────────────────────────────
  log('\n[2] TIME TO 100,000 COINS (balance, nothing spent; includes milestone + drop coins)');
  const paths = {
    'text only':        { text: true, voice: false, work: false, boosts: true },
    'voice only':       { text: false, voice: true, work: false, boosts: true },
    'text + voice':     { text: true, voice: true, work: false, boosts: true },
    'text+voice+/work': { text: true, voice: true, work: true, boosts: true },
  };
  const rows2 = [['', ...Object.keys(paths)]];
  const first100 = {};
  for (const [an, prof] of Object.entries(ARCHETYPES)) {
    const row = [an];
    for (const [pn, path] of Object.entries(paths)) {
      const r = await simulate(an, prof, Math.min(horizonDays, 40 * 7), path, { stopAt100k: true });
      first100[`${an}|${pn}`] = r.first100k;
      row.push(r.first100k === null ? '> 40 wk' : wk(r.first100k));
    }
    rows2.push(row);
  }
  log(table(rows2, [10, 12, 12, 14, 18]));

  // Ceiling: everything maxed out every single day (not a real person).
  const maxProf = { charsPerDay: T.weeklyCharCeiling / 7, voiceHoursPerWeek: V.weeklyMinuteCeiling / 60, voiceDays: 7, work: 1 };
  const maxRun = await simulate('max', maxProf, 12 * 7, { text: true, voice: true, work: true, boosts: true }, { stopAt100k: true });
  log(`  theoretical ceiling (every cap maxed daily, potions always on, /work daily): ${wk(maxRun.first100k)}`);

  // 3 ───────────────────────────────────────────────────────────────────────
  log('\n[3] MILESTONES  (time until each tier is unlocked; full text+voice+/work routine)');
  const fullRuns = {};
  for (const [an, prof] of Object.entries(ARCHETYPES)) {
    fullRuns[an] = await simulate(an, prof, horizonDays, { text: true, voice: true, work: true, boosts: true });
  }
  const textTiers = settings.milestones.text.tiers;
  const rows3 = [['⌨️  Typing tier', 'chars', 'coins', ...Object.keys(ARCHETYPES)]];
  textTiers.forEach((t, i) => rows3.push([`${i + 1}. ${t.name}`, num(t.threshold), num(t.coins), ...Object.keys(ARCHETYPES).map(a => wk(fullRuns[a].textTier[i]))]));
  log(table(rows3, [26, 10, 8, 10, 10, 10, 10]));
  const voiceTiers = settings.milestones.voice.tiers;
  const rows3v = [['🎧 Voice tier', 'hours', 'coins', ...Object.keys(ARCHETYPES)]];
  voiceTiers.forEach((t, i) => rows3v.push([`${i + 1}. ${t.name}`, num(t.threshold / 60), num(t.coins), ...Object.keys(ARCHETYPES).map(a => wk(fullRuns[a].voiceTier[i]))]));
  log('\n' + table(rows3v, [26, 10, 8, 10, 10, 10, 10]));
  log('  "—" = not reached within the horizon.');

  // Typing-only: how long does 2.5M characters take?
  const textOnly = {};
  for (const [an, prof] of Object.entries(ARCHETYPES)) {
    textOnly[an] = await simulate(an, prof, horizonDays, { text: true, voice: false, work: false, boosts: true });
  }
  log('  typing-only (no voice): 2.5M characters reached after → ' +
    Object.keys(ARCHETYPES).map(a => `${a} ${wk(textOnly[a].textTier[9])}`).join(' · '));

  // 4 ───────────────────────────────────────────────────────────────────────
  log('\n[4] RANDOM DROPS (full routine, whole horizon)');
  const rows4 = [['', 'drops/week', 'potion', '1,000c', '3,000c', '5,000c', 'potions used']];
  for (const an of Object.keys(ARCHETYPES)) {
    const r = fullRuns[an];
    const total = r.dropsByWeek.reduce((a, b) => a + b, 0);
    rows4.push([an, (total / r.dropsByWeek.length).toFixed(2), r.drops.potion, r.drops.c1000, r.drops.c3000, r.drops.c5000, r.potionsActivated]);
  }
  log(table(rows4, [10, 11, 8, 8, 8, 8, 13]));
  log('  targets: ≈ 0.8 / week for a regular member, ≈ 1.9 / week for a very active one (hard max ' + settings.drops.maxPerWeek + ').');

  // 5 ───────────────────────────────────────────────────────────────────────
  log('\n[5] CAP AUDIT (full routine, potions always used, whole horizon)');
  let violations = 0;
  const rows5 = [['', 'text wk max', 'text 30d max', 'voice wk max', 'voice 30d max', 'text chars/wk max', 'voice h/wk max']];
  for (const an of Object.keys(ARCHETYPES)) {
    const a = await auditCaps(fullRuns[an].userId);
    if (a.text.weekMax > T.weeklyCoinCap || a.text.rollMax > T.rolling30CoinCap) violations++;
    if (a.voice.weekMax > V.weeklyCoinCap || a.voice.rollMax > V.rolling30CoinCap) violations++;
    if (a.text.weekUnits > T.weeklyCharCeiling || a.voice.weekUnits > V.weeklyMinuteCeiling) violations++;
    rows5.push([an, num(a.text.weekMax), num(a.text.rollMax), num(a.voice.weekMax), num(a.voice.rollMax), num(a.text.weekUnits), (a.voice.weekUnits / 60).toFixed(1)]);
  }
  {
    const a = await auditCaps(maxRun.userId);
    if (a.text.weekMax > T.weeklyCoinCap || a.text.rollMax > T.rolling30CoinCap) violations++;
    if (a.voice.weekMax > V.weeklyCoinCap || a.voice.rollMax > V.rolling30CoinCap) violations++;
    rows5.push(['maxed', num(a.text.weekMax), num(a.text.rollMax), num(a.voice.weekMax), num(a.voice.rollMax), num(a.text.weekUnits), (a.voice.weekUnits / 60).toFixed(1)]);
  }
  log(table(rows5, [10, 12, 13, 13, 14, 18, 15]));
  log(`  limits: text ${num(T.weeklyCoinCap)}/wk ${num(T.rolling30CoinCap)}/30d · voice ${num(V.weeklyCoinCap)}/wk ${num(V.rolling30CoinCap)}/30d   →   ${violations === 0 ? '✅ no violations (boosts and drops never bypassed a cap)' : '❌ ' + violations + ' VIOLATIONS'}`);

  // A boosted vs unboosted comparison for the same behaviour.
  {
    const prof = ARCHETYPES.regular;
    const a = await simulate('boostA', prof, 12 * 7, { text: true, voice: true, work: false, boosts: false });
    const b = await simulate('boostB', prof, 12 * 7, { text: true, voice: true, work: false, boosts: true });
    log(`  regular member, 12 weeks: without potions ${num(a.activityCoins)} activity coins · with every potion used ${num(b.activityCoins)} (+${Math.round((b.activityCoins / a.activityCoins - 1) * 100)}%)`);
  }

  // 6 ───────────────────────────────────────────────────────────────────────
  log('\n[6] STEADY-STATE INCOME per 30 days (weeks 12–26 of the full routine, /work included)');
  log('    → can a member re-buy / extend the 100,000-coin 30-day role forever?');
  const rows6 = [['', 'coins / 30 days', 'vs 100k role', 'verdict']];
  for (const an of Object.keys(ARCHETYPES)) {
    const r = fullRuns[an];
    const lo = 12 * 7, hi = Math.min(r.balanceByDay.length, 26 * 7);
    if (hi <= lo) continue;
    const gain = (r.balanceByDay[hi - 1] - r.balanceByDay[lo - 1]) / (hi - lo) * 30;
    const verdict = gain >= 100000 ? 'can afford it every 30 days'
      : gain >= 70000 ? 'affords it about every ' + Math.ceil(100000 / gain * 30 / 7) + ' weeks'
      : 'cannot sustain it';
    rows6.push([an, num(gain), Math.round(gain / 1000) + '%', verdict]);
  }
  log(table(rows6, [10, 16, 14, 40]));
  log(`  hard ceiling on 30-day activity income: ${num(T.rolling30CoinCap + V.rolling30CoinCap)} coins (+ ~${num(30 * 625)} from /work)`);

  // 7 ───────────────────────────────────────────────────────────────────────
  log('\n[7] BETTING (hostile gambler: 400 coin-flip duels a week at 5,000 each, wins every one)');
  {
    const g = nextId('gambler_'), loser = nextId('victim_');
    const cap = settings.betting.weeklyNetProfitCap;
    let paid = 0, conserved = true;
    for (let i = 0; i < 400; i++) {
      const now = START + i * 60000;
      const r = await betting.settle({ kind: 'pot', stakes: { [g]: 5000, [loser]: 5000 }, payouts: { [g]: 10000 }, now });
      paid += r.nets[g];
      if (r.payouts[g] + r.payouts[loser] !== 10000) conserved = false;
    }
    const net = await betting.weeklyNet(g, START);
    log(`  net profit after 400 wins: ${num(net)} (cap ${num(cap)}) → ${net <= cap ? '✅ capped' : '❌ OVER CAP'} · coins conserved in every duel: ${conserved ? '✅' : '❌'}`);
    // Lose then win: net, not gross.
    const h = nextId('gambler_');
    await betting.settle({ kind: 'house', stakes: { [h]: 1000 }, payouts: {}, now: START });
    let wins = 0;
    for (let i = 0; i < 40; i++) {
      await betting.settle({ kind: 'house', stakes: { [h]: 1000 }, payouts: { [h]: 4000 }, now: START + i });
      wins++;
    }
    const net2 = await betting.weeklyNet(h, START);
    log(`  house game: 1 loss (−1,000) then ${wins} dice wins → net ${num(net2)} (cap ${num(cap)}) → ${net2 <= cap ? '✅' : '❌'}; next week headroom ${num(await betting.headroom(h, START + 8 * DAY))}`);
  }

  // 8 ───────────────────────────────────────────────────────────────────────
  log('\n[8] HALLOWEEN EVENT');
  const ev0 = settings.events.list['halloween-2026'];
  const p = ev0.points;
  log(`  🍬 Candy: voice max ${p.voiceMax} (${p.voiceMinutesPerPoint} min each = ${(p.voiceMax * p.voiceMinutesPerPoint / 60).toFixed(1)} h) · typing max ${p.textMax} (${p.textCharsPerPoint} chars each = ${num(p.textMax * p.textCharsPerPoint)} chars) · games max ${p.gamesMax} (${p.pointsPerGame} each, ${p.gamesPerDayMax}/day) · qualify at ${p.qualifyAt}`);
  settings.events.current = 'halloween-2026';
  const evStart = Date.parse(ev0.startAt);
  const eventPts = {};
  const rowsE = [['', 'voice', 'typing', 'games', 'total', 'qualifies']];
  for (const [an, prof] of Object.entries(ARCHETYPES)) {
    const N = 40, tot = { voice: 0, text: 0, games: 0, total: 0, q: 0 };
    for (let i = 0; i < N; i++) {
      const r = await simulate('ev' + an, prof, 7, { text: true, voice: true, work: false, boosts: true }, { start: evStart });
      // Party games finished during the event week (the engine's daily limit applies).
      const gr = mulberry32(SEED * 77 + i * 13 + userCounter);
      for (let g = 0; g < prof.eventGames; g++) await events.recordGames([r.userId], evStart + Math.floor(gr() * 7) * DAY + 14 * HOUR + g);
      const s = await events.summary(r.userId, evStart + 3 * DAY);
      tot.voice += s.me.voice; tot.text += s.me.text; tot.games += s.me.games; tot.total += s.me.total; tot.q += s.me.qualified ? 1 : 0;
    }
    eventPts[an] = { voice: tot.voice / N, text: tot.text / N, games: tot.games / N, total: tot.total / N, q: tot.q / N };
    rowsE.push([an, eventPts[an].voice.toFixed(0), eventPts[an].text.toFixed(0), eventPts[an].games.toFixed(0), eventPts[an].total.toFixed(0), Math.round(100 * eventPts[an].q) + '%']);
  }
  log(table(rowsE, [10, 8, 8, 8, 8, 11]));
  log('  (average over 40 simulated members each; the targeted outcome is ≈ 70 points for "regular")');

  // Community scenario. mix = share of participants per archetype.
  const mix = { casual: 0.25, regular: 0.40, active: 0.25, heavy: 0.10 };
  const avg = Object.entries(mix).reduce((a, [k, w]) => a + w * eventPts[k].total, 0);
  const expected = avg * MEMBERS;
  const qualShare = Object.entries(mix).reduce((a, [k, w]) => a + w * eventPts[k].q, 0);
  log(`\n  Community with ${MEMBERS} participating members (mix 25% casual / 40% regular / 25% active / 10% heavy):`);
  log(`    expected total ≈ ${num(expected)} Candy · ≈ ${Math.round(qualShare * MEMBERS)} members qualify`);
  const rowsT = [['tier', 'target', '% of expected', 'outcome']];
  for (const t of ev0.tiers) {
    const pct = t.target / expected * 100;
    rowsT.push([t.label, num(t.target), pct.toFixed(0) + '%', expected >= t.target ? 'reached' : 'not reached']);
  }
  log(table(rowsT, [8, 10, 15, 14]));
  const sugg = [0.55, 0.80, 1.05].map(f => Math.round(expected * f / 500) * 500);
  log(`    suggested targets for ${MEMBERS} participants (55% / 80% / 105% of the expected total): ${sugg.map(num).join(' / ')}`);
  log('    (rerun with --members N, N = how many people really type or talk in a normal week)');
  const goldQual = Math.round(qualShare * MEMBERS);
  const perMember = ev0.tiers.reduce((a, t) => a + t.coins, 0);
  log(`    payout if Gold is reached: ${num(perMember)} coins + ${ev0.tiers.reduce((a, t) => a + t.textPotions, 0)} Typing + ${ev0.tiers.reduce((a, t) => a + t.voicePotions, 0)} Voice potions per qualified member → ≈ ${num(perMember * goldQual)} coins injected for ${goldQual} members`);

  log('\nDone.');
  if (argv.includes('--out')) {
    require('fs').writeFileSync(argv[argv.indexOf('--out') + 1], out.join('\n') + '\n');
  }
  process.exit(violations ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
