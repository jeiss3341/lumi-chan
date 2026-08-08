const { Pool } = require('pg');

// ─────────────────────────────────────────────────────────────────────────────
// Connection
//
// DATABASE_URL comes from your .env (locally, that's Railway's DATABASE_PUBLIC_URL).
//
// SSL note: Railway's public proxy does NOT require SSL, so we leave it OFF by
// default. If you ever point this at a host that DOES require SSL (Render,
// Heroku, Supabase, etc.), set PGSSL=true in your .env and this flips on.
// ─────────────────────────────────────────────────────────────────────────────
const useSsl = process.env.PGSSL === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

// Surface connection problems loudly instead of failing silently.
pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

// ─────────────────────────────────────────────────────────────────────────────
// Table setup — runs once on startup. "IF NOT EXISTS" means it's safe to run
// every boot; it only creates the tables the first time.
// ─────────────────────────────────────────────────────────────────────────────
async function initDb() {
  // Generic key/value store. We'll use it for the ticket category now, and it's
  // reusable for other config later (staff role, board channel, etc.).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Every bounty request. Approver + approved_at are the fields /allbounties wants.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bounties (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL,
    reward        NUMERIC,
    requester_id  TEXT NOT NULL,
    approver_id   TEXT,
    approved_at   TIMESTAMPTZ,
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings helpers (generic key/value)
// ─────────────────────────────────────────────────────────────────────────────

// Returns the stored value for a key, or null if it was never set.
async function getSetting(key) {
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return result.rows[0]?.value ?? null;
}

// Insert-or-update: sets the value, overwriting any existing one for that key.
async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience wrappers for the ticket category.
//
// The whole point of routing through these: the ticket code never reads the
// category ID directly. It calls getTicketCategory(). Today that reads from the
// settings table (set by the /deploy picker). If we ever change WHERE it's
// stored, only these two lines change — nothing else in the bot notices.
// ─────────────────────────────────────────────────────────────────────────────
function getTicketCategory() {
  return getSetting('ticket_category');
}

function setTicketCategory(categoryId) {
  return setSetting('ticket_category', categoryId);
}

// Same idea for the staff role: the role allowed to review/approve/deny bounties.
function getStaffRole() {
  return getSetting('staff_role');
}

function setStaffRole(roleId) {
  return setSetting('staff_role', roleId);
}

// And the public board channel where approved bounties get posted.
function getBoardChannel() {
  return getSetting('board_channel');
}

function setBoardChannel(channelId) {
  return setSetting('board_channel', channelId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bounty records
// ─────────────────────────────────────────────────────────────────────────────

// Insert a new bounty as 'pending' when the ticket is created. Returns its id
// so we can bake it into the Approve/Deny buttons.
async function createBounty({ name, description, reward, requesterId }) {
  const result = await pool.query(
    `INSERT INTO bounties (name, description, reward, requester_id, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING id`,
    [name, description, reward, requesterId],
  );
  return result.rows[0].id;
}

// Flip a bounty to approved, recording who approved it and when.
async function approveBounty(id, approverId) {
  await pool.query(
    `UPDATE bounties SET status = 'approved', approver_id = $2, approved_at = NOW() WHERE id = $1`,
    [id, approverId],
  );
}

// Flip a bounty to denied (kept for the audit trail; excluded from /allbounties).
async function denyBounty(id, approverId) {
  await pool.query(
    `UPDATE bounties SET status = 'denied', approver_id = $2, approved_at = NOW() WHERE id = $1`,
    [id, approverId],
  );
}

// Bounties filtered by status ('approved' | 'pending' | 'denied'), or all of
// them. Newest action first. Powers /allbounties.
async function getBounties(status) {
  if (status === 'all') {
    const result = await pool.query(
      `SELECT * FROM bounties ORDER BY COALESCE(approved_at, created_at) DESC`,
    );
    return result.rows;
  }
  const result = await pool.query(
    `SELECT * FROM bounties WHERE status = $1 ORDER BY COALESCE(approved_at, created_at) DESC`,
    [status],
  );
  return result.rows;
}

module.exports = {
  pool,
  initDb,
  getSetting,
  setSetting,
  getTicketCategory,
  setTicketCategory,
  getStaffRole,
  setStaffRole,
  getBoardChannel,
  setBoardChannel,
  createBounty,
  approveBounty,
  denyBounty,
  getBounties,
};