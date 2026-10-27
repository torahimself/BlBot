'use strict';
// 📍 جيو — GeoGuessr-style game with pins.
//   • A photo is shown. Players TYPE where they think it was taken — a city, a country, a street («جدة»،
//     «Tokyo»، «فرنسا»…). The bot looks the place up and drops a 📍 pin (the player may change it until time is up).
//   • When the round ends the bot shows everyone's distance from the real spot on a map, and the points:
//     the closer the pin the more points, up to 40 for a pinpoint (geoScore.js). The closest always scores most.
//   • Photos: Mapillary street-level (needs a free token) → Wikimedia Commons (no key). See GEO_SETUP.md.
//   • Hints: the continent at 1/3 of the time, first letter of the country + length at 2/3.

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const cfg = require('./config.js');
const net = require('./geoNet.js');
const photos = require('./geoPhotos.js');
const geocode = require('./geocode.js');
const score = require('./geoScore.js');
const geoMap = require('./geoMap.js');

const g = () => cfg.geo;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const NOT_CONFIGURED = '⚙️ لعبة **جيو** غير مفعّلة — لا يوجد مصدر صور (انظر GEO_SETUP.md).';

const maskOf = (name) => [...name].map(ch => (ch === ' ' ? '   ' : '﹏')).join(' ');
const firstLetterOf = (ar) => (ar.startsWith('ال') ? ar.slice(2, 3) : [...ar][0]);
const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function roundEmbed(q, n, total, hintLevel, withMap = false) {
  const c = q.country;
  const e = new EmbedBuilder().setColor(0x2ECC71).setTitle(`📍 الجولة ${n}/${total}`)
    .setDescription(
      '**أين التقطت هذه الصورة؟**\n' +
      'اكتب في الشات **اسم المدينة أو الدولة أو المكان** وسأضع دبوسك 📍 على الخريطة.\n' +
      `كلما اقترب دبوسك من المكان الحقيقي ربحت نقاطًا أكثر — حتى **${score.MAX}** نقطة! (يمكنك تغيير دبوسك قبل نهاية الوقت)`)
    .setImage(q.image.url)
    .setFooter({ text: `${q.credit || '📷'} · لديك ${Math.round(g().roundMs / 1000)} ثانية` });
  if (hintLevel >= 1) e.addFields({ name: '💡 تلميح ١', value: `القارة: **${c.continentAr}**` });
  if (hintLevel >= 2) e.addFields({ name: '💡 تلميح ٢', value: `${maskOf(c.ar)}  (${[...c.ar].filter(x => x !== ' ').length} حروف)\nيبدأ بحرف **${firstLetterOf(c.ar)}**` });
  return e;
}

function scoreboard(s) {
  const rows = s.ids.map(id => ({ id, pts: s.data.scores.get(id) || 0 })).sort((a, b) => b.pts - a.pts);
  return rows.map((r, i) => `${['🥇', '🥈', '🥉'][i] || '▫️'} ${s.mention(r.id)} — **${r.pts}**`).join('\n');
}

const mapLink = (im) => (im.lat != null ? `https://www.google.com/maps?q=${im.lat},${im.lon}` : null);

/** Distances and points for one finished round, closest first. Players without a pin score 0. */
function resolveRound(s, cur) {
  const truth = cur.q.image;
  const rows = [];
  for (const id of s.ids) {
    const pin = cur.guesses.get(id);
    if (pin && truth.lat != null) {
      const km = score.haversineKm(truth.lat, truth.lon, pin.lat, pin.lon);
      rows.push({ id, pin, km, pts: score.pointsFor(km) });
    } else rows.push({ id, pin: pin || null, km: null, pts: 0 });
  }
  rows.sort((a, b) => (a.km == null) - (b.km == null) || a.km - b.km);
  return rows;
}

async function start(s) {
  const rounds = s.options.rounds || g().rounds;
  s.data.scores = new Map(s.ids.map(id => [id, 0]));
  s.data.current = null;
  const used = new Set();
  let failures = 0;

  await s.channel.send({
    content: `📍 **جيو** — ${rounds} جولات · صورة من مكان حقيقي وعليكم تخمين مكانها! اكتبوا اسم المدينة أو الدولة، يوضع دبوسكم على الخريطة، وأقرب دبوس يأخذ أعلى نقاط (حتى **${score.MAX}**).`,
    allowedMentions: { parse: [] },
  });
  await sleep(g().introMs);

  for (let i = 0; i < rounds; i++) {
    if (s.status !== 'running') return;
    const q = await photos.findPhoto({ used });
    if (!q) {
      failures++;
      await s.channel.send('⚠️ تعذّر جلب صورة لهذه الجولة.').catch(() => {});
      if (failures >= 2) return s.abort('تعذّر جلب الصور — تم إلغاء اللعبة.');   // two rounds in a row
      continue;
    }
    failures = 0;
    used.add(q.country.code);

    const cur = { q, resolved: false, guesses: new Map(), lookups: new Map(), busy: new Set(), done: null, timers: [], lastGuessAt: 0 };
    const finished = new Promise(res => { cur.done = res; });
    cur.finish = () => { if (!cur.resolved) { cur.resolved = true; cur.done(); } };
    s.data.current = cur;

    const msg = await s.channel.send({ embeds: [roundEmbed(q, i + 1, rounds, 0)] });
    const t1 = setTimeout(() => { if (!cur.resolved) msg.edit({ embeds: [roundEmbed(q, i + 1, rounds, 1)] }).catch(() => {}); }, Math.floor(g().roundMs / 3));
    const t2 = setTimeout(() => { if (!cur.resolved) msg.edit({ embeds: [roundEmbed(q, i + 1, rounds, 2)] }).catch(() => {}); }, Math.floor(g().roundMs * 2 / 3));
    const end = setTimeout(() => cur.finish(), g().roundMs);
    cur.timers.push(t1, t2, end);
    for (const t of cur.timers) s.timers.add(t);

    await finished;
    cur.resolved = true;
    for (const t of cur.timers) { clearTimeout(t); s.timers.delete(t); }
    // a pin whose lookup is still running when time is up does not count
    s.data.current = null;
    if (s.status !== 'running') return;

    // ── the round's result: distances, points, map ──
    const rows = resolveRound(s, cur);
    for (const r of rows) s.data.scores.set(r.id, (s.data.scores.get(r.id) || 0) + r.pts);
    await showResult(s, cur, rows, i + 1, rounds);
    await sleep(g().pauseMs);
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
  }).catch(() => {});
}

