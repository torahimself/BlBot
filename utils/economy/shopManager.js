const db = require('./database.js');

const ROLE_PRICE = 100000;        // changed from 60000
const ADD_MEMBER_PRICE = 1000;

const ROLE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;         // 30 days
const EXPIRATION_WARNING_MS = 24 * 60 * 60 * 1000;          // warn 24h before expiry

function getBalance(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT balance FROM users WHERE userId = ?', [userId], (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.balance : 0);
    });
  });
}

function updateBalance(userId, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO users (userId, balance)
       VALUES (?, ?)
       ON CONFLICT(userId) DO UPDATE SET
       balance = balance + ?`,
      [userId, amount, amount],
      (err) => { if (err) reject(err); else resolve(); }
    );
  });
}

// Atomically takes `amount` coins from a user — but ONLY if they can afford
// it right now. Resolves true on success, false if the balance was too low.
// This is a single SQL statement, so two commands fired at the same instant
// can never both spend the same coins (the old "check balance, then deduct"
// pattern could, and left balances negative).
function spendCoins(userId, amount) {
  return new Promise((resolve, reject) => {
    if (!Number.isInteger(amount) || amount < 0) return resolve(false);
    if (amount === 0) return resolve(true);
    db.run(
      'UPDATE users SET balance = balance - ? WHERE userId = ? AND balance >= ?',
      [amount, userId, amount],
      function (err) { if (err) reject(err); else resolve(this.changes > 0); }
    );
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
  });
}

async function purchaseRole(interaction) {
  const userId = interaction.user.id;
  const balance = await getBalance(userId);
  if (balance < ROLE_PRICE) {
    return { success: false, message: `You need ${ROLE_PRICE} coins. You have ${balance}.` };
  }
  return { success: true, requiresModal: true };
}

async function createCustomRole(interaction, name, iconAttachment, colorHex, isAdmin = false) {
  const userId = interaction.user.id;
  const guild = interaction.guild;
  if (!guild) return { success: false, message: 'Guild not found' };

  if (!isAdmin) {
    const paid = await spendCoins(userId, ROLE_PRICE);
    if (!paid) {
      const balance = await getBalance(userId);
      return { success: false, message: `You need ${ROLE_PRICE} coins. You have ${balance}.` };
    }
  }

  let roleColor = 0x00ff00;
  if (colorHex) {
    const hexRegex = /^#([0-9A-Fa-f]{6})$/;
    if (hexRegex.test(colorHex)) {
      roleColor = parseInt(colorHex.replace('#', ''), 16);
    }
  }

  let role;
  try {
    role = await guild.roles.create({
      name: name,
      color: roleColor,
      icon: iconAttachment ? iconAttachment.url : null,
      reason: `Custom role purchased by ${interaction.user.tag}`
    });
  } catch (error) {
    console.error('Role creation error:', error);
    if (!isAdmin) await updateBalance(userId, ROLE_PRICE);
    return { success: false, message: 'Failed to create role. Coins refunded.' };
  }

  const targetRoleId = '1446128863200542933';
  const targetRole = guild.roles.cache.get(targetRoleId);
  if (targetRole) {
    try { await role.setPosition(targetRole.position + 1); } catch (err) { console.warn('Could not set role position:', err.message); }
  } else {
    try { await role.setPosition(2); } catch (err) { console.warn('Could not set role position:', err.message); }
  }

  const now = Date.now();
  const expiration = now + ROLE_DURATION_MS;

  // The insert is awaited so a database failure really does stop here. (It
  // used to be fire-and-forget: the "Database error" return inside the
  // callback never reached the caller, so a failed insert still reported
  // success while the role was deleted and the coins refunded.)
  try {
    await dbRun(
      'INSERT INTO purchased_roles (roleId, ownerId, purchaseDate, expirationDate) VALUES (?, ?, ?, ?)',
      [role.id, userId, now, expiration]
    );
  } catch (err) {
    console.error('Role DB insert error:', err);
    await role.delete().catch(console.error);
    if (!isAdmin) await updateBalance(userId, ROLE_PRICE);
    return { success: false, message: 'Database error. Coins refunded.' };
  }

  try {
    await interaction.member.roles.add(role);
  } catch (err) {
    console.error('Could not give the new role to its buyer:', err);
    await dbRun('DELETE FROM purchased_roles WHERE roleId = ?', [role.id]).catch(console.error);
    await role.delete().catch(console.error);
    if (!isAdmin) await updateBalance(userId, ROLE_PRICE);
    return { success: false, message: 'Could not assign the role to you. Coins refunded.' };
  }

  await dbRun('INSERT INTO role_members (roleId, userId, addedBy, addedDate) VALUES (?, ?, ?, ?)',
    [role.id, userId, userId, now]).catch(console.error);

  return { success: true, role: role, message: `Role ${role.name} created!` };
}

async function addMemberToRole(interaction, roleId, targetUser) {
  const ownerId = interaction.user.id;
  const roleData = await getRoleOwner(roleId);
  if (!roleData || roleData.ownerId !== ownerId) {
    return { success: false, message: 'You do not own this role.' };
  }

  const role = interaction.guild.roles.cache.get(roleId);
  if (!role) return { success: false, message: 'Role not found. It may have been deleted.' };

  let targetMember;
  try {
    targetMember = await interaction.guild.members.fetch(targetUser.id);
  } catch (error) {
    return { success: false, message: 'User not found in this server.' };
  }

  const memberCount = await getRoleMemberCount(roleId);
  if (memberCount >= 11) {
    return { success: false, message: 'Role already has maximum 10 members (excluding owner).' };
  }

  if (targetMember.roles.cache.has(roleId)) {
    return { success: false, message: 'User already has this role.' };
  }

  const paid = await spendCoins(ownerId, ADD_MEMBER_PRICE);
  if (!paid) {
    return { success: false, message: `You need ${ADD_MEMBER_PRICE} coins to add a member.` };
  }

  try {
    await targetMember.roles.add(role);
  } catch (err) {
    // Typically a role-hierarchy / permissions problem. Don't keep the coins.
    console.error('addMemberToRole: roles.add failed:', err.message);
    await updateBalance(ownerId, ADD_MEMBER_PRICE);
    return { success: false, message: 'Could not add that user to the role (check my role permissions). You were not charged.' };
  }

  await dbRun('INSERT INTO role_members (roleId, userId, addedBy, addedDate) VALUES (?, ?, ?, ?)',
    [roleId, targetUser.id, ownerId, Date.now()]).catch(console.error);

  return { success: true, message: `Added ${targetUser.tag} to role.` };
}

async function removeMemberFromRole(interaction, roleId, targetUser) {
  const ownerId = interaction.user.id;
  const roleData = await getRoleOwner(roleId);
  if (!roleData || roleData.ownerId !== ownerId) {
    return { success: false, message: 'You do not own this role.' };
  }

  if (targetUser.id === ownerId) {
    return { success: false, message: 'You cannot remove yourself from your own role.' };
  }

  const role = interaction.guild.roles.cache.get(roleId);
  if (!role) return { success: false, message: 'Role not found. It may have been deleted.' };

  let targetMember;
  try {
    targetMember = await interaction.guild.members.fetch(targetUser.id);
  } catch (error) {
    return { success: false, message: 'User not found in this server.' };
  }

  if (!targetMember.roles.cache.has(roleId)) {
    return { success: false, message: 'User does not have this role.' };
  }

  await targetMember.roles.remove(role);
  db.run('DELETE FROM role_members WHERE roleId = ? AND userId = ?', [roleId, targetUser.id]);

  return { success: true, message: `Removed ${targetUser.tag} from role.` };
}

async function editRole(interaction, roleId, newName, newIconAttachment, newColorHex) {
  const ownerId = interaction.user.id;
  const roleData = await getRoleOwner(roleId);
  if (!roleData || roleData.ownerId !== ownerId) {
    return { success: false, message: 'You do not own this role.' };
  }

  const role = interaction.guild.roles.cache.get(roleId);
  if (!role) return { success: false, message: 'Role not found.' };

  try {
    if (newName) await role.setName(newName);
    if (newIconAttachment) await role.setIcon(newIconAttachment.url);
    if (newColorHex) {
      const hexRegex = /^#([0-9A-Fa-f]{6})$/;
      if (!hexRegex.test(newColorHex)) {
        return { success: false, message: 'Invalid color format. Use #RRGGBB.' };
      }
      await role.setColor(parseInt(newColorHex.replace('#', ''), 16));
    }
    return { success: true, message: 'Role updated.' };
  } catch (error) {
    return { success: false, message: 'Failed to update role.' };
  }
}

async function extendRole(roleId, ownerId) {
  const paid = await spendCoins(ownerId, ROLE_PRICE);
  if (!paid) {
    return { success: false, message: `You need ${ROLE_PRICE} coins to extend.` };
  }
  const newExpiration = Date.now() + ROLE_DURATION_MS;
  try {
    // expiryWarned goes back to 0 so the owner gets a fresh warning before the NEXT expiry.
    // Only extend while the role is still inside the 24h window. Two /extendrole
    // commands fired together both pass the command's own checks; the second
    // one finds the role already extended here (changes === 0) and is refunded.
    const res = await dbRun('UPDATE purchased_roles SET expirationDate = ?, extendedCount = extendedCount + 1, expiryWarned = 0 WHERE roleId = ? AND expirationDate <= ?',
      [newExpiration, roleId, Date.now() + EXPIRATION_WARNING_MS]);
    if (res.changes === 0) {
      await updateBalance(ownerId, ROLE_PRICE);
      return { success: false, message: 'Your role was just extended already. You were not charged again.' };
    }
  } catch (err) {
    console.error('extendRole DB update failed:', err);
    await updateBalance(ownerId, ROLE_PRICE);
    return { success: false, message: 'Database error. You were not charged.' };
  }
  return { success: true, message: `Role extended for 30 days.` };
}

function getRoleOwner(roleId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT ownerId FROM purchased_roles WHERE roleId = ?', [roleId], (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
}

function getActiveRoleForOwner(ownerId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT roleId, expirationDate FROM purchased_roles WHERE ownerId = ?', [ownerId], (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
}

function getRoleMemberCount(roleId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) as count FROM role_members WHERE roleId = ?', [roleId], (err, row) => {
      if (err) reject(err); else resolve(row.count);
    });
  });
}

async function checkExpiredRoles(client, logChannelId) {
  const now = Date.now();
  db.all('SELECT roleId, ownerId, expirationDate, expiryWarned FROM purchased_roles', async (err, rows) => {
    if (err) return console.error(err);
    for (const row of rows) {
      const timeLeft = row.expirationDate - now;
      if (timeLeft <= 0) {
        let role = null;
        for (const guild of client.guilds.cache.values()) {
          role = guild.roles.cache.get(row.roleId);
          if (role) break;
        }
        if (role) {
          await role.delete().catch(console.error);
          const owner = await client.users.fetch(row.ownerId).catch(() => null);
          if (owner) owner.send(`Your custom role **${role.name}** has expired and been deleted.`).catch(console.error);
        }
        db.run('DELETE FROM purchased_roles WHERE roleId = ?', [row.roleId]);
        db.run('DELETE FROM role_members WHERE roleId = ?', [row.roleId]);
        if (logChannelId) {
          const logChannel = client.channels.cache.get(logChannelId);
          if (logChannel) logChannel.send(`Expired role <@&${row.roleId}> owned by <@${row.ownerId}> has been deleted.`);
        }
        console.log(`🗑️ Expired role ${row.roleId} deleted.`);
      } else if (timeLeft <= EXPIRATION_WARNING_MS && timeLeft > 0 && !row.expiryWarned) {
        // Mark as warned first so this check (every 6h, and on every
        // restart) sends the warning ONCE per expiry window instead of
        // DMing the owner again and again.
        db.run('UPDATE purchased_roles SET expiryWarned = 1 WHERE roleId = ?', [row.roleId]);
        const owner = await client.users.fetch(row.ownerId).catch(() => null);
        if (owner) {
          // NOTE: buttons sent via DM are unreliable — Discord doesn't
          // consistently deliver DM component interactions to bots unless
          // the app is specifically configured for DM contexts. Using a
          // plain-text pointer to an in-server command instead, which always
          // works regardless of DM interaction settings.
          owner.send({
            content: `⚠️ Your role <@&${row.roleId}> expires in less than 24 hours.\n\nTo extend it for another 30 days (**${ROLE_PRICE}** coins), run \`/extendrole\` in <#1464140979148689550>.`,
          }).catch(console.error);
        }
      }
    }
  });
}

module.exports = {
  purchaseRole, createCustomRole,
  getBalance, updateBalance, spendCoins,
  addMemberToRole, removeMemberFromRole,
  editRole, extendRole, checkExpiredRoles, getActiveRoleForOwner,
  ROLE_PRICE, ADD_MEMBER_PRICE, ROLE_DURATION_MS
};
