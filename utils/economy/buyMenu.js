'use strict';
// /buy — one place for everything that costs coins:
//   🎭 Custom role  (instant, same flow as the old /buyrole)
//   🍂 Seasonal shop (time-limited; see seasonalShop.js)
// custom ids (all start with "shop:"):  shop:home|role|ss|pick|buy:<userId>[:<itemId>]

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const seasonal = require('./seasonalShop');
const shopManager = require('./shopManager');

const EPHEMERAL = 64;
const num = (n) => Number(n).toLocaleString('en-US');
const KIND = { title: '🏷️ Titles', theme: '🎨 Card colours', background: '🖼️ Card backgrounds' };

function roleModal() {
  return new ModalBuilder().setCustomId('buyRoleModal').setTitle('Create Custom Role').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roleName').setLabel('Role Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roleIcon').setLabel('Icon URL (optional)').setStyle(TextInputStyle.Short).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roleColor').setLabel('Color (hex code, e.g., #FF0000)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('#00FF00')),
  );
}

/** The /buy home screen. */
async function home(userId, now = Date.now()) {
  const s = seasonal.current();
  const ph = seasonal.phase(now, s);
  const bal = await shopManager.getBalance(userId);
  const lines = [
    `💰 Your coins: **${num(bal)}**`,
    '',
    `🎭 **Custom role** — **${num(shopManager.ROLE_PRICE)}** coins. Your own role, created instantly.`,
  ];
  let ssLabel = 'Seasonal shop', ssDisabled = true;
  if (s && ph === 'open') {
    const end = Math.floor(seasonal.windowOf(s).endAt / 1000);
    lines.push(`${s.emoji} **${s.name}** — limited titles, card colours and backgrounds. Closes <t:${end}:R>!`);
    ssLabel = `${s.name} (closes soon)`; ssDisabled = false;
  } else if (s && ph === 'upcoming') {
    lines.push(`${s.emoji} **${s.name}** opens <t:${Math.floor(seasonal.windowOf(s).startAt / 1000)}:R>.`);
    ssLabel = `${s.name} (opens soon)`;
  } else {
    lines.push('🍂 **Seasonal shop** — closed right now. The next one is coming!');
  }
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🛒 Shop').setDescription(lines.join('\n'));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`shop:role:${userId}`).setLabel('Buy a custom role').setEmoji('🎭').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`shop:ss:${userId}`).setLabel(ssLabel.slice(0, 80)).setEmoji(s ? s.emoji : '🍂').setStyle(ButtonStyle.Success).setDisabled(ssDisabled),
  );
  return { content: '', embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

/** The seasonal shop page. `note` = a line shown on top (e.g. "✅ bought …"). */
async function shopPage(userId, note = '', now = Date.now()) {
  const s = seasonal.current();
  if (!s || seasonal.phase(now, s) !== 'open') return { ...(await home(userId, now)), content: note || '🔒 The seasonal shop is closed.' };
  const owned = new Set(await seasonal.ownedIds(userId));
  const bal = await shopManager.getBalance(userId);
  const end = Math.floor(seasonal.windowOf(s).endAt / 1000);
  const embed = new EmbedBuilder().setColor(0xE67E22).setTitle(`${s.emoji} ${s.name}`)
    .setDescription(`💰 Your coins: **${num(bal)}** · closes <t:${end}:R>\nWhat you buy stays yours **forever**, even after the shop closes. Colours and backgrounds are picked in **/profile → Customize**; titles show next to your name.`);
  for (const kind of Object.keys(KIND)) {
    const items = s.items.filter(i => i.kind === kind);
    if (!items.length) continue;
    embed.addFields({ name: KIND[kind], value: items.map(i => `${owned.has(i.id) ? '✅' : i.emoji} **${i.name}** — ${owned.has(i.id) ? 'owned' : num(i.price) + ' coins'}\n-# ${i.blurb}`).join('\n').slice(0, 1024) });
  }
  const buyable = s.items.filter(i => !owned.has(i.id));
  const components = [];
  if (buyable.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`shop:pick:${userId}`).setPlaceholder('Choose an item to buy…')
        .addOptions(buyable.slice(0, 25).map(i => new StringSelectMenuOptionBuilder().setLabel(`${i.name} — ${num(i.price)}`.slice(0, 100)).setValue(i.id).setEmoji(i.emoji).setDescription(`${KIND[i.kind].replace(/^\S+\s/, '')}: ${i.blurb}`.slice(0, 100)))),
    ));
  } else embed.setFooter({ text: 'You own everything in this shop! 🎉' });
  components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`shop:home:${userId}`).setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary)));
  return { content: note, embeds: [embed], components, allowedMentions: { parse: [] } };
}

function confirmPage(userId, item, bal) {
  const can = bal >= item.price;
  const embed = new EmbedBuilder().setColor(can ? 0x57F287 : 0xED4245).setTitle(`${item.emoji} ${item.name}`)
    .setDescription(`${item.blurb}\n\n**Price:** ${num(item.price)} coins\n**Your coins:** ${num(bal)}${can ? '' : '\n\n❌ You do not have enough coins.'}`);
  return {
    content: '', embeds: [embed], allowedMentions: { parse: [] },
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shop:buy:${userId}:${item.id}`).setLabel(`Buy for ${num(item.price)}`).setStyle(ButtonStyle.Success).setDisabled(!can),
      new ButtonBuilder().setCustomId(`shop:ss:${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    )],
  };
}

const HOW_TO_USE = { title: 'It now shows next to your name — pick which titles to display in **/profile → Customize**.', theme: 'Equip it in **/profile → Customize → Theme**.', background: 'Equip it in **/profile → Customize → Background**.' };

/** Handles every "shop:" interaction. Returns true when it was ours. Never throws. */
async function handle(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('shop:')) return false;
  const [, action, ownerId, itemId] = id.split(':');
  try {
    if (interaction.user.id !== ownerId) { await interaction.reply({ content: '❌ This is not your menu — use **/buy**.', flags: EPHEMERAL }); return true; }
    if (action === 'role') { await interaction.showModal(roleModal()); return true; }      // a form must be the immediate response

    await interaction.deferUpdate();
    if (action === 'home') return void await interaction.editReply(await home(ownerId)), true;
    if (action === 'ss') return void await interaction.editReply(await shopPage(ownerId)), true;
    if (action === 'pick') {
      const s = seasonal.current();
      const item = s && s.items.find(i => i.id === interaction.values[0]);
      if (!item || seasonal.phase(Date.now(), s) !== 'open') return void await interaction.editReply(await shopPage(ownerId, '🔒 The seasonal shop is closed.')), true;
      await interaction.editReply(confirmPage(ownerId, item, await shopManager.getBalance(ownerId)));
      return true;
    }
    if (action === 'buy') {
      const r = await seasonal.buy(ownerId, itemId);
      const note = r.ok ? `✅ You bought **${r.item.emoji} ${r.item.name}**! ${HOW_TO_USE[r.item.kind]}` : r.error;
      await interaction.editReply(await shopPage(ownerId, note));
      return true;
    }
    return true;
  } catch (err) {
    console.error('[Shop] menu failed:', err);
    try {
      const msg = { content: '❌ Something went wrong — please try again.', flags: EPHEMERAL };
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg); else await interaction.reply(msg);
    } catch (_) { /* nothing more to do */ }
    return true;
  }
}

module.exports = { home, shopPage, confirmPage, handle };
