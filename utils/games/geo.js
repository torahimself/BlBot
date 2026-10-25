'use strict';
// 📍 جيو — street-level GeoGuessr-style game.
// A real street photo (Mapillary, CC-BY-SA) is shown; players type the country.
//   • setup: see GEO_SETUP.md (a free Mapillary client token)
//   • first correct answer 3 points, second 2, third 1 (once per player per round)
//   • hints: continent at 1/3 of the time, first letter + length at 2/3

const { EmbedBuilder } = require('discord.js');
const cfg = require('./config.js');
const { COUNTRIES, matches, pick } = require('./countries.js');
const { GEO } = require('./geoPoints.js');

const g = cfg.geo;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const API = 'https://graph.mapillary.com/images';

// HTTP is injectable so tests run offline: setFetch(fn) or cfg.geo.fetch.
let fetchOverride = null;
function setFetch(fn) { fetchOverride = fn; }
const doFetch = () => fetchOverride || g.fetch || globalThis.fetch;

const token = () => process.env.MAPILLARY_TOKEN || g.mapillaryToken || '';
const isConfigured = () => !!token();
const NOT_CONFIGURED = '⚙️ لعبة **جيو** غير مفعّلة بعد — المطوّر يحتاج إضافة مفتاح Mapillary (انظر GEO_SETUP.md).';

/** bbox = [minLon, minLat, maxLon, maxLat] around a point, with a random jitter so rounds differ. */
function bboxAround([lat, lon], rng = Math.random) {
  const jl = (rng() * 2 - 1) * g.jitterDeg, jo = (rng() * 2 - 1) * g.jitterDeg;
  const cy = lat + jl, cx = lon + jo, h = g.bboxHalfDeg;
  const r = (n) => Number(n.toFixed(5));
  return [r(cx - h), r(cy - h), r(cx + h), r(cy + h)];
}

function buildUrl(tok, bbox) {
  const q = new URLSearchParams({
    access_token: tok,
    bbox: bbox.join(','),
    fields: 'id,thumb_1024_url,computed_geometry,captured_at',
    is_pano: 'false',
    limit: String(g.limit),
  });
  return `${API}?${q.toString()}`;
}

async function queryImages(bbox) {
  const f = doFetch();
  const res = await f(buildUrl(token(), bbox), { signal: AbortSignal.timeout ? AbortSignal.timeout(g.httpTimeoutMs) : undefined });
  if (!res || !res.ok) throw new Error(`Mapillary HTTP ${res && res.status}`);
  const body = await res.json();
  if (body && body.error) throw new Error(`Mapillary: ${body.error.message || 'error'}`);
  return (body && body.data ? body.data : []).filter(im => im && im.id && im.thumb_1024_url);
}

function weightedPick(list, rng) {
  const total = list.reduce((a, c) => a + c.w, 0);
  let x = rng() * total;
  for (const c of list) { if (x < c.w) return c; x -= c.w; }
  return list[list.length - 1];
}

/**
 * Finds a photo. Up to g.attempts tries: each picks a (weighted) country not used
 * yet, one of its points, and asks Mapillary. Returns
 * { country, image:{id,url,lat,lon} } or null.
 */
async function findPhoto({ used = new Set(), rng = Math.random } = {}) {
  const pool = COUNTRIES.filter(c => GEO[c.code] && !used.has(c.code)).map(c => ({ c, w: GEO[c.code].weight }));
  const tried = new Set();
  for (let a = 0; a < g.attempts && pool.length; a++) {
    const live = pool.filter(p => !tried.has(p.c.code));
    if (!live.length) break;
    const p = weightedPick(live, rng);
    tried.add(p.c.code);
    const pts = GEO[p.c.code].points;
    const point = pts[Math.floor(rng() * pts.length)];
    let images = [];
    try { images = await queryImages(bboxAround(point, rng)); }
    catch (err) { console.error('[Geo] Mapillary query failed:', err.message); }
    if (!images.length) continue;
    const im = images[Math.floor(rng() * images.length)];
    const coords = im.computed_geometry && im.computed_geometry.coordinates;
    return { country: p.c, image: { id: im.id, url: im.thumb_1024_url, lon: coords ? coords[0] : null, lat: coords ? coords[1] : null } };
  }
  return null;
}

const POINTS = [3, 2, 1];
const maskOf = (name) => [...name].map(ch => (ch === ' ' ? '   ' : '﹏')).join(' ');
const firstLetterOf = (ar) => (ar.startsWith('ال') ? ar.slice(2, 3) : [...ar][0]);

function roundEmbed(q, n, total, hintLevel) {
  const c = q.country;
  const e = new EmbedBuilder().setColor(0x2ECC71).setTitle(`📍 الجولة ${n}/${total}`)
    .setDescription('**في أي دولة التقطت هذه الصورة؟**\nاكتب اسم الدولة في الشات!')
    .setImage(q.image.url)
    .setFooter({ text: `📷 Mapillary (CC-BY-SA) · لديك ${Math.round(g.roundMs / 1000)} ثانية` });
  if (hintLevel >= 1) e.addFields({ name: '💡 تلميح ١', value: `القارة: **${c.continentAr}**` });
  if (hintLevel >= 2) e.addFields({ name: '💡 تلميح ٢', value: `${maskOf(c.ar)}  (${[...c.ar].filter(x => x !== ' ').length} حروف)\nيبدأ بحرف **${firstLetterOf(c.ar)}**` });
  return e;
}

