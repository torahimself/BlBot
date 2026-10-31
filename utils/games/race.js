'use strict';
// Shared engine for the "first correct answer wins the round" games (typing race, math race).
// A game supplies makeRound(index) → { prompt (embed description), accept(text, elapsedMs) → bool, reveal (text shown when nobody wins) }.

const { EmbedBuilder } = require('discord.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function scoreboard(s) {
  const rows = s.ids.map(id => ({ id, pts: s.data.scores.get(id) || 0 })).sort((a, b) => b.pts - a.pts);
  return rows.map((r, i) => `${['🥇', '🥈', '🥉'][i] || '▫️'} ${s.mention(r.id)} — **${r.pts}**`).join('\n');
}

function makeRace({ type, title, emoji, color, blurb, c, intro, makeRound }) {
  async function start(s) {
    const rounds = s.options.rounds || c.rounds;
    s.data.scores = new Map(s.ids.map(id => [id, 0]));
    s.data.current = null;
    await s.channel.send({ content: `${emoji} **${title}** — ${rounds} جولات · ${intro}`, allowedMentions: { parse: [] } });
    await sleep(c.introMs || 2500);

    for (let i = 0; i < rounds; i++) {
      if (s.status !== 'running') return;
      const q = makeRound(i, rounds);
      const cur = { q, startedAt: 0, resolved: false, winner: null, done: null };
      const finished = new Promise(res => { cur.done = res; });
      await s.channel.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(`${emoji} الجولة ${i + 1}/${rounds}`).setDescription(q.prompt).setFooter({ text: `لديك ${Math.round(c.roundMs / 1000)} ثانية` })] });
      cur.startedAt = Date.now();
      s.data.current = cur;
      const t = setTimeout(() => cur.done(), c.roundMs);
      s.timers.add(t);
      await finished;
      clearTimeout(t); s.timers.delete(t);
      s.data.current = null;
      if (s.status !== 'running') return;

      if (cur.winner) {
        s.data.scores.set(cur.winner, (s.data.scores.get(cur.winner) || 0) + 1);
        const secs = ((cur.at - cur.startedAt) / 1000).toFixed(1);
        await s.channel.send({ content: `✅ ${s.mention(cur.winner)} الأسرع! (${secs} ثانية) (+1)`, allowedMentions: { parse: [] } });
      } else {
        await s.channel.send(`⌛ انتهى الوقت! ${q.reveal}`);
      }
      await sleep(c.pauseMs || 2000);
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

  // Synchronous on purpose: two answers in the same instant are handled strictly in arrival order.
  function onMessage(s, message) {
    const cur = s.data.current;
    if (!cur || cur.resolved || s.status !== 'running') return;
    if (!s.players.has(message.author.id)) return;
    const text = String(message.content || '').trim();
    if (!text || text.length > 200) return;
    const now = Date.now();
    if (!cur.q.accept(text, now - cur.startedAt)) return;
    s.markActive(message.author.id);
    cur.resolved = true; cur.winner = message.author.id; cur.at = now;
    message.react('✅').catch(() => {});
    cur.done();
  }

  return { type, title, emoji, min: c.min, max: c.max, blurb, start, onMessage };
}

module.exports = { makeRace, scoreboard };
