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

    // Ensure column exists (for old databases)
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
