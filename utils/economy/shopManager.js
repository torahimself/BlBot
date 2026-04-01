const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database.js');

const ROLE_PRICE = 60000;
const ADD_MEMBER_PRICE = 1000;
const ROLE_DURATION_DAYS = 0.0104167;

// Helper functions
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
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
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
        const balance = await getBalance(userId);
        if (balance < ROLE_PRICE) {
            return { success: false, message: `You need ${ROLE_PRICE} coins. You have ${balance}.` };
        }
        await updateBalance(userId, -ROLE_PRICE);
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

    // Position the role below the target role (optional) tt
    const targetRoleId = '1446128863200542933';
    const targetRole = guild.roles.cache.get(targetRoleId);
    if (targetRole) {
        const targetPosition = targetRole.position;
        try {
            await role.setPosition(targetPosition + 1);
        } catch (err) {
            console.warn('Could not set role position:', err.message);
        }
    } else {
        try {
            await role.setPosition(2);
        } catch (err) {
            console.warn('Could not set role position:', err.message);
        }
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
                if (!isAdmin) updateBalance(userId, ROLE_PRICE);
                return { success: false, message: 'Database error. Coins refunded.' };
            }
        }
    );

    await interaction.member.roles.add(role);
    db.run('INSERT INTO role_members (roleId, userId, addedBy, addedDate) VALUES (?, ?, ?, ?)',
        [role.id, userId, userId, now]);

    return { success: true, role: role, message: `Role ${role.name} created!` };
}

async function addMemberToRole(interaction, roleId, targetUser) {
    const ownerId = interaction.user.id;
    const roleData = await getRoleOwner(roleId);
    if (!roleData || roleData.ownerId !== ownerId) {
        return { success: false, message: 'You do not own this role.' };
    }

    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) {
        return { success: false, message: 'Role not found. It may have been deleted.' };
    }

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

    const balance = await getBalance(ownerId);
    if (balance < ADD_MEMBER_PRICE) {
        return { success: false, message: `You need ${ADD_MEMBER_PRICE} coins to add a member.` };
    }

    await updateBalance(ownerId, -ADD_MEMBER_PRICE);
    await targetMember.roles.add(role);
    db.run('INSERT INTO role_members (roleId, userId, addedBy, addedDate) VALUES (?, ?, ?, ?)',
        [roleId, targetUser.id, ownerId, Date.now()]);
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
    if (!role) {
        return { success: false, message: 'Role not found. It may have been deleted.' };
    }

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
        if (newIconAttachment) {
            await role.setIcon(newIconAttachment.url);
        }
        if (newColorHex) {
            const hexRegex = /^#([0-9A-Fa-f]{6})$/;
            if (!hexRegex.test(newColorHex)) {
                return { success: false, message: 'Invalid color format. Use #RRGGBB.' };
            }
            const color = parseInt(newColorHex.replace('#', ''), 16);
            await role.setColor(color);
        }
        return { success: true, message: 'Role updated.' };
    } catch (error) {
        return { success: false, message: 'Failed to update role.' };
    }
}

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

function getRoleOwner(roleId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT ownerId FROM purchased_roles WHERE roleId = ?', [roleId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function getRoleMemberCount(roleId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM role_members WHERE roleId = ?', [roleId], (err, row) => {
            if (err) reject(err);
            else resolve(row.count);
        });
    });
}

async function checkExpiredRoles(client, logChannelId) {
    const now = Date.now();
    const expirationWarningTime = 24 * 60 * 60 * 1000;
    db.all('SELECT roleId, ownerId, expirationDate FROM purchased_roles', async (err, rows) => {
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
            } else if (timeLeft <= expirationWarningTime && timeLeft > 0) {
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
