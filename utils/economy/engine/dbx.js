'use strict';
// Small promise wrappers around the shared economy database, plus the two
// primitives the engine's correctness depends on:
//
//   exclusive(key, fn)   — runs fn one-at-a-time per key (per user), so a
//                          read-then-write sequence can never interleave with
//                          another one for the same user.
//   atomic(sql)          — runs a batch of statements as ONE transaction. The
//                          sqlite3 driver executes db.exec() exclusively (no
//                          other statement can run in the middle), so either
//                          every statement lands or none does.

const db = require('../database.js');

const ready = () => (db.ready || Promise.resolve());

function run(sql, params = []) {
  return ready().then(() => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err); else resolve({ changes: this.changes, lastID: this.lastID });
    });
  }));
}

function get(sql, params = []) {
  return ready().then(() => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  }));
}

function all(sql, params = []) {
  return ready().then(() => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  }));
}

function exec(sql) {
  return ready().then(() => new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  }));
}

// SQL literal for values that must be inlined into an exec() batch (exec has
// no parameter binding). Numbers must be finite; strings are quote-escaped.
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('dbx.lit: non-finite number');
    return String(v);
  }
  if (typeof v === 'boolean') return v ? '1' : '0';
  return "'" + String(v).replace(/\0/g, '').replace(/'/g, "''") + "'";
}

// Runs the statements as one transaction. On any error the transaction is
// rolled back and the error is re-thrown.
async function atomic(sql) {
  try {
    await exec('BEGIN IMMEDIATE;\n' + sql + '\nCOMMIT;');
  } catch (err) {
    await exec('ROLLBACK;').catch(() => {});
    throw err;
  }
}

// Per-key serial queue.
const chains = new Map();
function exclusive(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chains.set(key, next);
  const cleanup = () => { if (chains.get(key) === next) chains.delete(key); };
  next.then(cleanup, cleanup);
  return next;
}

// ── Reward bundles ───────────────────────────────────────────────────────────
// Builds the SQL for "grant coins / potions / titles, guarded by a claim row".
//
// With a `claim`, the claim row is inserted with INSERT OR IGNORE and every
// later statement only takes effect if that insert actually added a row
// (`changes() > 0`). So running the same bundle twice grants nothing the
// second time, and because the whole batch is one transaction a crash can
// never leave "claimed but not paid".
//
// ORDER MATTERS: each guarded statement must change at least one row, or the
// guard for the statements after it would read 0. Titles come last because
// "INSERT OR IGNORE" may legitimately change nothing.
//
//   userId  : string
//   coins   : integer ≥ 0
//   potions : [{ type, hours, source }]
//   titles  : [{ id, category }]
//   claim   : { table, cols: { name: value, ... } } | null
//   extra   : raw SQL appended last (also guarded if you write it so)
function bundleSql({ userId, coins = 0, potions = [], titles = [], claim = null, now = Date.now(), source = 'reward' }) {
  const u = lit(userId);
  const out = [];
  out.push(`INSERT INTO users (userId, balance) VALUES (${u}, 0) ON CONFLICT(userId) DO NOTHING;`);

  const guard = claim ? ' WHERE changes() > 0' : '';
  const guardAnd = claim ? ' AND changes() > 0' : '';

  if (claim) {
    const names = Object.keys(claim.cols);
    out.push(`INSERT OR IGNORE INTO ${claim.table} (${names.join(', ')}) VALUES (${names.map(n => lit(claim.cols[n])).join(', ')});`);
  }
  if (coins > 0) {
    out.push(`UPDATE users SET balance = balance + ${lit(Math.floor(coins))} WHERE userId = ${u}${guardAnd};`);
  }
  for (const p of potions) {
    out.push(`INSERT INTO potions (userId, type, hours, source, grantedAt) SELECT ${u}, ${lit(p.type)}, ${lit(p.hours)}, ${lit(p.source || source)}, ${lit(now)}${guard};`);
  }
  for (const t of titles) {
    out.push(`INSERT OR IGNORE INTO titles (userId, titleId, category, earnedAt) SELECT ${u}, ${lit(t.id)}, ${lit(t.category)}, ${lit(now)}${guard};`);
  }
  return out.join('\n');
}

module.exports = { run, get, all, exec, lit, atomic, exclusive, bundleSql };
