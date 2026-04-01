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

    let roleColor = 0x00ff00; // default green
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
            color: roleColor,   // use 'color', not 'colors'
            icon: iconAttachment ? iconAttachment.url : null,
            reason: `Custom role purchased by ${interaction.user.tag}`
        });
    } catch (error) {
        console.error('Role creation error:', error);
        if (!isAdmin) await updateBalance(userId, ROLE_PRICE);
        return { success: false, message: 'Failed to create role. Coins refunded.' };
    }

    // Position the role below the target role
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
