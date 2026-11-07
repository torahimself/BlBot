'use strict';
// The time-limited seasonal shop behind /buy. Everything about a season (dates, items, prices) lives in
// settings.seasonalShop; this file only reads it. The shop opens and closes by the clock — nothing to switch by hand.
//
//   • what a member bought is stored in `shop_purchases` and is theirs for good
//   • a bought title is also written to `titles` (so /profile and the card show it, even after the shop closed)
//   • themes / backgrounds are unlocked for their owners through ownedIds()

const settings = require('./engine/settings');
const dbx = require('./engine/dbx');
const notify = require('./engine/notify');
const shopManager = require('./shopManager');

const DAY = 24 * 60 * 60 * 1000;
let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      await dbx.run(`CREATE TABLE IF NOT EXISTS shop_purchases (userId TEXT, itemId TEXT, shopId TEXT, price INTEGER, boughtAt INTEGER, PRIMARY KEY (userId, itemId))`);
      await dbx.run(`CREATE TABLE IF NOT EXISTS shop_state (shopId TEXT PRIMARY KEY, openedNotified INTEGER DEFAULT 0, closedNotified INTEGER DEFAULT 0)`);
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const cfg = () => settings.seasonalShop || { current: null, list: {} };
const current = () => cfg().list[cfg().current] || null;
const windowOf = (s) => { const startAt = Date.parse(s.startAt); return { startAt, endAt: startAt + s.durationDays * DAY }; };

/** 'none' | 'upcoming' | 'open' | 'closed' */
function phase(now = Date.now(), s = current()) {
  if (!s) return 'none';
  const { startAt, endAt } = windowOf(s);
  return now < startAt ? 'upcoming' : now < endAt ? 'open' : 'closed';
}

const titleIdOf = (s, item) => `ss_${s.id}_${item.id}`;
/** Every item of every season ever configured (so an owned item keeps working after the season is removed from `current`). */
function itemById(id) {
  for (const s of Object.values(cfg().list)) { const it = s.items.find(i => i.id === id); if (it) return { shop: s, item: it }; }
  return null;
}

/** Display info for a title bought in a shop (used by views.titleInfo). */
function titleInfo(titleId) {
  const m = /^ss_(.+?)_(title_[a-z0-9_]+)$/.exec(String(titleId || ''));
  if (!m) return null;
  const s = cfg().list[m[1]];
  const it = s && s.items.find(i => i.id === m[2]);
  if (!it) return null;
  return { kind: 'event', name: it.name, emoji: it.emoji, event: { name: s.name }, tier: { label: 'Limited', emoji: s.emoji } };
}

async function ownedIds(userId) {
  await init();
  return (await dbx.all('SELECT itemId FROM shop_purchases WHERE userId = ?', [userId])).map(r => r.itemId);
}

/**
 * Buys an item. → { ok:true, item, balance } | { ok:false, error }
 * The coins are taken first (atomically, so two clicks can never spend the same coins) and handed back if
 * anything after that fails.
 */
async function buy(userId, itemId, now = Date.now()) {
  await init();
  const s = current();
  const ph = phase(now, s);
  if (ph !== 'open') return { ok: false, error: ph === 'upcoming' ? '⏳ The seasonal shop has not opened yet.' : '🔒 The seasonal shop is closed.' };
  const item = s.items.find(i => i.id === itemId);
  if (!item) return { ok: false, error: '❌ That item does not exist.' };

  return dbx.exclusive(`shop:${userId}`, async () => {
    if ((await ownedIds(userId)).includes(item.id)) return { ok: false, error: `✅ You already own **${item.name}**.` };
    const paid = await shopManager.spendCoins(userId, item.price);
    if (!paid) return { ok: false, error: `❌ You need **${item.price.toLocaleString('en-US')}** coins for **${item.name}**. You have **${(await shopManager.getBalance(userId)).toLocaleString('en-US')}**.` };
    try {
      const r = await dbx.run('INSERT OR IGNORE INTO shop_purchases (userId, itemId, shopId, price, boughtAt) VALUES (?, ?, ?, ?, ?)', [userId, item.id, s.id, item.price, now]);
      if (!r.changes) { await shopManager.updateBalance(userId, item.price); return { ok: false, error: `✅ You already own **${item.name}**.` }; }
      if (item.kind === 'title') await dbx.run("INSERT OR IGNORE INTO titles (userId, titleId, category, earnedAt) VALUES (?, ?, 'event', ?)", [userId, titleIdOf(s, item), now]);
    } catch (err) {
      console.error('[Shop] purchase failed, refunding:', err);
      await dbx.run('DELETE FROM shop_purchases WHERE userId = ? AND itemId = ?', [userId, item.id]).catch(() => {});
      await shopManager.updateBalance(userId, item.price);
      return { ok: false, error: '⚠️ Something went wrong — you were not charged.' };
    }
    return { ok: true, item, balance: await shopManager.getBalance(userId) };
  });
}

/** Opens / closes announcements, once each (survives restarts). Called every minute by the engine clock. */
async function tick(client, now = Date.now()) {
  const s = current();
  if (!s) return;
  await init();
  const ph = phase(now, s);
  if (ph === 'upcoming' || ph === 'none') return;
  const { endAt } = windowOf(s);
  await dbx.run('INSERT OR IGNORE INTO shop_state (shopId) VALUES (?)', [s.id]);
  const st = await dbx.get('SELECT * FROM shop_state WHERE shopId = ?', [s.id]);
  const say = async (text) => {
    if (!client || !s.announceChannelId) return;
    const ch = await client.channels.fetch(s.announceChannelId).catch(() => null);
    if (ch && ch.isTextBased()) await ch.send(text).catch(() => {});
  };
  if (ph === 'open' && !st.openedNotified) {
    await dbx.run('UPDATE shop_state SET openedNotified = 1 WHERE shopId = ?', [s.id]);
    await say(`${s.emoji} **${s.name}** is open! Use **/buy** → Seasonal shop. It closes <t:${Math.floor(endAt / 1000)}:R>.`);
    await notify.notifyDeveloper(client, `${s.emoji} **${s.name}** just opened (closes <t:${Math.floor(endAt / 1000)}:F>, <t:${Math.floor(endAt / 1000)}:R>).`);
  }
  if (ph === 'closed' && !st.closedNotified) {
    await dbx.run('UPDATE shop_state SET openedNotified = 1, closedNotified = 1 WHERE shopId = ?', [s.id]);
    const sold = await dbx.get('SELECT COUNT(*) AS n, COALESCE(SUM(price), 0) AS coins, COUNT(DISTINCT userId) AS buyers FROM shop_purchases WHERE shopId = ?', [s.id]);
    await say(`${s.emoji} **${s.name}** is now closed. Thanks for shopping!`);
    await notify.notifyDeveloper(client,
      `${s.emoji} **${s.name}** has closed by itself.\n` +
      `Sold **${sold.n}** items to **${sold.buyers}** members for **${Number(sold.coins).toLocaleString('en-US')}** coins.\n\n` +
      `🛠️ Nothing is required — /buy hides the seasonal shop on its own. To tidy up on GitHub:\n` +
      `• in \`utils/economy/engine/settings.js\` set \`seasonalShop.current\` to \`null\` (keep the block as a template for the next season)\n` +
      `✅ Everything members bought stays theirs (titles in the database, colours / backgrounds unlocked for their owners).`);
  }
}

module.exports = { init, current, phase, windowOf, titleInfo, itemById, ownedIds, buy, tick, titleIdOf };
