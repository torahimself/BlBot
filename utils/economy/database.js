const sqlite3 = require('sqlite3');
const path = require('path');

const dataDir = path.join(__dirname, '../../data');
if (!require('fs').existsSync(dataDir)) {
    require('fs').mkdirSync(dataDir, { recursive: true });
}
// BL_ECONOMY_DB lets the simulator/tests use ':memory:' without touching the
// real database. In production it is not set and the normal file is used.
const dbPath = process.env.BL_ECONOMY_DB || path.join(dataDir, 'economy.db');
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

    // LEGACY: the old session-based voice tracker used this table. The new
    // engine samples voice channels every minute instead, so nothing reads or
    // writes it any more. It is left in place (harmless) so a rollback to the
    // previous version of the bot still works.
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

    // ── Economy engine tables (all new — existing tables are untouched) ─────

    // Lifetime counters + fractional-coin carry-overs. `chars` / `voiceMinutes`
    // only count CREDITED activity (spam-filtered, inside the weekly ceilings).
    db.run(`
        CREATE TABLE IF NOT EXISTS act_totals (
            userId TEXT PRIMARY KEY,
            chars INTEGER DEFAULT 0,
            voiceMinutes INTEGER DEFAULT 0,
            textFrac REAL DEFAULT 0,
            voiceFrac REAL DEFAULT 0,
            dropCharCarry INTEGER DEFAULT 0
        )
    `);

    // One row per user / day / source — the weekly cap and the 30-day rolling
    // cap are both just sums over these rows. Rows older than 35 days are pruned.
    db.run(`
        CREATE TABLE IF NOT EXISTS act_daily (
            userId TEXT,
            day TEXT,
            source TEXT,
            coins INTEGER DEFAULT 0,
            units INTEGER DEFAULT 0,
            PRIMARY KEY (userId, day, source)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS milestone_claims (
            userId TEXT,
            track TEXT,
            tier INTEGER,
            claimedAt INTEGER,
            PRIMARY KEY (userId, track, tier)
        )
    `);

    // category: 'milestone' | 'event'
    db.run(`
        CREATE TABLE IF NOT EXISTS titles (
            userId TEXT,
            titleId TEXT,
            category TEXT,
            earnedAt INTEGER,
            PRIMARY KEY (userId, titleId)
        )
    `);

    // One row per unused potion (its duration was rolled when it was created).
    db.run(`
        CREATE TABLE IF NOT EXISTS potions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT,
            type TEXT,
            hours INTEGER,
            source TEXT,
            grantedAt INTEGER
        )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_potions_user ON potions(userId)');

    // At most one active boost per user per type.
    db.run(`
        CREATE TABLE IF NOT EXISTS boosts (
            userId TEXT,
            type TEXT,
            multiplier REAL,
            startedAt INTEGER,
            expiresAt INTEGER,
            PRIMARY KEY (userId, type)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS drop_prefs (
            userId TEXT PRIMARY KEY,
            dm INTEGER DEFAULT 1
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS drop_weekly (
            userId TEXT,
            week TEXT,
            count INTEGER DEFAULT 0,
            PRIMARY KEY (userId, week)
        )
    `);
    // Granted drops only (failed rolls are never stored).
    db.run(`
        CREATE TABLE IF NOT EXISTS drop_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT,
            at INTEGER,
            kind TEXT,
            detail TEXT
        )
    `);

    // Weekly NET betting result per user (wins minus losses).
    db.run(`
        CREATE TABLE IF NOT EXISTS bet_net (
            userId TEXT,
            week TEXT,
            net INTEGER DEFAULT 0,
            PRIMARY KEY (userId, week)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS event_state (
            eventId TEXT PRIMARY KEY,
            startAt INTEGER,
            endAt INTEGER,
            status TEXT,
            result TEXT,
            progressChannelId TEXT,
            progressMessageId TEXT
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS event_points (
            eventId TEXT,
            userId TEXT,
            textChars INTEGER DEFAULT 0,
            voiceMinutes INTEGER DEFAULT 0,
            games INTEGER DEFAULT 0,
            PRIMARY KEY (eventId, userId)
        )
    `);
    // Migration for databases created before event game points existed.
    db.run("ALTER TABLE event_points ADD COLUMN games INTEGER DEFAULT 0", (err) => {
        if (err && !/duplicate column/i.test(err.message)) console.error('Error adding event_points.games column:', err.message);
    });
    // Night-time activity per Sunday-week (for the night roles) and who holds them.
    db.run(`
        CREATE TABLE IF NOT EXISTS night_totals (
            userId TEXT,
            week TEXT,
            source TEXT,
            units INTEGER DEFAULT 0,
            PRIMARY KEY (userId, week, source)
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS night_holders (
            category TEXT,
            userId TEXT,
            since TEXT,
            PRIMARY KEY (category, userId)
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS night_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            lastWeek TEXT
        )
    `);
    // Coins staked in party games that are still running. If the bot restarts
    // mid-game these are handed back on startup, so a crash never eats a bet.
    db.run(`
        CREATE TABLE IF NOT EXISTS party_stakes (
            sessionId TEXT,
            userId TEXT,
            amount INTEGER,
            createdAt INTEGER,
            PRIMARY KEY (sessionId, userId)
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS event_rewards (
            eventId TEXT,
            userId TEXT,
            claimedAt INTEGER,
            PRIMARY KEY (eventId, userId)
        )
    `);

    // Resolves once every statement above has run (queued last on purpose).
    db.ready = new Promise((resolve) => db.run('SELECT 1', () => resolve()));
});

module.exports = db;