function scoreboard(s) {
  const rows = s.ids.map(id => ({ id, pts: s.data.scores.get(id) || 0 })).sort((a, b) => b.pts - a.pts);
  return rows.map((r, i) => `${['🥇', '🥈', '🥉'][i] || '▫️'} ${s.mention(r.id)} — **${r.pts}**`).join('\n');
}

const mapLink = (im) => (im.lat != null ? `https://www.google.com/maps?q=${im.lat},${im.lon}` : null);

async function start(s) {
  const rounds = s.options.rounds || g.rounds;
  s.data.scores = new Map(s.ids.map(id => [id, 0]));
  s.data.current = null;
  const used = new Set();
  let failures = 0;
  let played = 0;

  await s.channel.send({ content: `📍 **جيو** — ${rounds} جولات · صورة شارع حقيقية وعليكم تخمين الدولة! الأسرع يأخذ ٣ نقاط، ثم ٢، ثم ١.`, allowedMentions: { parse: [] } });
  await sleep(g.introMs);

  for (let i = 0; i < rounds; i++) {
    if (s.status !== 'running') return;
    const q = await findPhoto({ used });
    if (!q) {
      failures++;
      await s.channel.send('⚠️ تعذّر جلب صورة لهذه الجولة.');
      if (failures >= 2) return s.abort('تعذّر جلب صور من Mapillary — تم إلغاء اللعبة.');   // two rounds in a row
      continue;
    }
    failures = 0;
    used.add(q.country.code);
    played++;

    const cur = { q, resolved: false, answered: new Set(), order: [], done: null };
    const finished = new Promise(res => { cur.done = res; });
    s.data.current = cur;

    const msg = await s.channel.send({ embeds: [roundEmbed(q, i + 1, rounds, 0)] });
    const t1 = setTimeout(() => { if (!cur.resolved) msg.edit({ embeds: [roundEmbed(q, i + 1, rounds, 1)] }).catch(() => {}); }, Math.floor(g.roundMs / 3));
    const t2 = setTimeout(() => { if (!cur.resolved) msg.edit({ embeds: [roundEmbed(q, i + 1, rounds, 2)] }).catch(() => {}); }, Math.floor(g.roundMs * 2 / 3));
    const end = setTimeout(() => cur.done(), g.roundMs);
    cur.timers = [t1, t2, end];
    for (const t of cur.timers) s.timers.add(t);

    await finished;
    for (const t of cur.timers) { clearTimeout(t); s.timers.delete(t); }
    s.data.current = null;
    if (s.status !== 'running') return;

    const link = mapLink(q.image);
    if (cur.order.length) {
      const lines = cur.order.map((id, k) => `${s.mention(id)} (+${POINTS[k]})`);
      await s.channel.send({ content: `✅ الجواب: **${q.country.ar}** ${q.country.flag}\n${lines.join(' · ')}${link ? `\n📍 ${link}` : ''}`, allowedMentions: { parse: [] } });
    } else {
      await s.channel.send(`⌛ انتهى الوقت! الجواب: **${q.country.ar}** ${q.country.flag}${link ? `\n📍 ${link}` : ''}`);
    }
    await sleep(g.pauseMs);
  }

  const top = Math.max(0, ...s.data.scores.values());
  const winners = top > 0 ? s.ids.filter(id => (s.data.scores.get(id) || 0) === top) : [];
  const board = scoreboard(s);
  const fin = await s.finish({ winners, active: s.ids.filter(id => s.players.get(id).active) });
  if (!fin) return;
  await s.channel.send({
    embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('🏁 انتهت اللعبة')
      .setDescription(`${board}\n\n${winners.length ? `🏆 ${winners.map(i => `<@${i}>`).join(' و ')}` : 'لا يوجد فائز'}${fin.noteText}`)],
    allowedMentions: { parse: [] },
  });
}

function onMessage(s, message) {
  const cur = s.data.current;
  if (!cur || cur.resolved || s.status !== 'running') return;
  const uid = message.author.id;
  if (!s.players.has(uid) || cur.answered.has(uid)) return;
  const text = (message.content || '').trim();
  if (!text || text.length > 60) return;
  s.markActive(uid);
  if (!matches(cur.q.country, text)) return;
  cur.answered.add(uid);
  const rank = cur.order.length;
  cur.order.push(uid);
  s.data.scores.set(uid, (s.data.scores.get(uid) || 0) + POINTS[rank]);
  message.react('✅').catch(() => {});
  // The round closes after the third correct answer, or a short grace after the first.
  if (cur.order.length >= POINTS.length || cur.order.length >= s.players.size) { cur.resolved = true; cur.done(); }
  else if (rank === 0) {
    const t = setTimeout(() => { cur.resolved = true; cur.done(); }, g.graceAfterFirstMs);
    cur.timers.push(t); s.timers.add(t);
  }
}

module.exports = {
  type: 'geo', title: 'جيو — خمّن البلد من الشارع', emoji: '📍', min: g.min, max: g.max,
  blurb: 'تظهر صورة شارع حقيقية من أنحاء العالم وعلى اللاعبين تخمين الدولة بأسرع ما يمكن. الأكثر نقاطًا يفوز!',
  start, onMessage, precheck: () => (isConfigured() ? null : NOT_CONFIGURED),
  // exported for tests
  findPhoto, buildUrl, bboxAround, queryImages, setFetch, isConfigured, NOT_CONFIGURED, POINTS,
};
