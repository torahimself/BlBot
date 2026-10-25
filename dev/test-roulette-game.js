'use strict';
// Elimination roulette (.روليت) — wheel GIF + game flow with mocked Discord objects.
//   node dev/test-roulette-game.js
process.env.BL_ECONOMY_DB = ':memory:';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const db = require(path.join(root, 'utils/economy/database.js'));
const dbx = require(path.join(root, 'utils/economy/engine/dbx.js'));
const { getBalance } = require(path.join(root, 'utils/economy/shopManager.js'));
const cfg = require(path.join(root, 'utils/games/config.js'));
const games = require(path.join(root, 'utils/games/index.js'));
const session = require(path.join(root, 'utils/games/session.js'));
const stats = require(path.join(root, 'utils/games/stats.js'));
const wheel = require(path.join(root, 'utils/games/wheel.js'));
const roulette = require(path.join(root, 'utils/games/roulette.js'));

cfg.channels = [];
Object.assign(cfg.roulette, { pauseMs: 5, revealPadMs: 5, pickMs: 400 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

// ── tiny GIF decoder (verifies our encoder independently) ──────────────────
function decodeGif(buf) {
  assert.strictEqual(buf.slice(0, 6).toString(), 'GIF89a', 'header');
  const W = buf.readUInt16LE(6), H = buf.readUInt16LE(8);
  const flags = buf[10];
  let p = 13;
  const ctSize = 3 * (1 << ((flags & 7) + 1));
  const palette = [];
  if (flags & 0x80) { for (let i = 0; i < ctSize; i += 3) palette.push([buf[p + i], buf[p + i + 1], buf[p + i + 2]]); p += ctSize; }
  const frames = [], delays = [];
  let delay = 0;
  while (p < buf.length) {
    const b = buf[p++];
    if (b === 0x3B) break;
    if (b === 0x21) {
      const label = buf[p++];
      if (label === 0xF9) delay = buf.readUInt16LE(p + 2);
      while (buf[p] !== 0) p += buf[p] + 1;
      p++;
    } else if (b === 0x2C) {
      p += 8; const lf = buf[p++]; assert.strictEqual(lf & 0x80, 0, 'no local table expected');
      const min = buf[p++];
      const data = [];
      while (buf[p] !== 0) { for (let i = 0; i < buf[p]; i++) data.push(buf[p + 1 + i]); p += buf[p] + 1; }
      p++;
      frames.push(lzwDecode(data, min, W * H)); delays.push(delay);
    } else throw new Error('bad block ' + b);
  }
  return { W, H, palette, frames, delays };
}
function lzwDecode(data, min, total) {
  const clear = 1 << min, eoi = clear + 1;
  let size = min + 1, next = eoi + 1;
  let table = [];
  const reset = () => { table = []; for (let i = 0; i < clear; i++) table[i] = [i]; table[clear] = []; table[eoi] = []; size = min + 1; next = eoi + 1; };
  reset();
  const out = []; let cur = 0, nb = 0, di = 0, prev = null;
  while (out.length < total) {
    while (nb < size && di < data.length) { cur |= data[di++] << nb; nb += 8; }
    if (nb < size) break;
    const code = cur & ((1 << size) - 1); cur >>>= size; nb -= size;
    if (code === clear) { reset(); prev = null; continue; }
    if (code === eoi) break;
    let entry;
    if (code < next) entry = table[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error('bad LZW');
    out.push(...entry);
    if (prev && next < 4096) { table[next++] = [...prev, entry[0]]; if (next === (1 << size) && size < 12) size++; }
    prev = entry;
  }
  assert.strictEqual(out.length, total, 'frame pixel count');
  return Uint8Array.from(out);
}

// ── mocks (same style as test-party-games) ─────────────────────────────────
let mid = 0;
function mkChannel(id = 'rch' + (++mid)) {
  const sent = [];
  const mk = (c) => { const m = { id: 'm' + (++mid), ...(typeof c === 'string' ? { content: c } : c), edit: async (x) => { Object.assign(m, x); return m; } }; sent.push(m); return m; };
  return { id, sent, send: async (c) => mk(c), isTextBased: () => true };
}
function mkClick(userId, customId, extra = {}) {
  const it = { customId, user: { id: userId, username: userId }, member: { displayName: userId }, replies: [], replied: false, deferred: false,
    reply: async (o) => { it.replies.push(o); it.replied = true; }, deferUpdate: async () => { it.deferred = true; },
    update: async (o) => { it.updated = o; }, ...extra };
  return it;
}
const click = (userId, s, action, extra) => { const it = mkClick(userId, `pg:${s.id}:${action}`, extra); return games.handleInteraction(it).then(() => it); };
const bal = (id) => getBalance(id);
async function setBal(id, v) { await dbx.run('INSERT INTO users (userId, balance) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET balance = ?', [id, v, v]); await dbx.run('DELETE FROM bet_net WHERE userId = ?', [id]); }
async function waitFor(fn, ms = 3000) { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(5); } throw new Error('timeout waiting'); }
const waitTurn = (s) => waitFor(() => s.data.turn && s.data.turn.chosen && s.data.turn);
async function newGame(host, others, bet, rngValues) {
  const ch = mkChannel();
  const adapter = { channel: ch, user: { id: host }, member: { displayName: host }, editReply: (p) => ch.send(p) };
  const r = await session.create({ type: roulette.type, def: roulette, interaction: adapter, bet });
  assert(r.ok, 'lobby: ' + r.error);
  const s = r.session;
  const q = [...rngValues];
  s.options.rng = () => (q.length ? q.shift() : 0);
  for (const id of others) { const j = await s.addPlayer(id, id); assert(j.ok, 'join ' + id + ': ' + j.error); }
  return { s, ch };
}

(async () => {
  await db.ready;
  await stats.ensure();

  // ── wheel GIF: pure-JS fallback engine ───────────────────────────────────
  console.log('Wheel GIF — pure fallback engine');
  const slotsOf = (n, nums) => Array.from({ length: n }, (_, i) => ({ num: nums ? nums[i] : i + 1, colorIdx: i % 12, name: 'P' + (i + 1) }));
  await t('valid GIF89a, 22 frames, 224px, decodes cleanly, ≤24 frames', () => {
    const g = wheel.renderPure({ slots: slotsOf(8), selected: 3 });
    const d = decodeGif(g.buffer);
    assert.strictEqual(d.frames.length, 22); assert(d.frames.length <= 24);
    assert.strictEqual(d.W, 224); assert.strictEqual(d.H, 224);
    assert.strictEqual(d.palette.length, 16);
    assert(d.delays[d.delays.length - 1] >= 200, 'last frame stays on screen');
    assert(g.spinMs > 1500 && g.spinMs < 6000, 'spin time ' + g.spinMs);
    assert(g.buffer.length < 400 * 1024, 'size ' + g.buffer.length);
  });
  await t('pure: the LAST frame shows the selected segment colour under the pointer (all sizes 2–12, all selections)', () => {
    let checked = 0;
    for (let n = 2; n <= 12; n++) {
      for (let sel = 0; sel < n; sel++) {
        const slots = slotsOf(n);
        const d = decodeGif(wheel.renderPure({ slots, selected: sel }).buffer);
        const last = d.frames[d.frames.length - 1];
        const x = wheel.CX | 0, y = Math.round(wheel.CY - 0.86 * wheel.R_SEG);
        assert.strictEqual(last[y * d.W + x], 4 + slots[sel].colorIdx, `n=${n} selected=${sel}`);
        checked++;
      }
    }
    assert.strictEqual(checked, 77);
  });
  await t('pure: the wheel really turns', () => {
    const d = decodeGif(wheel.renderPure({ slots: slotsOf(6), selected: 2 }).buffer);
    const diff = (a, b) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
    assert(diff(d.frames[0], d.frames[10]) > 2000);
    assert(diff(d.frames[10], d.frames[21]) > 500);
  });
  await t('pure: rejects bad input (also through the async API)', async () => {
    assert.throws(() => wheel.renderPure({ slots: slotsOf(1), selected: 0 }));
    await assert.rejects(() => wheel.render({ slots: slotsOf(1), selected: 0 }));
    await assert.rejects(() => wheel.render({ slots: slotsOf(13), selected: 0 }));
    await assert.rejects(() => wheel.render({ slots: slotsOf(4), selected: 4 }));
  });

  // ── wheel GIF: canvas engine (names + avatars) ───────────────────────────
  console.log('Wheel GIF — canvas engine');
  let canvasOk = true;
  try { require('@napi-rs/canvas'); } catch (_) { canvasOk = false; console.log('     (@napi-rs/canvas not installed here — canvas tests skipped)'); }
  const NAMES = ['KAI', 'benji', 'Willow', 'theo07', 'مها', 'Ryder', 'أبو فهد', 'viper_the_great', 'peanut', 'Vera', 'x', 'علي'];
  const cslots = (n) => Array.from({ length: n }, (_, i) => ({ num: i + 1, colorIdx: i, name: NAMES[i], avatarUrl: null }));
  const near = (a, b, tol = 14) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
  if (canvasOk) {
    wheel._setCanvasForTest(undefined);
    await t('canvas: valid GIF89a, 26 frames max, 340px, 256-colour palette, long last frame', async () => {
      const g = await wheel.render({ slots: cslots(8), selected: 5 });
      assert.strictEqual(g.engine, 'canvas');
      const d = decodeGif(g.buffer);
      assert(d.frames.length <= 26 && d.frames.length >= 20, 'frames ' + d.frames.length);
      assert.strictEqual(d.W, 340); assert.strictEqual(d.H, 340);
      assert.strictEqual(d.palette.length, 256);
      assert(d.delays[d.delays.length - 1] >= 200, 'last frame stays on screen');
      assert(g.spinMs > 1500 && g.spinMs < 6000, 'spin ' + g.spinMs);
      assert(g.buffer.length < 2 * 1024 * 1024, 'size ' + g.buffer.length);
    });
    await t('canvas: the LAST frame has the selected player\'s colour at the pointer (n = 2,3,5,8,12, every selection)', async () => {
      const C = wheel.CANVAS;
      let checked = 0;
      for (const n of [2, 3, 5, 8, 12]) {
        for (let sel = 0; sel < n; sel++) {
          const slots = cslots(n);
          const g = await wheel.render({ slots, selected: sel });
          const d = decodeGif(g.buffer);
          const last = d.frames[d.frames.length - 1];
          const seg = 2 * Math.PI / n;
          const centre = g.finalRot + (sel + 0.5) * seg;                 // angle of the selected segment's centre
          assert(Math.abs(Math.sin(centre / 1)) <= Math.sin(0.2 * seg + 1e-6) + 1e-9, `n=${n} sel=${sel}: segment centre is not at the pointer`);
          for (const side of [-1, 1]) {
            const ang = centre + side * 0.35 * seg;
            const x = Math.round(C.C + (C.R - 5) * Math.cos(ang)), y = Math.round(C.C + (C.R - 5) * Math.sin(ang));
            const rgb = d.palette[last[y * d.W + x]];
            assert(near(rgb, wheel.COLORS[slots[sel].colorIdx]), `n=${n} sel=${sel} side=${side}: got ${rgb}`);
          }
          checked++;
        }
      }
      assert.strictEqual(checked, 2 + 3 + 5 + 8 + 12);
    });
    await t('canvas: names (incl. Arabic) are drawn — white text pixels exist along the segments', async () => {
      const g = await wheel.render({ slots: cslots(6), selected: 1 });
      const d = decodeGif(g.buffer);
      const last = d.frames[d.frames.length - 1];
      let white = 0; for (const v of last) { const c = d.palette[v]; if (c[0] > 245 && c[1] > 245 && c[2] > 245) white++; }
      assert(white > 1500, 'white pixels ' + white);
    });
    await t('canvas: avatar fetch failure → initial-letter circle, still a valid GIF', async () => {
      const slots = cslots(4).map((x, i) => ({ ...x, avatarUrl: 'https://cdn.invalid/a' + i + '.png' }));
      const g = await wheel.render({ slots, selected: 0 }, { fetch: async () => { throw new Error('network down'); } });
      assert.strictEqual(g.engine, 'canvas'); decodeGif(g.buffer);
    });
    await t('canvas: avatar fetch timeout (4 s) does not hang the game', async () => {
      const slots = cslots(3).map((x, i) => ({ ...x, avatarUrl: 'https://cdn.invalid/slow' + i + '.png' }));
      const t0 = Date.now();
      const g = await wheel.render({ slots, selected: 1 }, { fetch: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))) });
      assert(Date.now() - t0 < 6500, 'took ' + (Date.now() - t0));
      decodeGif(g.buffer);
    });
    await t('canvas: a real avatar is drawn in the hub (solid green avatar → green pixel in the middle)', async () => {
      const { createCanvas } = require('@napi-rs/canvas');
      const av = createCanvas(128, 128); const x = av.getContext('2d'); x.fillStyle = 'rgb(20,230,20)'; x.fillRect(0, 0, 128, 128);
      const png = av.toBuffer('image/png');
      const slots = cslots(5).map((s2, i) => ({ ...s2, avatarUrl: 'https://cdn.invalid/ok' + i + '.png' }));
      const g = await wheel.render({ slots, selected: 2 }, { fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.length) }) });
      const d = decodeGif(g.buffer);
      const last = d.frames[d.frames.length - 1];
      const rgb = d.palette[last[wheel.CANVAS.C * d.W + wheel.CANVAS.C + 10]];
      assert(near(rgb, [20, 230, 20], 40), 'hub pixel ' + rgb);
    });
    await t('canvas: PIL (python3) opens the GIF', () => {
      const f = path.join(os.tmpdir(), 'bl-wheel-canvas.gif');
      return wheel.render({ slots: cslots(7), selected: 4 }).then((g) => {
        fs.writeFileSync(f, g.buffer);
        let out;
        try { out = execFileSync('python3', ['-c', `from PIL import Image\nim=Image.open(${JSON.stringify(f)})\nprint(im.n_frames, im.size[0], im.size[1])`], { encoding: 'utf8' }).trim(); }
        catch (e) { console.log('     (PIL not available — skipped)'); return; }
        const [nf, w, h] = out.split(' ').map(Number);
        assert(nf >= 20 && nf <= 26 && w === 340 && h === 340, out);
      });
    });
  }
  await t('fallback: module missing → pure wheel, no throw, ONE warning', async () => {
    const Module = require('module');
    const origLoad = Module._load;
    const origWarn = console.warn;
    let warnings = 0;
    console.warn = (...a) => { if (/napi-rs\/canvas/.test(a.join(' '))) warnings++; };
    Module._load = function (req, ...rest) { if (req === '@napi-rs/canvas') throw new Error("Cannot find module '@napi-rs/canvas'"); return origLoad.call(this, req, ...rest); };
    try {
      wheel._setCanvasForTest(undefined);
      const a = await wheel.render({ slots: cslots(5), selected: 2 });
      const b = await wheel.render({ slots: cslots(6), selected: 1 });
      assert.strictEqual(a.engine, 'pure'); assert.strictEqual(b.engine, 'pure');
      decodeGif(a.buffer);
      assert.strictEqual(warnings, 1, 'warnings: ' + warnings);
    } finally { Module._load = origLoad; console.warn = origWarn; wheel._setCanvasForTest(undefined); }
  });
  await t('fallback: canvas throwing while drawing → pure wheel', async () => {
    wheel._setCanvasForTest({ GlobalFonts: { registerFromPath() {} }, createCanvas() { throw new Error('boom'); }, loadImage() {} });
    const origErr = console.error; console.error = () => {};
    try { const g = await wheel.render({ slots: cslots(4), selected: 1 }); assert.strictEqual(g.engine, 'pure'); }
    finally { console.error = origErr; wheel._setCanvasForTest(undefined); }
  });

  // Game-flow tests use the (fast) pure engine and a zero-length spin.
  wheel._setCanvasForTest(false);

  // From here on the animation is stubbed out (the GIF is covered above).
  const realRender = wheel.render;
  wheel.render = async (a, o) => ({ ...(await realRender(a, o)), spinMs: 0 });

  // ── trigger ──────────────────────────────────────────────────────────────
  console.log('Trigger');
  await t('.روليت / .روليت 500 / .عجلة', () => {
    assert.deepStrictEqual(games.parseTrigger('.روليت'), { type: 'roulette', bet: 0 });
    assert.deepStrictEqual(games.parseTrigger('.روليت 500'), { type: 'roulette', bet: 500 });
    assert.strictEqual(games.parseTrigger('.عجلة').type, 'roulette');
    assert(games.parseTrigger('.روليت 5').error, 'bet below the minimum is refused');
  });

  // ── game flow ────────────────────────────────────────────────────────────
  console.log('Game flow (free)');
  const P = ['ra', 'rb', 'rc', 'rd'];
  for (const id of P) await setBal(id, 1000);

  await t('free 3-player game: pick kick, then leave', async () => {
    const { s, ch } = await newGame('ra', ['rb', 'rc'], 0, [0, 0]);
    const run = s.start();
    let turn = await waitTurn(s);
    assert.strictEqual(turn.chosen, 'ra');
    // Not the chosen player: refused, nothing changes.
    const intruder = await click('rb', s, 'rleave');
    assert(intruder.replies[0] && intruder.replies[0].flags === 64 && /ليس لك/.test(intruder.replies[0].content), 'ephemeral refusal');
    assert(!s.data.turn.resolved && s.data.alive.size === 3, 'intruder changed nothing');
    const intruderSel = await click('rc', s, 'rsel', { values: ['ra'] });
    assert(intruderSel.replies[0] && intruderSel.replies[0].flags === 64);
    assert(s.data.alive.size === 3);
    // Chosen player opens the private menu, kicks rb.
    const menu = await click('ra', s, 'rkick');
    assert.strictEqual(menu.replies[0].flags, 64, 'menu is ephemeral');
    const opts = menu.replies[0].components[0].components[0].options;
    assert.deepStrictEqual(opts.map(o => (o.data || o).value).sort(), ['rb', 'rc'], 'menu lists only the OTHER alive players');
    const sel = await click('ra', s, 'rsel', { values: ['rb'] });
    assert(sel.updated && /rb/.test(sel.updated.content));
    await waitFor(() => s.data.alive.size === 2 && s.data.turn && s.data.turn !== turn && s.data.turn.chosen);
    assert(!s.data.alive.has('rb'));
    // Round 2: chosen = first alive = ra → leaves → rc wins.
    turn = s.data.turn;
    assert.strictEqual(turn.chosen, 'ra');
    await click('ra', s, 'rleave');
    await run;
    assert.strictEqual(s.status, 'done');
    const text = ch.sent.map(m => m.content || '').join('\n');
    assert(/انسحب/.test(text) && /الفائز/.test(text) && /<@rc>/.test(text), 'announcements');
    for (const id of ['ra', 'rb', 'rc']) assert.strictEqual(await bal(id), 1000, id + ' balance untouched');
    const st = await stats.forUser('rc');
    assert(st.find(r => r.game === 'roulette' && r.plays === 1 && r.wins === 1), 'win recorded');
    const st2 = await stats.forUser('rb');
    assert(st2.find(r => r.game === 'roulette' && r.plays === 1 && r.wins === 0), 'play recorded for an eliminated player');
  });

  await t('random kick uses the rng and never kicks the chooser', async () => {
    // Round 1 chosen: rng 0 → ra. Random kick: rng 0.99 → last of the others = rc.
    // Round 2 (ra, rb): chosen rng 0.99 → rb; random kick → ra (only other).
    const { s } = await newGame('ra', ['rb', 'rc'], 0, [0, 0.99, 0.99, 0]);
    const run = s.start();
    await waitTurn(s);
    await click('ra', s, 'rrand');
    await waitFor(() => s.data.alive.size === 2 && s.data.turn);
    assert(s.data.alive.has('ra') && s.data.alive.has('rb') && !s.data.alive.has('rc'), 'rc was kicked');
    assert.strictEqual(s.data.turn.chosen, 'rb');
    await click('rb', s, 'rrand');
    await run;
    assert.deepStrictEqual([...s.data.alive], ['rb'], 'rb is the last one left');
  });

  await t('15 s timeout (shortened) → the CHOSEN player is kicked, nobody else', async () => {
    assert.strictEqual(cfg.roulette.pickMs, 400, 'test overrides pickMs (production value is checked below)');
    const { s, ch } = await newGame('ra', ['rb', 'rc'], 0, [0, 0, 0, 0]);
    const run = s.start();
    const turn = await waitTurn(s);
    const chooser = turn.chosen;
    await waitFor(() => s.data.alive.size === 2, 2000);       // nobody clicks
    assert(!s.data.alive.has(chooser), 'the chooser was kicked on timeout');
    assert(ch.sent.some(m => /لم يرد/.test(m.content || '')), 'timeout announced');
    await waitTurn(s); await waitFor(() => s.data.alive.size === 1, 2000);
    await run;
    assert.strictEqual(s.status, 'done');
  });
  await t('production pick time is 15 s', () => {
    delete require.cache[require.resolve(path.join(root, 'utils/games/config.js'))];
    const fresh = require(path.join(root, 'utils/games/config.js'));
    assert.strictEqual(fresh.roulette.pickMs, 15000);
    // restore the shared object used by the rest of this file
    require.cache[require.resolve(path.join(root, 'utils/games/config.js'))].exports = cfg;
  });

  await t('stale / late clicks after the decision are refused', async () => {
    const { s } = await newGame('ra', ['rb', 'rc'], 0, [0, 0, 0]);
    const run = s.start();
    const turn = await waitTurn(s);
    await click('ra', s, 'rrand');
    const late = await click('ra', s, 'rleave');
    assert(late.replies[0] && late.replies[0].flags === 64, 'second click refused');
    await waitFor(() => s.data.turn && s.data.turn !== turn);
    await click('ra', s, 'rleave');
    await run;
  });

  await t('the wheel message carries the GIF, a numbered/coloured player list and the buttons', async () => {
    const { s, ch } = await newGame('ra', ['rb', 'rc'], 0, [0, 0, 0]);
    const run = s.start();
    await waitTurn(s);
    const m = ch.sent.find(x => x.files && x.files[0] && x.files[0].name === 'wheel.gif');
    assert(m, 'wheel message with attachment');
    const desc = m.embeds[0].data ? m.embeds[0].data.description : m.embeds[0].description;
    assert(/\*\*1\*\* – 🔴 أحمر – <@ra>/.test(desc) && /\*\*2\*\* – 🔵 أزرق – <@rb>/.test(desc) && /\*\*3\*\* – 🟢 أخضر – <@rc>/.test(desc), desc);
    const row = m.components[0].components.map(c => c.data.label);
    assert.deepStrictEqual(row, ['طرد لاعب', 'طرد عشوائي', 'انسحاب']);
    await click('ra', s, 'rleave'); await waitTurn(s); await click('rb', s, 'rleave').catch(() => {});
    await s.abort('test over'); await run;
  });

  await t('the wheel gets every player\'s name and avatar URL (and survives players without one)', async () => {
    const { s, ch } = await newGame('ra', ['rb', 'rc'], 0, [0, 0, 0]);
    ch.client = { users: { cache: { get: (id) => (id === 'ra' ? { displayAvatarURL: (o) => `https://cdn.test/${id}.${o.extension}?size=${o.size}` } : undefined) }, fetch: async () => { throw new Error('unknown user'); } } };
    let seen;
    const keep = wheel.render;
    wheel.render = async (a, o) => { seen = a; return keep(a, o); };
    const run = s.start();
    await waitTurn(s);
    wheel.render = keep;
    assert.strictEqual(seen.slots.length, 3);
    assert.strictEqual(seen.slots[0].name, 'ra'); assert.strictEqual(seen.slots[0].avatarUrl, 'https://cdn.test/ra.png?size=128');
    assert.strictEqual(seen.slots[1].avatarUrl, null);
    await s.abort('test over'); await run;
  });

  console.log('Game flow (with a bet)');
  await t('bet 100 × 3: winner gets the whole pot, coins are conserved', async () => {
    for (const id of ['ra', 'rb', 'rc']) await setBal(id, 1000);
    const { s } = await newGame('ra', ['rb', 'rc'], 100, [0, 0]);
    assert.strictEqual(await bal('ra'), 900); assert.strictEqual(await bal('rb'), 900); assert.strictEqual(await bal('rc'), 900);
    const run = s.start();
    await waitTurn(s); await click('ra', s, 'rleave');            // ra out
    await waitFor(() => s.data.alive.size === 2 && s.data.turn);
    // alive = rb, rc → chosen rng 0 → rb; rb leaves → rc wins
    assert.strictEqual(s.data.turn.chosen, 'rb');
    await click('rb', s, 'rleave');
    await run;
    assert.strictEqual(await bal('rc'), 900 + 300, 'winner takes the pot');
    assert.strictEqual(await bal('ra'), 900); assert.strictEqual(await bal('rb'), 900);
    assert.strictEqual((await bal('ra')) + (await bal('rb')) + (await bal('rc')), 3000 - 0, 'total coins unchanged');
    const left = await dbx.all('SELECT * FROM party_stakes WHERE sessionId = ?', [s.id]);
    assert.strictEqual(left.length, 0, 'stake ledger cleared');
  });

  await t('abort in the middle of a bet game refunds everybody exactly once', async () => {
    for (const id of ['ra', 'rb', 'rc']) await setBal(id, 1000);
    const { s } = await newGame('ra', ['rb', 'rc'], 250, [0]);
    const run = s.start();
    await waitTurn(s);
    await s.abort('stop');
    await run;
    for (const id of ['ra', 'rb', 'rc']) assert.strictEqual(await bal(id), 1000, id);
    await s.abort('again');                                       // idempotent
    for (const id of ['ra', 'rb', 'rc']) assert.strictEqual(await bal(id), 1000, id + ' not refunded twice');
  });

  await t('lobby: fewer than 3 players cannot start; max is 12', async () => {
    const ch = mkChannel();
    const adapter = { channel: ch, user: { id: 'ra' }, member: { displayName: 'ra' }, editReply: (p) => ch.send(p) };
    const r = await session.create({ type: roulette.type, def: roulette, interaction: adapter, bet: 0 });
    const s = r.session;
    await s.addPlayer('rb', 'rb');
    const startClick = await click('ra', s, 'start');
    assert(/3/.test(startClick.replies[0].content), 'needs 3 players');
    assert.strictEqual(roulette.min, 3); assert.strictEqual(roulette.max, 12);
    await s.abort('done');
  });

  wheel.render = realRender;
  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
