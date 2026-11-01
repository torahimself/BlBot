'use strict';
// Each member's card look (theme, accent colour, avatar shape, layout, featured title, about-me line).
// Stored in SQLite (economy.db → ui_prefs) so it survives restarts like the rest of the economy.

const dbx = require('../economy/engine/dbx');
const themes = require('./themes');
const backgrounds = require('./backgrounds');

let ready = null;
function init() {
  if (!ready) {
    ready = dbx.run(`CREATE TABLE IF NOT EXISTS ui_prefs (
      userId TEXT PRIMARY KEY, theme TEXT, accent TEXT, shape TEXT, layout TEXT, featured TEXT, about TEXT, updatedAt INTEGER
    )`).then(() => dbx.run('ALTER TABLE ui_prefs ADD COLUMN bg TEXT').catch((e) => {      // older databases get the new column once
      if (!/duplicate column/i.test(String(e && e.message))) throw e;
    })).then(() => dbx.run('ALTER TABLE ui_prefs ADD COLUMN chips TEXT').catch((e) => {
      if (!/duplicate column/i.test(String(e && e.message))) throw e;
    })).catch((err) => { ready = null; throw err; });
  }
  return ready;
}

function normalise(row) {
  const p = { ...themes.DEFAULTS };
  if (!row) return p;
  if (themes.byId(themes.THEMES, row.theme)) p.theme = row.theme;
  p.accent = themes.parseHex(row.accent);
  if (themes.byId(themes.SHAPES, row.shape)) p.shape = row.shape;
  if (themes.byId(themes.LAYOUTS, row.layout)) p.layout = row.layout;
  p.featured = row.featured || null;
  p.chips = String(row.chips || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
  p.bg = row.bg && backgrounds.byId(row.bg) ? row.bg : null;
  p.about = themes.cleanAbout(row.about);
  return p;
}

async function get(userId) {
  try {
    await init();
    return normalise(await dbx.get('SELECT * FROM ui_prefs WHERE userId = ?', [userId]));
  } catch (err) {
    console.error('[UI] prefs read failed:', err.message);
    return { ...themes.DEFAULTS };
  }
}

/** patch: any of theme / accent / shape / layout / featured / about. Invalid values are ignored. */
async function set(userId, patch = {}) {
  await init();
  const cur = await get(userId);
  const next = { ...cur };
  if ('theme' in patch && themes.byId(themes.THEMES, patch.theme)) next.theme = patch.theme;
  if ('accent' in patch) next.accent = patch.accent === null ? null : (themes.parseHex(patch.accent) || cur.accent);
  if ('shape' in patch && themes.byId(themes.SHAPES, patch.shape)) next.shape = patch.shape;
  if ('layout' in patch && themes.byId(themes.LAYOUTS, patch.layout)) next.layout = patch.layout;
  if ('featured' in patch) next.featured = patch.featured || null;
  if ('chips' in patch) next.chips = (Array.isArray(patch.chips) ? patch.chips : []).map(String).filter(s => /^[\w-]{1,60}$/.test(s)).filter((s, i, a) => a.indexOf(s) === i).slice(0, 3);
  if ('bg' in patch) next.bg = patch.bg && backgrounds.byId(patch.bg) ? patch.bg : null;   // (the caller checks the unlock)
  if ('about' in patch) next.about = themes.cleanAbout(patch.about);
  await dbx.run(
    `INSERT INTO ui_prefs (userId, theme, accent, shape, layout, featured, about, bg, chips, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET theme = excluded.theme, accent = excluded.accent, shape = excluded.shape,
       layout = excluded.layout, featured = excluded.featured, about = excluded.about, bg = excluded.bg, chips = excluded.chips, updatedAt = excluded.updatedAt`,
    [userId, next.theme, next.accent, next.shape, next.layout, next.featured, next.about, next.bg || null, (next.chips || []).join(',') || null, Date.now()]
  );
  return next;
}

async function reset(userId) {
  await init();
  await dbx.run('DELETE FROM ui_prefs WHERE userId = ?', [userId]);
  return { ...themes.DEFAULTS };
}

module.exports = { get, set, reset, init };
