'use strict';
// /buy menu + seasonal shop: opens/closes by the clock, buying is atomic, purchases are permanent.
//   node dev/test-shop.js
process.env.BL_ECONOMY_DB = ':memory:';
const path = require('path');
const root = path.join(__dirname, '..');
const db = require(path.join(root, 'utils/economy/database.js'));
const dbx = require(path.join(root, 'utils/economy/engine/dbx.js'));
const settings = require(path.join(root, 'utils/economy/engine/settings.js'));
const shop = require(path.join(root, 'utils/economy/seasonalShop.js'));
const menu = require(path.join(root, 'utils/economy/buyMenu.js'));
const views = require(path.join(root, 'utils/economy/engine/views.js'));
const themes = require(path.join(root, 'utils/ui/themes.js'));
const backgrounds = require(path.join(root, 'utils/ui/backgrounds.js'));
const { getBalance } = require(path.join(root, 'utils/economy/shopManager.js'));
const notify = require(path.join(root, 'utils/economy/engine/notify.js'));
const commandHandler = require(path.join(root, 'handlers/commandHandler.js'));

let passed = 0, failed = 0;
const t = async (n, f) => { try { await f(); passed++; console.log('  ✓', n); } catch (e) { failed++; console.log('  ✗', n, '\n     ', e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const setBal = (id, v) => dbx.run('INSERT INTO users (userId,balance) VALUES (?,?) ON CONFLICT(userId) DO UPDATE SET balance=?', [id, v, v]);
const s = settings.seasonalShop.list['autumn-2026'];
const START = Date.parse('2026-11-07T00:00:00+03:00'), END = START + 5 * 86400000;

(async () => {
  await db.ready; await shop.init();
  await t('window: opens 7 Nov 2026 and closes by itself exactly 5 days later', () => {
    eq(shop.phase(START - 1), 'upcoming', 'before'); eq(shop.phase(START), 'open', 'start');
    eq(shop.phase(END - 1), 'open', 'last ms'); eq(shop.phase(END), 'closed', 'end');
    eq(new Date(END).toISOString(), '2026-11-11T21:00:00.000Z', '12 Nov 00:00 Riyadh');
  });
  await t('settings are valid, ids unique, every theme / background item exists', () => {
    settings.validate();
    const ids = s.items.map(i => i.id); eq(new Set(ids).size, ids.length, 'unique ids');
    for (const i of s.items) {
      if (i.kind === 'theme') eq(!!themes.THEMES.find(x => x.shop === i.id), true, 'theme for ' + i.id);
      if (i.kind === 'background') eq(!!backgrounds.all().find(x => x.unlock && x.unlock.shop === i.id), true, 'background for ' + i.id);
      if (!(i.price > 0 && Number.isInteger(i.price))) throw new Error('bad price ' + i.id);
    }
  });
  await t('cannot buy before opening or after closing; nothing is charged', async () => {
    await setBal('u', 50000);
    let r = await shop.buy('u', 'title_leaf', START - 1000); eq(r.ok, false, 'before');
    r = await shop.buy('u', 'title_leaf', END + 1000); eq(r.ok, false, 'after');
    eq(await getBalance('u'), 50000, 'untouched');
  });
  const realNow = Date.now; Date.now = () => START + 1000;      // the shop is open from here on
  await t('buying a title: coins taken once, title saved, shows on the profile', async () => {
    await setBal('b', 10000);
    const r = await shop.buy('b', 'title_leaf'); eq(r.ok, true, JSON.stringify(r));
    eq(await getBalance('b'), 6000, 'paid 4000');
    const row = await dbx.get("SELECT * FROM titles WHERE userId = 'b'"); eq(row.titleId, 'ss_autumn-2026_title_leaf', 'title id');
    const info = views.titleInfo(row.titleId); eq(info.name, 'Leaf Wanderer', 'title info'); eq(info.kind, 'event', 'kind');
  });
  await t('buying twice, or double-clicking, charges only once', async () => {
    await setBal('d', 100000);
    const rs = await Promise.all([shop.buy('d', 'theme_amber'), shop.buy('d', 'theme_amber'), shop.buy('d', 'theme_amber')]);
    eq(rs.filter(r => r.ok).length, 1, 'one success'); eq(await getBalance('d'), 94000, 'charged once');
  });
  await t('not enough coins → refused, nothing taken, nothing granted', async () => {
    await setBal('p', 100);
    const r = await shop.buy('p', 'title_sov'); eq(r.ok, false, 'refused'); eq(await getBalance('p'), 100, 'balance');
    eq((await shop.ownedIds('p')).length, 0, 'nothing owned');
  });
  await t('owned colours / backgrounds unlock only for the buyer', async () => {
    await setBal('c', 100000); await shop.buy('c', 'bg_leaves'); await shop.buy('c', 'theme_plum');
    const owned = await shop.ownedIds('c');
    const bg = backgrounds.all().find(b => b.unlock && b.unlock.shop === 'bg_leaves');
    eq(backgrounds.isUnlocked(bg, { shopItems: owned }), true, 'owner'); eq(backgrounds.isUnlocked(bg, { shopItems: [] }), false, 'stranger');
    eq(owned.includes('theme_plum'), true, 'theme owned');
  });
  await t('menus render: home, shop page, confirm page', async () => {
    let h = await menu.home('b'); eq(h.components[0].components.length, 2, 'two buttons'); eq(h.components[0].components[1].data.disabled, false, 'seasonal enabled');
    const page = await menu.shopPage('b'); if (!page.embeds[0].data.fields.length) throw new Error('no items listed');
    const sel = page.components[0].components[0]; eq(sel.options.some(o => o.data.value === 'title_leaf'), false, 'owned item not offered again');
    const cf = menu.confirmPage('b', s.items[1], 8000); eq(cf.components[0].components[0].data.disabled, false, 'can buy');
  });
  await t('/buy button flow: pick → confirm → buy, through handle()', async () => {
    await setBal('f', 9000);
    const mk = (customId, values) => { const it = { customId, values, user: { id: 'f' }, edits: [], deferUpdate: async () => {}, editReply: async (o) => { it.edits.push(o); }, replied: false, deferred: true }; return it; };
    let it = mk('shop:ss:f'); eq(await menu.handle(it), true, 'handled');
    it = mk('shop:pick:f', ['title_moon']); await menu.handle(it);
    if (!/Harvest Moon/.test(JSON.stringify(it.edits[0].embeds[0].data))) throw new Error('confirm page missing');
    it = mk('shop:buy:f:title_moon'); await menu.handle(it);
    if (!/You bought/.test(it.edits[0].content)) throw new Error('not bought: ' + it.edits[0].content);
    eq(await getBalance('f'), 1000, 'paid 8000');
    const other = { customId: 'shop:buy:f:title_ember', user: { id: 'zzz' }, replies: [], reply: async (o) => { other.replies.push(o); } };
    await menu.handle(other); if (!/not your menu/.test(other.replies[0].content)) throw new Error('someone else could press it');
  });
  Date.now = realNow;
  await t('closes by itself: developer is told once (and DM fallback id is set)', async () => {
    const sent = []; const real = notify.notifyDeveloper; notify.notifyDeveloper = async (_c, text) => { sent.push(text); return true; };
    await shop.tick(null, START + 1000);                 // opened
    await shop.tick(null, END + 1000); await shop.tick(null, END + 2000); await shop.tick(null, END + 3000);
    notify.notifyDeveloper = real;
    eq(sent.length, 2, 'one "opened" + one "closed"'); if (!/closed by itself/.test(sent[1])) throw new Error(sent[1]);
    eq(settings.devUserId, '1498610562819690616', 'developer DM id');
  });
  await t('after closing the shop page says closed, owned things stay', async () => {
    const realD = Date.now; Date.now = () => END + 5000;
    const page = await menu.shopPage('b'); if (!/closed/i.test(page.content)) throw new Error('not closed: ' + page.content);
    eq((await shop.ownedIds('b')).includes('title_leaf'), true, 'still owned');
    const h = await menu.home('b'); eq(h.components[0].components[1].data.disabled, true, 'button disabled');
    Date.now = realD;
  });
  await t('the event is retired: /event is hidden, /buyrole is gone, /buy is registered', () => {
    eq(settings.events.current, null, 'no current event');
    commandHandler.loadCommands();
    const names = commandHandler.getCommands().map(c => c.name);
    eq(names.includes('event'), false, '/event hidden'); eq(names.includes('buyrole'), false, '/buyrole removed'); eq(names.includes('buy'), true, '/buy there');
  });
  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
