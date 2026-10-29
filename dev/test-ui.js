'use strict';
// Picture UI (/profile, /inventory, 🎨 Customize) — renders real PNGs, so the canvas module must be installed.
// Run: node dev/test-ui.js
process.env.BL_ECONOMY_DB = ':memory:';
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const db = require(path.join(root, 'utils/economy/database.js'));
const dbx = require(path.join(root, 'utils/economy/engine/dbx.js'));
const boosts = require(path.join(root, 'utils/economy/engine/boosts.js'));
const views = require(path.join(root, 'utils/economy/engine/views.js'));
const themes = require(path.join(root, 'utils/ui/themes.js'));
const prefs = require(path.join(root, 'utils/ui/prefs.js'));
const R = require(path.join(root, 'utils/ui/render.js'));
const profileCard = require(path.join(root, 'utils/ui/profileCard.js'));
const inventoryCard = require(path.join(root, 'utils/ui/inventoryCard.js'));
const ui = require(path.join(root, 'utils/ui/index.js'));
const customize = require(path.join(root, 'utils/ui/customize.js'));

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); } }
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const isPng = (b) => Buffer.isBuffer(b) && b.subarray(0, 4).equals(PNG) && b.length > 2000;
const dims = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

const DATA = { balance: 1234567, chars: 183450, voiceMinutes: 5230, titles: [
  { titleId: 'ms_voice_1', earnedAt: 1 }, { titleId: 'ms_voice_2', earnedAt: 2 }, { titleId: 'ms_text_1', earnedAt: 3 },
  { titleId: 'event_halloween2026_bronze', earnedAt: 1.7e12 }] };

