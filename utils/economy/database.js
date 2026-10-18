const sqlite3 = require('sqlite3');
const path = require('path');

const dataDir = path.join(__dirname, '../../data');
if (!require('fs').existsSync(dataDir)) {
    require('fs').mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, 'economy.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            userId TEXT PRIMARY KEY,
            balance INTEGER DEFAULT 0,
            wordCount INTEGER DEFAULT 0,
            lastDaily TEXT,
            lastWorkTime INTEGER DEFAULT 0
        )
    `);

    // Ensure column exists (for old databases mhmm )
    db.run("ALTER TABLE users ADD COLUMN lastWorkTime INTEGER DEFAULT 0", (err) => {
        if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding lastWorkTime column:', err.message);
        }
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS purchased_roles (
            roleId TEXT PRIMARY KEY,
            ownerId TEXT,
            purchaseDate INTEGER,
            expirationDate INTEGER,
            extendedCount INTEGER DEFAULT 0,
            FOREIGN KEY(ownerId) REFERENCES users(userId)
        )
    `);

    // Migration: remembers whether the "expires within 24h" DM was already
    // sent for the current expiry window, so the 6-hourly check (and every
    // restart) doesn't re-send it. Reset to 0 whenever the role is extended.
    db.run("ALTER TABLE purchased_roles ADD COLUMN expiryWarned INTEGER DEFAULT 0", (err) => {
        if (err && !/duplicate column/i.test(err.message)) {
            console.error('Error adding expiryWarned column:', err.message);
        }
    });

    // Voice sessions that are currently in progress. Kept in the database so
    // a restart/deploy doesn't wipe everyone's voice time. A row exists only
    // while the user is in a (non-AFK) voice channel.
    db.run(`
        CREATE TABLE IF NOT EXISTS voice_sessions (
            userId TEXT PRIMARY KEY,
            joinedAt INTEGER
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS role_members (
            roleId TEXT,
            userId TEXT,
            addedBy TEXT,
            addedDate INTEGER,
            PRIMARY KEY (roleId, userId),
            FOREIGN KEY(roleId) REFERENCES purchased_roles(roleId)
        )
    `);
});

module.exports = db;
