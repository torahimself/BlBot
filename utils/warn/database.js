const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, 'warnings.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS warnings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT,
            guildId TEXT,
            issuedBy TEXT,
            reason TEXT,
            issuedAt INTEGER,
            expiresAt INTEGER,
            warnNumberAtIssue INTEGER,
            removed INTEGER DEFAULT 0,
            removedBy TEXT,
            removedReason TEXT,
            removedAt INTEGER,
            expiredLogged INTEGER DEFAULT 0
        )
    `);

    // Audit trail — every edit to a warning's reason or date is recorded
    // here permanently, so nothing is silently lost when staff edit a warning.
    db.run(`
        CREATE TABLE IF NOT EXISTS warning_edits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            warningId INTEGER,
            editedBy TEXT,
            editedAt INTEGER,
            fieldChanged TEXT,
            oldValue TEXT,
            newValue TEXT
        )
    `);
});

module.exports = db;
