const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, 'jail.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS jailed_users (
            userId TEXT PRIMARY KEY,
            guildId TEXT,
            jailedBy TEXT,
            reason TEXT,
            jailedAt INTEGER,
            releaseAt INTEGER,
            previousRoles TEXT
        )
    `);

    // Migration: add jailRoleId to support multiple jail role "types"
    // (e.g. /jail vs /jailp). Existing rows will have NULL here, which
    // jailManager.js treats as "the default jail role" for backward
    // compatibility with records created before this column existed.
    db.run(`ALTER TABLE jailed_users ADD COLUMN jailRoleId TEXT`, (err) => {
        if (err && !/duplicate column/i.test(err.message)) {
            console.error('[Jail] Migration error adding jailRoleId column:', err.message);
        }
    });

    // Permanent archive — every jail, once unjailed (manually or via
    // auto-expiry), gets copied here before being removed from the active
    // table, so /jail history has something to read.
    db.run(`
        CREATE TABLE IF NOT EXISTS jail_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT,
            guildId TEXT,
            jailedBy TEXT,
            jailReason TEXT,
            jailedAt INTEGER,
            releaseAt INTEGER,
            jailRoleId TEXT,
            unjailedBy TEXT,
            unjailReason TEXT,
            unjailedAt INTEGER,
            wasAuto INTEGER
        )
    `);
});

module.exports = db;