(async () => {
  await db.ready;
  if (!R.available()) { console.log('⚠️  @napi-rs/canvas is not installed — skipping the picture tests'); process.exit(0); }

  console.log('Themes and preferences');
  await t('hex colours: with / without #, any case; junk is refused', () => {
    assert.strictEqual(themes.parseHex('FF8A1F'), '#ff8a1f'); assert.strictEqual(themes.parseHex(' #ff8a1f '), '#ff8a1f');
    for (const x of ['', 'red', '#fff', '#gggggg', '12345', '#1234567', null, undefined]) assert.strictEqual(themes.parseHex(x), null, String(x));
  });
  await t('about-me: one short line, no links, mentions, @everyone or control characters', () => {
    assert.strictEqual(themes.cleanAbout('hello  world'), 'hello world');
    assert(!/http|discord\.gg|www\./i.test(themes.cleanAbout('see https://evil.example and discord.gg/abc and www.x.com ok')));
    assert(!/<@|@everyone|@here/.test(themes.cleanAbout('hi <@123> @everyone @here')));
    assert.strictEqual(themes.cleanAbout('a\nb\tc‮'), 'a b c');
    assert.strictEqual(themes.cleanAbout('x'.repeat(200)).length, 60);
    assert.strictEqual(themes.cleanAbout(null), '');
  });
  await t('every theme has what the renderer needs (two background colours, a pattern, an accent)', () => {
    assert(themes.THEMES.length >= 6);
    for (const th of themes.THEMES) { assert(th.id && th.label && th.emoji && th.bg.length === 2 && th.pattern && themes.parseHex(th.accent), th.id); }
    assert.strictEqual(new Set(themes.THEMES.map(x => x.id)).size, themes.THEMES.length, 'unique ids');
  });
  await t('defaults for a new member; unknown values in the database fall back safely', async () => {
    const p = await prefs.get('NEW');
    assert.deepStrictEqual(p, { theme: 'midnight', accent: null, shape: 'circle', layout: 'full', featured: null, about: '' });
    await dbx.run("INSERT INTO ui_prefs (userId, theme, accent, shape, layout, featured, about) VALUES ('BAD', 'nope', 'zzz', 'blob', 'huge', NULL, NULL)");
    assert.deepStrictEqual(await prefs.get('BAD'), p);
  });
  await t('choices are saved, validated, and survive reading again; reset restores the defaults', async () => {
    let p = await prefs.set('U1', { theme: 'pumpkin', accent: '#FF8A1F', shape: 'hex', layout: 'compact', featured: 'ms_voice_2', about: 'مرحبا  بكم' });
    assert.deepStrictEqual(p, { theme: 'pumpkin', accent: '#ff8a1f', shape: 'hex', layout: 'compact', featured: 'ms_voice_2', about: 'مرحبا بكم' });
    assert.deepStrictEqual(await prefs.get('U1'), p);
    p = await prefs.set('U1', { theme: 'not-a-theme', shape: 'x', accent: 'purple' });
    assert.strictEqual(p.theme, 'pumpkin'); assert.strictEqual(p.shape, 'hex'); assert.strictEqual(p.accent, '#ff8a1f', 'invalid values change nothing');
    p = await prefs.set('U1', { accent: null, featured: null }); assert.strictEqual(p.accent, null); assert.strictEqual(p.featured, null);
    assert.deepStrictEqual(await prefs.reset('U1'), themes.DEFAULTS); assert.deepStrictEqual(await prefs.get('U1'), themes.DEFAULTS);
  });
  await t('one member\'s choices never touch another\'s', async () => {
    await prefs.set('X', { theme: 'ocean' }); await prefs.set('Y', { theme: 'rose' });
    assert.strictEqual((await prefs.get('X')).theme, 'ocean'); assert.strictEqual((await prefs.get('Y')).theme, 'rose');
  });

  console.log('Profile picture');
  await t('model: highest milestone title is featured by default (event titles first); a chosen title wins; an unknown choice is ignored', () => {
    const m = profileCard.model(DATA, themes.DEFAULTS);
    assert.strictEqual(m.titles.length, 4); assert.strictEqual(m.featured.name, 'Pumpkin Warden', 'event title ranks first');
    assert.strictEqual(profileCard.model(DATA, { ...themes.DEFAULTS, featured: 'ms_voice_1' }).featured.id, 'ms_voice_1');
    assert.strictEqual(profileCard.model(DATA, { ...themes.DEFAULTS, featured: 'ms_text_9' }).featured.name, 'Pumpkin Warden');
    assert.strictEqual(profileCard.model({ ...DATA, titles: [] }, themes.DEFAULTS).featured, null);
    const v = m.tracks.find(x => x.key === 'voice'); assert(v.done >= 2 && v.next && v.frac >= 0 && v.frac <= 1);
  });
  await t('renders a PNG for every theme × layout × avatar shape (with and without titles)', async () => {
    for (const th of themes.THEMES) for (const layout of ['full', 'compact']) for (const shape of ['circle', 'rounded', 'hex']) {
      const png = await profileCard.render({ name: 'Tora', avatar: null, data: DATA, prefs: { ...themes.DEFAULTS, theme: th.id, layout, shape } });
      assert(isPng(png), `${th.id}/${layout}/${shape}`);
    }
    assert(isPng(await profileCard.render({ name: 'New', avatar: null, data: { balance: 0, chars: 0, voiceMinutes: 0, titles: [] }, prefs: themes.DEFAULTS })));
  });
  await t('Arabic, very long, emoji and odd names and about-me lines never break the drawing', async () => {
    for (const name of ['تورا الأسطورة', 'x'.repeat(120), '😀 Tora 🎃', '٣٢١ مرحبا hello', 'ـ', '', 'a b c d e f g h i j k l m n o p q r s t u v w x y z']) {
      const png = await profileCard.render({ name, avatar: null, data: DATA, prefs: { ...themes.DEFAULTS, about: 'أحب الصباح والقهوة ☕ and also a very long sentence that has to wrap to the next line' } });
      assert(isPng(png), name);
    }
  });
  await t('the picture grows with the content: many titles stay inside (two rows + «+N more»), compact is shorter than full', async () => {
    const many = { ...DATA, titles: [...DATA.titles, ...Array.from({ length: 10 }, (_, i) => ({ titleId: `ms_text_${i + 1}`, earnedAt: 10 + i })), ...Array.from({ length: 10 }, (_, i) => ({ titleId: `ms_voice_${i + 1}`, earnedAt: 30 + i }))] };
    const full = dims(await profileCard.render({ name: 'A', avatar: null, data: many, prefs: themes.DEFAULTS }));
    const comp = dims(await profileCard.render({ name: 'A', avatar: null, data: many, prefs: { ...themes.DEFAULTS, layout: 'compact' } }));
    const none = dims(await profileCard.render({ name: 'A', avatar: null, data: { ...DATA, titles: [] }, prefs: themes.DEFAULTS }));
    assert.strictEqual(full.w, 1000); assert(comp.h < full.h, 'compact is shorter'); assert(full.h < 1000, 'bounded height: ' + full.h); assert(none.h <= full.h);
  });
  await t('emoji typed in a name are left out (the font has none) instead of drawing empty boxes', () => {
    assert.strictEqual(R.plain('😀 Tora 🎃'), 'Tora'); assert.strictEqual(R.plain('مرحبا ☕'), 'مرحبا'); assert.strictEqual(R.plain('a  b'), 'a b');
  });
  await t('/profile payload: a picture; the 🎨 Customize button only on your OWN profile', async () => {
    const own = await ui.profilePayload({ viewerId: 'U9', userId: 'U9', name: 'Me', avatarUrl: null, data: DATA });
    assert(own.files.length === 1 && own.files[0].name === 'profile.png' && own.embeds.length === 0);
    assert.strictEqual(own.components.length, 1); assert.strictEqual(own.components[0].components[0].data.custom_id, 'ui:open:U9');
    const other = await ui.profilePayload({ viewerId: 'U9', userId: 'U8', name: 'Them', avatarUrl: null, data: DATA });
    assert.strictEqual(other.components.length, 0, 'no customize button on someone else\'s card');
  });
  await t('avatar download: a slow or broken download falls back to the initial (never blocks, never throws)', async () => {
    assert.strictEqual(await R.loadAvatar('https://cdn.example/a.png', async () => { throw new Error('down'); }), null);
    assert.strictEqual(await R.loadAvatar('https://cdn.example/a.png', async () => ({ ok: false })), null);
    assert.strictEqual(await R.loadAvatar('https://cdn.example/a.png', async () => ({ ok: true, arrayBuffer: async () => Buffer.from('not an image') })), null);
    assert.strictEqual(await R.loadAvatar(null), null);
    const t0 = Date.now(); const r = await R.loadAvatar('https://cdn.example/a.png', (u, { signal }) => new Promise((res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))))); 
    assert.strictEqual(r, null); assert(Date.now() - t0 < 6000, 'timed out');
  });

  console.log('Inventory picture');
  await t('/inventory: a picture with the activate menu kept as a real menu; none without potions', async () => {
    const user = { name: 'تورا', avatarUrl: null };
    let p = await views.inventoryPayload('INV1', { user });
    assert(p.files.length === 1 && p.files[0].name === 'inventory.png' && p.embeds.length === 0); assert.strictEqual(p.components.length, 0, 'no potions → no menu');
    await boosts.grantPotion('INV1', 'text', 4, 'test'); await boosts.grantPotion('INV1', 'voice', 5, 'test');
    p = await views.inventoryPayload('INV1', { user });
    assert.strictEqual(p.components.length, 1); assert.strictEqual(p.components[0].components[0].data.custom_id, 'inv_use_INV1');
    assert.strictEqual(p.components[0].components[0].options.length, 2);
  });
  await t('without a user the classic embed is still produced (fallback)', async () => {
    const p = await views.inventoryPayload('INV1');
    assert.strictEqual(p.embeds.length, 1); assert(!p.files || p.files.length === 0);
  });
  await t('inventory card: running boost shows a countdown; every theme renders; money formatting is safe for huge numbers', async () => {
    const st = await views.inventoryState('INV1');
    const now = Date.now();
    const run = { ...st, balance: 987654321, active: [{ type: 'text', multiplier: 2, startedAt: now - 3600e3, expiresAt: now + 2 * 3600e3 }], now };
    const m = inventoryCard.model(run);
    assert.strictEqual(m.potionRows[0].run.leftText, '2h 0m'); assert(m.potionRows[0].run.left / m.potionRows[0].run.total > 0.6);
    assert.strictEqual(m.potionRows[1].run, null);
    for (const th of themes.THEMES) assert(isPng(await inventoryCard.render({ name: 'A', avatar: null, state: run, prefs: { ...themes.DEFAULTS, theme: th.id, shape: 'hex' } })), th.id);
    assert.deepStrictEqual(dims(await inventoryCard.render({ name: 'A', avatar: null, state: run, prefs: themes.DEFAULTS })), { w: inventoryCard.W, h: inventoryCard.H });
  });
  await t('a member\'s theme applies to BOTH cards', async () => {
    await prefs.set('BOTH', { theme: 'snow', accent: '#ff5c93' });
    const a = await ui.inventoryImage({ userId: 'BOTH', user: { name: 'B', avatarUrl: null }, state: await views.inventoryState('BOTH') });
    const b = await ui.inventoryImage({ userId: 'NEWBIE', user: { name: 'B', avatarUrl: null }, state: await views.inventoryState('NEWBIE') });
    assert(a.attachment.length !== b.attachment.length || !a.attachment.equals(b.attachment), 'different look');
  });

  console.log('Customize panel');
  const mkInteraction = (userId, customId, extra = {}) => {
    const calls = [];
    const it = {
      customId, user: { id: userId, username: 'u' + userId, globalName: 'Name ' + userId, displayAvatarURL: () => null }, member: null, calls,
      deferred: false, replied: false,
      isModalSubmit: () => !!extra.fields, isStringSelectMenu: () => !!extra.values, isMessageComponent: () => !extra.fields,
      values: extra.values, fields: extra.fields && { getTextInputValue: (k) => extra.fields[k] },
      reply: async (x) => { calls.push(['reply', x]); it.replied = true; },
      deferReply: async (x) => { calls.push(['deferReply', x]); it.deferred = true; },
      deferUpdate: async () => { calls.push(['deferUpdate']); it.deferred = true; },
      editReply: async (x) => { calls.push(['editReply', x]); },
      followUp: async (x) => { calls.push(['followUp', x]); },
      showModal: async (m) => { calls.push(['showModal', m]); },
    };
    return it;
  };
  const last = (it, kind) => [...it.calls].reverse().find(c => c[0] === kind);

  await t('🎨 button opens a private panel: preview picture + theme / accent / title menus + buttons', async () => {
    const it = mkInteraction('C1', 'ui:open:C1');
    assert.strictEqual(await customize.handle(it), true);
    assert.strictEqual(it.calls[0][0], 'deferReply'); assert.strictEqual(it.calls[0][1].flags, 64, 'private');
    const out = last(it, 'editReply')[1];
    assert(out.files[0].name === 'preview.png'); assert.strictEqual(out.components.length, 4);
    const ids = out.components.flatMap(r => r.components.map(c => c.data.custom_id));
    for (const k of ['ui:th:C1', 'ui:ac:C1', 'ui:ft:C1', 'ui:b:about:C1', 'ui:b:color:C1', 'ui:b:shape:C1', 'ui:b:layout:C1', 'ui:b:reset:C1']) assert(ids.includes(k), k);
    assert(out.components[0].components[0].options.length === themes.THEMES.length);
  });
  await t('only the owner can use a panel: anyone else gets a private refusal and nothing changes', async () => {
    await prefs.set('OWN', { theme: 'ocean' });
    for (const id of ['ui:open:OWN', 'ui:th:OWN', 'ui:b:reset:OWN', 'ui:b:about:OWN']) {
      const it = mkInteraction('INTRUDER', id, id === 'ui:th:OWN' ? { values: ['rose'] } : {});
      assert.strictEqual(await customize.handle(it), true);
      assert.strictEqual(it.calls[0][0], 'reply'); assert.strictEqual(it.calls[0][1].flags, 64); assert(/not your card/.test(it.calls[0][1].content));
    }
    assert.strictEqual((await prefs.get('OWN')).theme, 'ocean');
  });
  await t('theme, accent and title menus save at once and redraw the preview', async () => {
    let it = mkInteraction('C2', 'ui:th:C2', { values: ['pumpkin'] }); await customize.handle(it);
    assert.strictEqual((await prefs.get('C2')).theme, 'pumpkin'); assert(last(it, 'editReply')[1].files[0].name === 'preview.png');
    it = mkInteraction('C2', 'ui:ac:C2', { values: ['pink'] }); await customize.handle(it); assert.strictEqual((await prefs.get('C2')).accent, '#ff5c93');
    it = mkInteraction('C2', 'ui:ac:C2', { values: ['theme'] }); await customize.handle(it); assert.strictEqual((await prefs.get('C2')).accent, null);
    it = mkInteraction('C2', 'ui:ft:C2', { values: ['ms_voice_1'] }); await customize.handle(it); assert.strictEqual((await prefs.get('C2')).featured, 'ms_voice_1');
    it = mkInteraction('C2', 'ui:ft:C2', { values: ['auto'] }); await customize.handle(it); assert.strictEqual((await prefs.get('C2')).featured, null);
  });
  await t('avatar shape and layout buttons cycle through every option; reset restores the defaults', async () => {
    const seen = new Set();
    for (let i = 0; i < 3; i++) { await customize.handle(mkInteraction('C3', 'ui:b:shape:C3')); seen.add((await prefs.get('C3')).shape); }
    assert.deepStrictEqual([...seen].sort(), ['circle', 'hex', 'rounded']); assert.strictEqual((await prefs.get('C3')).shape, 'circle', 'full cycle');
    await customize.handle(mkInteraction('C3', 'ui:b:layout:C3')); assert.strictEqual((await prefs.get('C3')).layout, 'compact');
    await customize.handle(mkInteraction('C3', 'ui:b:layout:C3')); assert.strictEqual((await prefs.get('C3')).layout, 'full');
    await prefs.set('C3', { theme: 'forest', about: 'x' }); await customize.handle(mkInteraction('C3', 'ui:b:reset:C3'));
    assert.deepStrictEqual(await prefs.get('C3'), themes.DEFAULTS);
  });
  await t('«About me» and «Custom colour» open forms; a valid submit saves, junk is refused with a private message', async () => {
    let it = mkInteraction('C4', 'ui:b:about:C4'); await customize.handle(it); assert.strictEqual(it.calls[0][0], 'showModal');
    it = mkInteraction('C4', 'ui:b:color:C4'); await customize.handle(it); assert.strictEqual(it.calls[0][0], 'showModal');
    it = mkInteraction('C4', 'ui:m:about:C4', { fields: { text: 'أحب القهوة https://x.example <@123>' } }); await customize.handle(it);
    assert.strictEqual((await prefs.get('C4')).about, 'أحب القهوة'); assert(last(it, 'editReply'));
    it = mkInteraction('C4', 'ui:m:color:C4', { fields: { hex: '#12ab9C' } }); await customize.handle(it); assert.strictEqual((await prefs.get('C4')).accent, '#12ab9c');
    it = mkInteraction('C4', 'ui:m:color:C4', { fields: { hex: 'banana' } }); await customize.handle(it);
    assert(/hex colour/.test(it.calls[0][1].content)); assert.strictEqual((await prefs.get('C4')).accent, '#12ab9c', 'unchanged');
    it = mkInteraction('C4', 'ui:m:about:C4', { fields: { text: '' } }); await customize.handle(it); assert.strictEqual((await prefs.get('C4')).about, '', 'empty removes it');
  });
  await t('a failure inside the panel is answered politely and never thrown', async () => {
    const it = mkInteraction('C5', 'ui:th:C5', { values: ['midnight'] });
    it.editReply = async () => { throw new Error('discord is down'); };
    const origErr = console.error; console.error = () => {};
    try { assert.strictEqual(await customize.handle(it), true); } finally { console.error = origErr; }
    assert(last(it, 'followUp') && /try again/.test(last(it, 'followUp')[1].content));
  });
  await t('ids that are not ours are left alone', async () => { assert.strictEqual(await customize.handle(mkInteraction('C6', 'pg:abc:join')), false); });

  console.log('Without the canvas module');
  await t('pictures switch off cleanly: the commands fall back to the classic embeds', async () => {
    for (const k of Object.keys(require.cache)) if (k.includes(path.join('utils', 'ui')) || k.endsWith(path.join('engine', 'views.js'))) delete require.cache[k];
    process.env.BL_UI_FORCE_NONE = '1';
    const ui2 = require(path.join(root, 'utils/ui/index.js')); const views2 = require(path.join(root, 'utils/economy/engine/views.js'));
    assert.strictEqual(ui2.available(), false);
    assert.strictEqual(await ui2.profilePayload({ viewerId: 'a', userId: 'a', name: 'n', avatarUrl: null, data: DATA }), null);
    const p = await views2.inventoryPayload('INV1', { user: { name: 'x', avatarUrl: null } });
    assert.strictEqual(p.embeds.length, 1); assert(!p.files || !p.files.length);
    const c2 = require(path.join(root, 'utils/ui/customize.js'));
    const it = mkInteraction('Z', 'ui:open:Z'); await c2.handle(it); assert(/not available/.test(it.calls[0][1].content));
    delete process.env.BL_UI_FORCE_NONE;
  });

  console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
