const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../../data/economy.db');
const fs = require('fs');
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(dbPath);

// Initialize tables
db.serialize(() => {
  // Users table: balance, word count, last daily
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      userId TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0,
      wordCount INTEGER DEFAULT 0,
      lastDaily TEXT,
      lastWorkTime INTEGER DEFAULT 0
    )
  `);

  // Purchased roles
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

  // Role members (owner + added users)
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
