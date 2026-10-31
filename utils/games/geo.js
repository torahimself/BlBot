'use strict';
// 📍 جيو — GeoGuessr-style game, COUNTRIES ONLY.
//   • A real ground-level photo is shown. Players type the COUNTRY (Arabic or English) in the chat.
//   • Only a clear, standalone country name counts as a guess (geoGuess.js). Conversation, questions,
//     capitals and random text are ignored completely — no reactions, no replies, no pins.
//   • The first valid guess is FINAL (no lock button, no changing). Each country can be taken by ONE player
//     per round — «ألمانيا» and «Germany» are the same country — so a second player is told it is taken
//     and may still choose another country.
//   • Round end: the right country = 40 points; any other country scores by how close its pin is to the
//     real spot (geoScore.js, never above 39), and a map shows every pin.
//   • Photos: Mapillary street-level (free token) → Wikimedia Commons (no key); space / satellite / aerial /
//     map images are filtered out (geoPhotos.js). See GEO_SETUP.md.
//   • Hints: the continent at 1/3 of the time, first letter of the country + length at 2/3.

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const cfg = require('./config.js');
const net = require('./geoNet.js');
const photos = require('./geoPhotos.js');
const guess = require('./geoGuess.js');
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
      'اكتب **اسم الدولة** في الشات (عربي أو إنجليزي) — أول اختيار صحيح الكتابة هو اختيارك النهائي، ولا يمكن لاعبين اثنين اختيار الدولة نفسها.\n' +
      `الدولة الصحيحة = **${score.MAX}** نقطة، والأقرب إليها يأخذ نقاطًا أقل.`)
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

/** One finished round → rows, best first. A player without a country scores 0. */
function resolveRound(s, cur) {
  const truth = cur.q.image;
  const rows = [];
  for (const id of s.ids) {
    const pin = cur.guesses.get(id) || null;
    if (!pin) { rows.push({ id, pin: null, km: null, pts: 0, right: false }); continue; }
    const right = pin.code === cur.q.country.code;
    const km = truth.lat != null ? score.haversineKm(truth.lat, truth.lon, pin.lat, pin.lon) : null;
    const pts = right ? score.MAX : (km == null ? 0 : Math.min(score.MAX - 1, score.pointsFor(km)));
    rows.push({ id, pin, km, pts, right });
  }
  rows.sort((a, b) => b.pts - a.pts || (a.km == null) - (b.km == null) || a.km - b.km);
  return rows;
}

async function start(s) {
  const rounds = s.options.rounds || g().rounds;
  s.data.scores = new Map(s.ids.map(id => [id, 0]));
  s.data.current = null;
  const used = new Set();
  let failures = 0;

  await s.channel.send({
    content: `📍 **جيو** — ${rounds} جولات · صورة من مكان حقيقي وعليكم تخمين **الدولة**! اكتب اسم الدولة، أول اختيار هو النهائي، ولا تتكرر الدولة بين اللاعبين. الدولة الصحيحة = **${score.MAX}** نقطة.`,
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

    const cur = { q, resolved: false, guesses: new Map(), taken: new Map(), done: null, timers: [] };   // taken: country code → player
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
    if (cur.allIn) { clearTimeout(cur.allIn); s.timers.delete(cur.allIn); }
    for (const t of cur.timers) { clearTimeout(t); s.timers.delete(t); }
    s.data.current = null;
    if (s.status !== 'running') return;

    // ── the round's result: distances, points, map ──
    const rows = resolveRound(s, cur);
    for (const r of rows) s.data.scores.set(r.id, (s.data.scores.get(r.id) || 0) + r.pts);
    for (const r of rows) if (r.right) await s.awardBadge(r.id, 'pinpoint');
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
  const guessed = rows.filter(r => r.pin);
  const lines = guessed.map((r, k) => `${NUM[k] || '▫️'} ${s.mention(r.id)} — ${r.pin.label} · ${r.right ? '✅ **صحيح**' : (r.km != null ? `**${score.formatKm(r.km)}** عن المكان الحقيقي` : '')} · **+${r.pts}**`);
  const silent = rows.filter(r => !r.pin).map(r => s.mention(r.id));
  if (silent.length) lines.push(`💤 ${silent.join(' ')} — لم يختاروا دولة (+0)`);

  const embed = new EmbedBuilder().setColor(guessed.length ? 0x2ECC71 : 0xE67E22)
    .setTitle(`✅ الجواب: ${q.country.ar} ${q.country.flag} — الجولة ${n}/${total}`)
    .setDescription(`${lines.join('\n') || 'لم يختر أحد دولة.'}${link ? `\n\n🌍 [الموقع الحقيقي على الخريطة](${link})${truth.page ? ` · [الصورة](${truth.page})` : ''}` : ''}`);

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

/** A short notice that removes itself, so the channel stays clean. */
function note(s, message, content) {
  message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).then((m) => {
    if (m && typeof m.delete === 'function') {
      const t = setTimeout(() => { s.timers.delete(t); m.delete().catch(() => {}); }, 6000);
      s.timers.add(t);
    }
  }).catch(() => {});
}

/**
 * Called for every message in the game's channel while it runs. Never throws, and never reacts to
 * anything that is not a valid country guess. Fully synchronous, so two players naming the same
 * country at the same moment are handled strictly in arrival order: the first one gets it.
 */
function onMessage(s, message) {
  const cur = s.data.current;
  if (!cur || cur.resolved || s.status !== 'running') return;
  const uid = message.author.id;
  if (!s.players.has(uid)) return;
  if (cur.guesses.has(uid)) return;                       // the first valid guess is final
  const country = guess.parseGuess(message.content);
  if (!country) return;                                   // not a country → completely ignored
  if (cur.taken.has(country.code)) {                      // already someone's → say so, keep the player free to choose another
    note(s, message, `⛔ **${country.ar}** اختارها لاعب آخر — اختر دولة أخرى.`);
    return;
  }
  cur.taken.set(country.code, uid);
  const pin = guess.pinOf(country);
  cur.guesses.set(uid, pin);
  s.markActive(uid);
  message.react('📍').catch(() => {});
  note(s, message, `📍 تم تثبيت اختيارك: **${pin.label}**`);

  // Everybody has chosen → the round closes right away (nobody can change anything anymore).
  if (s.ids.every(id => cur.guesses.has(id))) {
    if (cur.allIn) { clearTimeout(cur.allIn); s.timers.delete(cur.allIn); }
    cur.allIn = setTimeout(() => { s.timers.delete(cur.allIn); cur.finish(); }, g().allGuessedGraceMs);
    s.timers.add(cur.allIn);
    cur.timers.push(cur.allIn);
  }
}

module.exports = {
  type: 'geo', title: 'جيو — خمّن مكان الصورة', emoji: '📍', min: cfg.geo.min, max: cfg.geo.max,
  blurb: 'تظهر صورة من مكان حقيقي في العالم. اكتب اسم الدولة — أول اختيار نهائي، ولا تتكرر الدولة بين اللاعبين. الدولة الصحيحة 40 نقطة!',
  start, onMessage, precheck: () => (photos.isConfigured() ? null : NOT_CONFIGURED),
  // exported for tests
  findPhoto: (o) => photos.findPhoto(o), buildUrl: (...a) => photos.buildUrl(...a), bboxAround: (...a) => photos.bboxAround(...a),
  setFetch: net.setFetch, isConfigured: () => photos.isConfigured(), NOT_CONFIGURED, resolveRound,
};
