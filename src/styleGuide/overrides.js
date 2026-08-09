// A general-purpose key/value store for edits made through the style-guide
// page's per-section edit forms (src/styleGuide/styleGuide.js, src/styleGuide/server.js). Separate
// from src/db.js's `settings` table (that one is bot config — categories,
// staff roles, board channels) — this one is CONTENT overrides layered on
// top of text.js's defaults. Same in-memory-cache-over-Postgres pattern as
// settingsCache in db.js, and reuses its connection pool.
const { pool } = require('../db');
const TEXT = require('../text');

const cache = new Map();

// Runs once at startup (before the HTTP server accepts requests) — creates
// the table if needed and warms the cache so every render is a Map lookup,
// no per-request DB round-trip.
async function loadOverrides() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_overrides (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const result = await pool.query('SELECT key, value FROM content_overrides');
  cache.clear();
  for (const row of result.rows) cache.set(row.key, row.value);
  await migrateLegacyLineOverrides();
}

// Multi-line fields (panel descriptions, Q&A bodies) used to be saved as one
// override row per line (e.g. "PANEL.request.description.5"), from an
// earlier version of the style-guide editor. They're now saved as one row
// per field, holding the full \n-joined text (see src/styleGuide/textLines.js) — which
// is what actually makes free add/remove of bullets possible. This rebuilds
// any old-format rows into the new single-key format and removes the old
// ones. Idempotent (a no-op once nothing legacy remains), safe to run every
// boot.
async function migrateLegacyLineOverrides() {
  const multilinePaths = [
    ...Object.keys(TEXT.PANEL).map((k) => `PANEL.${k}.description`),
    ...Object.keys(TEXT.QANDA.topics).map((k) => `QANDA.topics.${k}.body`),
  ];

  const toWrite = [];
  const toDelete = [];
  for (const path of multilinePaths) {
    const legacyKeys = [...cache.keys()].filter((k) => k.startsWith(`${path}.`));
    if (legacyKeys.length === 0) continue;

    const defaultLines = path.split('.').reduce((o, k) => o?.[k], TEXT);
    const rebuilt = defaultLines.map((line, i) => {
      const key = `${path}.${i}`;
      if (!cache.has(key)) return line;
      const saved = cache.get(key);
      return line.startsWith('> ') ? `> ${saved}` : saved;
    });
    toWrite.push([path, rebuilt.join('\n')]);
    toDelete.push(...legacyKeys);
  }

  if (toWrite.length === 0) return;

  await setMany(toWrite);
  await pool.query('DELETE FROM content_overrides WHERE key = ANY($1)', [toDelete]);
  for (const k of toDelete) cache.delete(k);
  console.log(`Migrated ${toWrite.length} legacy per-line override field(s) to the new textarea format.`);
}

// Returns the saved override for `path`, or `fallback` (text.js's own
// default) if nothing's been saved for it yet. Never touches the DB — reads
// are always the in-memory cache.
function get(path, fallback) {
  return cache.has(path) ? cache.get(path) : fallback;
}

// Saves a batch of [path, value] pairs in one go — a whole section's form
// submits as one batch, so either all its fields update or (on a DB error)
// none silently half-apply.
async function setMany(entries) {
  if (!entries.length) return;
  // A dedicated client, not pool.query() per statement — pool.query() checks
  // a connection out and back in for EACH call, so BEGIN/INSERT.../COMMIT
  // would each potentially land on a different connection and never actually
  // form one transaction.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of entries) {
      await client.query(
        `INSERT INTO content_overrides (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  for (const [key, value] of entries) cache.set(key, value);
}

module.exports = { loadOverrides, get, setMany };
