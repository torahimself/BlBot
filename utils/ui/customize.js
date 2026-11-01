'use strict';
// The "🎨 Customize" panel: a private message with a live preview of the member's own profile card and
// menus / buttons to change it. Every change is saved at once. Only the owner can use it.
//
// custom ids (all start with "ui:"):  ui:open:<id>  ui:th:<id>  ui:ac:<id>  ui:ch:<id>  ui:b:<action>:<id>
//                                      modals: ui:m:about:<id>  ui:m:color:<id>

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder,
} = require('discord.js');
const R = require('./render');
const themes = require('./themes');
const prefsStore = require('./prefs');
const profileCard = require('./profileCard');
const views = require('../economy/engine/views');
const backgrounds = require('./backgrounds');

const EPHEMERAL = 64;

// Avatars are downloaded once per URL for a few minutes, so every click does not wait on the network.
const avatarCache = new Map();
async function avatarFor(url) {
  const hit = avatarCache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.img;
  const img = await R.loadAvatar(url);
  avatarCache.set(url, { img, at: Date.now() });
  if (avatarCache.size > 60) avatarCache.delete(avatarCache.keys().next().value);
  return img;
}

function whoIs(interaction) {
  const u = interaction.user;
  const m = interaction.member && typeof interaction.member.displayName === 'string' ? interaction.member : null;
  const name = (m && m.displayName) || u.globalName || u.username;
  const face = (m && typeof m.displayAvatarURL === 'function' ? m : u);
  return { name, avatarUrl: typeof face.displayAvatarURL === 'function' ? face.displayAvatarURL({ size: 256 }) : null };
}

