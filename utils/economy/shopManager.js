const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database.js');

const ROLE_PRICE = 12000;
const ADD_MEMBER_PRICE = 500;
const ROLE_DURATION_DAYS = 30;

// Helper: get balance
function getBalance(userId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT balance FROM users WHERE userId = ?', [userId], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.balance : 0);
        });
    });
}

// Helper: update balance
function updateBalance(userId, amount) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO users (userId, balance) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET balance = balance + ?',
            [userId, amount, amount],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

// Purchase role (check balance, deduct, return success + requiresModal)
async function purchaseRole(interaction) {
    const userId = interaction.user.id;
    const balance = await getBalance(userId);
    if (balance < ROLE_PRICE) {
        return { success: false, message: `You need ${ROLE_PRICE} coins. You have ${balance}.` };
    }
    // Deduct now, or after modal? Deduct after modal to avoid double deduction if modal fails.
    // We'll deduct in the modal handler.
    return { success: true, requiresModal: true };
}

// Create role after modal submission
async function createCustomRole(interaction, name, iconAttachment) {
    const userId = interaction.user.id;
    const guild = interaction.guild;
    if (!guild) return { success: false, message: 'Guild not found' };

    // Deduct coins
    const balance = await getBalance(userId);
    if (balance < ROLE_PRICE) {
        return { success: false, message: `You no longer have enough coins. Need ${ROLE_PRICE}.` };
    }
    await updateBalance(userId, -ROLE_PRICE);

    let role;
    try {
        role = await guild.roles.create({
            name: name,
            color: 0x00ff00,
            icon: iconAttachment ? iconAttachment.url : null,
            reason: `Custom role purchased by ${interaction.user.tag}`
        });
    } catch (error) {
        console.error('Role creation error:', error);
        // Refund
        await updateBalance(userId, ROLE_PRICE);
        return { success: false, message: 'Failed to create role. Coins refunded.' };
    }

    const now = Date.now();
    const expiration = now + ROLE_DURATION_DAYS * 24 * 60 * 60 * 1000;
    db.run(
        'INSERT INTO purchased_roles (roleId, ownerId, purchaseDate, expirationDate) VALUES (?, ?, ?, ?)',
        [role.id, userId, now, expiration],
        (err) => {
            if (err) {
                console.error(err);
                role.delete().catch(console.error);
                updateBalance(userId, ROLE_PRICE);
                return { success: false, message: 'Database error. Coins refunded.' };
            }
        }
    );

    // Add owner to role
    await interaction.member.roles.add(role);
    db.run('INSERT INTO role_members (roleId, userId, addedBy, addedDate) VALUES (?, ?, ?, ?)',
        [role.id, userId, userId, now]);

    return { success: true, role: role, message: `Role ${role.name} created!` };
}

// Add member to role (cost 500)
async function addMemberToRole(interaction, roleId, targetUser) {
    const ownerId = interaction.user.id;
    const roleData = await getRoleOwner(roleId);
    if (!roleData || roleData.ownerId !== ownerId) {
        return { success: false, message: 'You do not own this role.' };
    }

    const memberCount = await getRoleMemberCount(roleId);
    if (memberCount >= 11) { // owner + 10 members
        return { success: false, message: 'Role already has maximum 10 members (excluding owner).' };
    }

    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) return { success: false, message: 'Role not found.' };
    if (role.members.has(targetUser.id)) {
        return { success: false, message: 'User already has this role.' };
    }

    const balance = await getBalance(ownerId);
    if (balance < ADD_MEMBER_PRICE) {
        return { success: false, message: `You need ${ADD_MEMBER_PRICE} coins to add a member.` };
    }

    await updateBalance(ownerId, -ADD_MEMBER_PRICE);
    await targetUser.roles.add(role);
    db.run('INSERT INTO role_members (roleId, userId, addedBy, addedDate) VALUES (?, ?, ?, ?)',
        [roleId, targetUser.id, ownerId, Date.now()]);
    return { success: true, message: `Added ${targetUser.tag} to role.` };
}

// Remove member (free)
async function removeMemberFromRole(interaction, roleId, targetUser) {
    const ownerId = interaction.user.id;
    const roleData = await getRoleOwner(roleId);
    if (!roleData || roleData.ownerId !== ownerId) {
        return { success: false, message: 'You do not own this role.' };
    }
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) return { success: false, message: 'Role not found.' };
    if (!role.members.has(targetUser.id)) {
        return { success: false, message: 'User does not have this role.' };
    }
    await targetUser.roles.remove(role);
    db.run('DELETE FROM role_members WHERE roleId = ? AND userId = ?', [roleId, targetUser.id]);
    return { success: true, message: `Removed ${targetUser.tag} from role.` };
}

// Edit role name/icon
async function editRole(interaction, roleId, newName, newIconAttachment) {
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
        return { success: true, message: 'Role updated.' };
    } catch (error) {
        return { success: false, message: 'Failed to update role.' };
    }
}

// Extend role (cost same as purchase)
async function extendRole(roleId, ownerId) {
    const balance = await getBalance(ownerId);
    if (balance < ROLE_PRICE) {
        return { success: false, message: `You need ${ROLE_PRICE} coins to extend.` };
    }
    await updateBalance(ownerId, -ROLE_PRICE);
    const newExpiration = Date.now() + ROLE_DURATION_DAYS * 24 * 60 * 60 * 1000;
    db.run('UPDATE purchased_roles SET expirationDate = ?, extendedCount = extendedCount + 1 WHERE roleId = ?',
        [newExpiration, roleId]);
    return { success: true, message: `Role extended for ${ROLE_DURATION_DAYS} days.` };
}

// Helper: get role owner
function getRoleOwner(roleId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT ownerId FROM purchased_roles WHERE roleId = ?', [roleId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// Helper: get member count (including owner)
function getRoleMemberCount(roleId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM role_members WHERE roleId = ?', [roleId], (err, row) => {
            if (err) reject(err);
            else resolve(row.count);
        });
    });
}

// Expiration checker (run daily)
async function checkExpiredRoles(client, logChannelId) {
    const now = Date.now();
    const expirationWarningTime = 24 * 60 * 60 * 1000; // 24h
    db.all('SELECT roleId, ownerId, expirationDate FROM purchased_roles', async (err, rows) => {
        if (err) return console.error(err);
        for (const row of rows) {
            const timeLeft = row.expirationDate - now;
            if (timeLeft <= 0) {
                // Delete role
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
            } else if (timeLeft <= expirationWarningTime && timeLeft > 0) {
                // Send warning (once per expiration period; we send each check, but that's okay)
                const owner = await client.users.fetch(row.ownerId).catch(() => null);
                if (owner) {
                    const buttonRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`extend_role_${row.roleId}`)
                                .setLabel(`Extend for ${ROLE_PRICE} coins`)
                                .setStyle(ButtonStyle.Primary)
                        );
                    owner.send({
                        content: `Your role <@&${row.roleId}> will expire in less than 24 hours. Click below to extend for another ${ROLE_DURATION_DAYS} days (cost ${ROLE_PRICE} coins).`,
                        components: [buttonRow]
                    }).catch(console.error);
                }
            }
        }
    });
}

module.exports = {
    purchaseRole,
    createCustomRole,
    getBalance,
    updateBalance,
    addMemberToRole,
    removeMemberFromRole,
    editRole,
    extendRole,
    checkExpiredRoles,
    ROLE_PRICE,
    ADD_MEMBER_PRICE,
    ROLE_DURATION_DAYS
};