async function showResult(s, cur, rows, n, total) {
  const q = cur.q, truth = q.image;
  const link = mapLink(truth);
  const guessed = rows.filter(r => r.km != null);
  const lines = guessed.map((r, k) => `${NUM[k] || '▫️'} ${s.mention(r.id)} — ${r.pin.label} · **${score.formatKm(r.km)}** · **+${r.pts}**`);
  const silent = rows.filter(r => r.km == null && !r.pin).map(r => s.mention(r.id));
  if (silent.length) lines.push(`💤 ${silent.join(' ')} — لم يضعوا دبوسًا (+0)`);
  if (truth.lat == null) lines.push('⚠️ لا تتوفر إحداثيات دقيقة لهذه الصورة — لا نقاط في هذه الجولة.');

  const embed = new EmbedBuilder().setColor(guessed.length ? 0x2ECC71 : 0xE67E22)
    .setTitle(`✅ الجواب: ${q.country.ar} ${q.country.flag} — الجولة ${n}/${total}`)
    .setDescription(`${lines.join('\n') || 'لم يضع أحد دبوسًا.'}${link ? `\n\n🌍 [الموقع الحقيقي على الخريطة](${link})${truth.page ? ` · [الصورة](${truth.page})` : ''}` : ''}`);

  const payload = { embeds: [embed], allowedMentions: { parse: [] } };
  if (guessed.length && truth.lat != null) {
    let png = null;
    try { png = geoMap.render(truth, guessed.map(r => r.pin)); } catch (err) { console.error('[Geo] map render failed:', err.message); }
    if (png) {
      payload.files = [new AttachmentBuilder(png, { name: 'geo-result.png' })];
      embed.setImage('attachment://geo-result.png');
      embed.setFooter({ text: '⭐ الموقع الحقيقي · الأرقام = ترتيب الدبابيس' });
    }
  }
  await s.channel.send(payload).catch(async () => { await s.channel.send({ embeds: [embed.setImage(null)], allowedMentions: { parse: [] } }).catch(() => {}); });
}

/** Called for every message in the game's channel while it runs. Never throws. */
function onMessage(s, message) {
  const cur = s.data.current;
  if (!cur || cur.resolved || s.status !== 'running') return;
  const uid = message.author.id;
  if (!s.players.has(uid)) return;
  const q = geocode.toQuery(message.content);
  if (!q) return;
  if (cur.busy.has(uid)) return;                        // one look-up at a time per player
  const n = (cur.lookups.get(uid) || 0) + 1;
  if (n > g().maxLookups) return;
  cur.lookups.set(uid, n);
  cur.busy.add(uid);
  s.markActive(uid);
  placePin(s, cur, uid, message, q).catch(err => console.error('[Geo] pin failed:', err.message)).finally(() => cur.busy.delete(uid));
}

async function placePin(s, cur, uid, message, q) {
  const hit = await geocode.locate(q);
  if (cur.resolved || s.status !== 'running') return;   // time ran out while looking it up
  if (!hit) { message.react('❓').catch(() => {}); return; }
  const changed = cur.guesses.has(uid);
  cur.guesses.set(uid, { lat: hit.lat, lon: hit.lon, label: hit.label, query: q });
  message.react('📍').catch(() => {});
  // A short confirmation (it never reveals where the photo is) that removes itself.
  const note = await message.reply({ content: `📍 ${changed ? 'تم تغيير دبوسك إلى' : 'تم وضع دبوسك على'}: **${hit.label}**`, allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
  if (note && typeof note.delete === 'function') {
    const t = setTimeout(() => { s.timers.delete(t); note.delete().catch(() => {}); }, 8000);
    s.timers.add(t);
  }
  // Everybody has a pin → the round closes shortly after the last one (time to change one's mind).
  if (s.ids.every(id => cur.guesses.has(id))) {
    if (cur.allIn) { clearTimeout(cur.allIn); s.timers.delete(cur.allIn); }
    cur.allIn = setTimeout(() => { s.timers.delete(cur.allIn); cur.finish(); }, g().allGuessedGraceMs);
    s.timers.add(cur.allIn);
    cur.timers.push(cur.allIn);
  }
}

module.exports = {
  type: 'geo', title: 'جيو — خمّن مكان الصورة', emoji: '📍', min: cfg.geo.min, max: cfg.geo.max,
  blurb: 'تظهر صورة من مكان حقيقي في العالم. اكتب اسم المدينة أو الدولة لتضع دبوسك 📍 — الأقرب إلى المكان الحقيقي يربح أعلى نقاط (حتى 40)!',
  start, onMessage, precheck: () => (photos.isConfigured() ? null : NOT_CONFIGURED),
  // exported for tests
  findPhoto: (o) => photos.findPhoto(o), buildUrl: (...a) => photos.buildUrl(...a), bboxAround: (...a) => photos.bboxAround(...a),
  setFetch: net.setFetch, isConfigured: () => photos.isConfigured(), NOT_CONFIGURED, resolveRound,
};
