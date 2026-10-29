'use strict';
// Entry point for the picture UI. Every function returns null (or throws nothing the caller can't handle)
// when pictures are unavailable, so the commands fall back to the classic embeds.

const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const R = require('./render');
const prefsStore = require('./prefs');
const profileCard = require('./profileCard');
const inventoryCard = require('./inventoryCard');

const OPEN_PREFIX = 'ui:open:';     // the "🎨 Customize" button under a profile (…:<ownerId>)

const available = () => R.available();

async function profileBuffer({ userId, name, avatarUrl, data, prefs }) {
  const avatar = await R.loadAvatar(avatarUrl);
  return profileCard.render({ name, avatar, data, prefs: prefs || await prefsStore.get(userId) });
}

/**
 * The /profile message as a picture, or null when pictures are unavailable (caller shows the embed).
 * A "Customize" button is added when the viewer looks at their own profile.
 */
async function profilePayload({ viewerId, userId, name, avatarUrl, data }) {
  if (!available()) return null;
  const png = await profileBuffer({ userId, name, avatarUrl, data });
  const payload = { content: null, embeds: [], files: [new AttachmentBuilder(png, { name: 'profile.png' })], components: [], allowedMentions: { parse: [] } };
  if (viewerId === userId) {
    payload.components = [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(OPEN_PREFIX + userId).setLabel('Customize').setEmoji('🎨').setStyle(ButtonStyle.Secondary)
    )];
  }
  return payload;
}

/** The inventory picture as an attachment, or null. `user` = { name, avatarUrl }. */
async function inventoryImage({ userId, user, state }) {
  if (!available()) return null;
  const [prefs, avatar] = await Promise.all([prefsStore.get(userId), R.loadAvatar(user.avatarUrl)]);
  const png = await inventoryCard.render({ name: user.name, avatar, state, prefs });
  return new AttachmentBuilder(png, { name: 'inventory.png' });
}

module.exports = { available, profileBuffer, profilePayload, inventoryImage, OPEN_PREFIX };
