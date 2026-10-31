'use strict';
// Quiet block list (see /blocked-users.js in the project root). Read once at start-up, so a change needs a restart.
// No command, no database table, no message anywhere that mentions it — the only thing a blocked member
// ever sees is a short DM saying they have no access (at most once a day).

const notify = require('./economy/engine/notify.js');

let list = [];
try { list = require('../blocked-users.js'); } catch (_) { list = []; }
let ids = new Set((Array.isArray(list) ? list : []).map(String).filter(id => /^\d{5,25}$/.test(id)));

const isBlocked = (userId) => ids.has(String(userId));
const all = () => [...ids];
/** Tests only. */
const _set = (arr) => { ids = new Set(arr.map(String)); };

// Staff tools. A blocked member who is staff can still use these (their own permission checks still apply).
const STAFF_COMMANDS = new Set([
  'warn', 'jail', 'jailp', 'unjail', 'userhistory', 'jailhistory', 'givecoins', 'removecoins',
  'econdebug', 'debugroleexpiry', 'counter-status', 'statp', 'statsm', 'rotation-status',
]);
const STAFF_PREFIXES = ['warnhist_'];

const NOTICE = '🚫 You don\'t have access to this bot.\nليس لديك صلاحية استخدام هذا البوت.';
function notice(client, userId) {
  return notify.dm(client, userId, NOTICE, { cooldownKey: 'noaccess', cooldownMs: 24 * 60 * 60 * 1000 }).catch(() => false);
}

/** SQL fragment keeping blocked members out of a query: `AND userId NOT IN (...)` ('' when nobody is blocked). */
function sqlExclude(column = 'userId') {
  if (!ids.size) return '';
  return ` AND ${column} NOT IN (${[...ids].map(id => `'${id}'`).join(',')})`;
}

/**
 * Called first thing for every interaction. Returns true when the interaction was swallowed.
 *   • a blocked member: nothing visible happens (slash commands briefly show "thinking" and vanish)
 *   • anyone else targeting a blocked member with a command: a neutral "can't do that with this user"
 */
async function gateInteraction(interaction) {
  try {
    const uid = interaction.user && interaction.user.id;
    if (!uid || !ids.size) return false;

    const isCmd = interaction.isChatInputCommand && interaction.isChatInputCommand();
    const staffCmd = isCmd && STAFF_COMMANDS.has(interaction.commandName);
    const staffId = !isCmd && STAFF_PREFIXES.some(p => String(interaction.customId || '').startsWith(p));

    if (ids.has(uid)) {
      if (staffCmd || staffId) return false;
      notice(interaction.client, uid);
      if (isCmd) {
        await interaction.deferReply({ flags: 64 }).then(() => interaction.deleteReply()).catch(() => {});
      } else if (typeof interaction.respond === 'function') {
        await interaction.respond([]).catch(() => {});                       // autocomplete
      } else if (typeof interaction.deferUpdate === 'function') {
        await interaction.deferUpdate().catch(() => {});
      }
      return true;
    }

    if (isCmd && !staffCmd && interaction.options && interaction.options.data) {
      const hit = interaction.options.data.some(o => o.type === 6 && o.user && o.user.id !== uid && ids.has(o.user.id));
      if (hit) {
        await interaction.reply({ content: '❌ You can\'t do that with this user.', flags: 64 }).catch(() => {});
        return true;
      }
    }
  } catch (err) {
    console.error('[Access] gate failed:', err.message);
  }
  return false;
}

module.exports = { isBlocked, all, sqlExclude, gateInteraction, notice, STAFF_COMMANDS, _set };