/** The panel message: preview picture + controls. */
async function panel(userId, interaction) {
  const [prefs, data] = await Promise.all([prefsStore.get(userId), views.profileData(userId)]);
  const who = whoIs(interaction);
  const png = await profileCard.render({ name: who.name, avatar: await avatarFor(who.avatarUrl), data, prefs });
  const m = profileCard.model(data, prefs);
  const theme = themes.themeOf(prefs.theme);

  const themeMenu = new StringSelectMenuBuilder().setCustomId(`ui:th:${userId}`).setPlaceholder(`Theme: ${theme.label}`)
    .addOptions(themes.THEMES.map(t => new StringSelectMenuOptionBuilder().setLabel(t.label).setValue(t.id).setEmoji(t.emoji).setDefault(t.id === prefs.theme)));

  const accentMenu = new StringSelectMenuBuilder().setCustomId(`ui:ac:${userId}`)
    .setPlaceholder(prefs.accent ? `Accent: ${(themes.ACCENTS.find(a => a.hex === prefs.accent) || { label: prefs.accent }).label}` : 'Accent colour: theme default')
    .addOptions([
      new StringSelectMenuOptionBuilder().setLabel('Theme default').setValue('theme').setEmoji('🎨').setDefault(!prefs.accent),
      ...themes.ACCENTS.map(a => new StringSelectMenuOptionBuilder().setLabel(a.label).setValue(a.id).setEmoji(a.emoji).setDefault(a.hex === prefs.accent)),
    ]);

  // Titles shown next to the name: pick up to 3 (none picked = the best three automatically).
  const mine = prefs.chips || [];
  const chipOpts = m.titles.slice(0, 25).map(t => new StringSelectMenuOptionBuilder().setLabel(t.name.slice(0, 100)).setDescription(t.sub.slice(0, 100)).setValue(t.id).setEmoji(t.emoji).setDefault(mine.includes(t.id)));
  const chipMenu = new StringSelectMenuBuilder().setCustomId(`ui:ch:${userId}`)
    .setPlaceholder(m.titles.length ? (mine.length ? `Titles by your name (${mine.length} chosen)` : 'Titles by your name: automatic (best 3)') : 'Titles by your name — earn a title first')
    .setMinValues(0).setMaxValues(Math.max(1, Math.min(3, chipOpts.length)));
  if (chipOpts.length) chipMenu.addOptions(chipOpts); else chipMenu.addOptions(new StringSelectMenuOptionBuilder().setLabel('No titles yet').setValue('none')).setDisabled(true);

  // Backgrounds: every one is listed; locked ones say what unlocks them (picking one just tells the member).
  const ctx = { bestStreak: (data.extra && data.extra.streak && data.extra.streak.best) || 0, level: (data.extra && data.extra.level && data.extra.level.level) || 0, titleIds: data.titles.map(t => t.titleId) };
  const bgOpts = [new StringSelectMenuOptionBuilder().setLabel('Theme default').setValue('theme').setEmoji('🎨').setDescription('The plain theme background').setDefault(!prefs.bg)];
  for (const b of backgrounds.all()) {
    const open = backgrounds.isUnlocked(b, ctx);
    bgOpts.push(new StringSelectMenuOptionBuilder().setLabel(b.label.slice(0, 100)).setValue(b.id).setEmoji(open ? b.emoji : '🔒')
      .setDescription((open ? (b.unlock ? 'Unlocked · ' : '') + backgrounds.describe(b) : 'Unlock: ' + backgrounds.describe(b)).slice(0, 100)).setDefault(b.id === prefs.bg));
  }
  const curBg = prefs.bg && backgrounds.byId(prefs.bg);
  const bgMenu = new StringSelectMenuBuilder().setCustomId(`ui:bg:${userId}`).setPlaceholder(`Background: ${curBg ? curBg.label : 'theme default'}`).addOptions(bgOpts);

  const shape = themes.byId(themes.SHAPES, prefs.shape), layout = themes.byId(themes.LAYOUTS, prefs.layout);
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ui:b:about:${userId}`).setLabel('About me').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ui:b:color:${userId}`).setLabel('Custom colour').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ui:b:shape:${userId}`).setLabel(`Avatar: ${shape.label}`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ui:b:layout:${userId}`).setLabel(`Layout: ${layout.label}`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ui:b:reset:${userId}`).setLabel('Reset').setEmoji('↩️').setStyle(ButtonStyle.Danger),
  );
  return {
    content: '🎨 **Customize your card** — changes save instantly and also style your **/inventory**. Run **/profile** to show it off.\n-# **Level** grows with everything you do: voice time, typing, games and active days. **Days active** = how many different days you have used the bot.',
    files: [new AttachmentBuilder(png, { name: 'preview.png' })],
    attachments: [],
    components: [new ActionRowBuilder().addComponents(bgMenu), new ActionRowBuilder().addComponents(themeMenu), new ActionRowBuilder().addComponents(accentMenu), new ActionRowBuilder().addComponents(chipMenu), buttons],
    allowedMentions: { parse: [] },
  };
}

const next = (list, id) => list[(list.findIndex(x => x.id === id) + 1) % list.length].id;

function aboutModal(userId, current) {
  return new ModalBuilder().setCustomId(`ui:m:about:${userId}`).setTitle('About me').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('text').setLabel('A short line for your card')
        .setStyle(TextInputStyle.Short).setMaxLength(60).setRequired(false).setValue(current || '').setPlaceholder('Up to 60 characters — leave empty to remove')
    )
  );
}
function colorModal(userId, current) {
  const input = new TextInputBuilder().setCustomId('hex').setLabel('Colour in hex, like #FF8A1F')
    .setStyle(TextInputStyle.Short).setMinLength(6).setMaxLength(7).setRequired(true).setPlaceholder('#FF8A1F');
  if (current && current.length >= 6) input.setValue(current);   // an empty/short prefill breaks min-length and Discord rejects the whole modal
  return new ModalBuilder().setCustomId(`ui:m:color:${userId}`).setTitle('Custom colour').addComponents(
    new ActionRowBuilder().addComponents(input)
  );
}

/** Handles every "ui:" interaction. Returns true when it was ours. Never throws. */
async function handle(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('ui:')) return false;
  const parts = id.split(':');
  const kind = parts[1];
  const ownerId = parts[parts.length - 1];
  const deny = () => interaction.reply({ content: '❌ This is not your card — use **/profile** and press Customize on your own.', flags: EPHEMERAL }).catch(() => {});
  try {
    if (interaction.user.id !== ownerId) { await deny(); return true; }
    if (!R.available()) { await interaction.reply({ content: '⚠️ Pictures are not available on this bot right now.', flags: EPHEMERAL }); return true; }

    // open the panel (button under /profile)
    if (kind === 'open') {
      await interaction.deferReply({ flags: EPHEMERAL });
      await interaction.editReply(await panel(ownerId, interaction));
      return true;
    }

    // modal forms
    if (interaction.isModalSubmit && interaction.isModalSubmit()) {
      if (kind === 'm' && parts[2] === 'about') {
        await prefsStore.set(ownerId, { about: interaction.fields.getTextInputValue('text') });
      } else if (kind === 'm' && parts[2] === 'color') {
        const hex = themes.parseHex(interaction.fields.getTextInputValue('hex'));
        if (!hex) { await interaction.reply({ content: '❌ Use a 6-digit hex colour like `#FF8A1F`.', flags: EPHEMERAL }); return true; }
        await prefsStore.set(ownerId, { accent: hex });
      }
      await interaction.deferUpdate();
      await interaction.editReply(await panel(ownerId, interaction));
      return true;
    }

    // buttons that open a form need an immediate response, so they come first
    if (kind === 'b' && (parts[2] === 'about' || parts[2] === 'color')) {
      const p = await prefsStore.get(ownerId);
      await interaction.showModal(parts[2] === 'about' ? aboutModal(ownerId, p.about) : colorModal(ownerId, p.accent || ''));
      return true;
    }

    await interaction.deferUpdate();
    let lockedNote = '';
    if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
      const v = interaction.values[0];
      if (kind === 'th') await prefsStore.set(ownerId, { theme: v });
      else if (kind === 'ac') await prefsStore.set(ownerId, { accent: v === 'theme' ? null : (themes.ACCENTS.find(a => a.id === v) || {}).hex });
      else if (kind === 'ch') await prefsStore.set(ownerId, { chips: interaction.values.filter(x => x !== 'none'), featured: null });
      else if (kind === 'bg') {
        if (v === 'theme') await prefsStore.set(ownerId, { bg: null });
        else {
          const b = backgrounds.byId(v);
          const data = await views.profileData(ownerId);
          const ctx = { bestStreak: (data.extra && data.extra.streak && data.extra.streak.best) || 0, level: (data.extra && data.extra.level && data.extra.level.level) || 0, titleIds: data.titles.map(t => t.titleId) };
          if (b && backgrounds.isUnlocked(b, ctx)) await prefsStore.set(ownerId, { bg: v });
          else lockedNote = `🔒 **${b ? b.label : 'That background'}** is locked — unlock it with: ${b ? backgrounds.describe(b) : '—'}.`;
        }
      }
    } else if (kind === 'b') {
      const p = await prefsStore.get(ownerId);
      if (parts[2] === 'shape') await prefsStore.set(ownerId, { shape: next(themes.SHAPES, p.shape) });
      else if (parts[2] === 'layout') await prefsStore.set(ownerId, { layout: next(themes.LAYOUTS, p.layout) });
      else if (parts[2] === 'reset') await prefsStore.reset(ownerId);
    }
    await interaction.editReply(await panel(ownerId, interaction));
    if (lockedNote) await interaction.followUp({ content: lockedNote, flags: EPHEMERAL }).catch(() => {});
    return true;
  } catch (err) {
    console.error('[UI] customize failed:', err);
    try {
      const msg = { content: '❌ Something went wrong — please try again.', flags: EPHEMERAL };
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg); else await interaction.reply(msg);
    } catch (_) { /* nothing more to do */ }
    return true;
  }
}

module.exports = { handle, panel, whoIs };
