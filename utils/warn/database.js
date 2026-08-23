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

    // Migration: punishment-tracking columns, needed to reverse a specific
    // warning's punishment (and only that one) when the warning is removed.
    const punishmentColumns = [
        ['punishmentType', 'TEXT'],           // 'none' | 'timeout' | 'jail' | 'ban'
        ['punishmentAppliedAt', 'INTEGER'],   // when it was applied (jail: the jail record's actual jailedAt)
        ['punishmentMs', 'INTEGER'],          // timeout duration, to compute expected expiry
        ['punishmentReversed', 'INTEGER DEFAULT 0'],
        ['punishmentReversedAt', 'INTEGER'],
        ['punishmentReversedBy', 'TEXT'],
    ];
    for (const [col, type] of punishmentColumns) {
        db.run(`ALTER TABLE warnings ADD COLUMN ${col} ${type}`, (err) => {
            if (err && !/duplicate column/i.test(err.message)) {
                console.error(`[Warn] Migration error adding ${col} column:`, err.message);
            }
        });
    }

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
