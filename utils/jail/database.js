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
});

module.exports = db;
