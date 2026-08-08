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
      id               SERIAL PRIMARY KEY,
      name             TEXT NOT NULL,
      description      TEXT NOT NULL,
      reward           NUMERIC,
      requester_id     TEXT NOT NULL,
      approver_id      TEXT,
      approved_at      TIMESTAMPTZ,
      status           TEXT NOT NULL DEFAULT 'pending',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      claimer_id       TEXT,
      claimed_at       TIMESTAMPTZ,
      board_channel_id TEXT,
      board_message_id TEXT
      );
    `);

    // These four columns were added after bounties already existed in
    // production — ADD COLUMN IF NOT EXISTS backfills them on an existing
    // table without touching the CREATE TABLE path above (which only ever
    // runs once, for brand-new databases).
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS claimer_id TEXT;`);
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;`);
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS board_channel_id TEXT;`);
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS board_message_id TEXT;`);
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

  // Removes a key entirely, so getSetting() goes back to returning null for it.
  // Used when /deploy is re-run without a value that was previously set.
  async function clearSetting(key) {
    await pool.query('DELETE FROM settings WHERE key = $1', [key]);
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

  // And the specific staff person, when /deploy is configured with a user
  // instead of (or alongside) a role.
  function getStaffUser() {
    return getSetting('staff_user');
  }

  function setStaffUser(userId) {
    return setSetting('staff_user', userId);
  }

  // And the public board channel where approved bounties get posted.
  function getBoardChannel() {
    return getSetting('board_channel');
  }

  function setBoardChannel(channelId) {
    return setSetting('board_channel', channelId);
  }

  // The claim pipeline is configured separately from the request pipeline —
  // its own ticket category and its own staff (role and/or person), set via
  // /deployclaimbounty instead of /deployrequestbounty.
  function getClaimTicketCategory() {
    return getSetting('claim_ticket_category');
  }

  function setClaimTicketCategory(categoryId) {
    return setSetting('claim_ticket_category', categoryId);
  }

  function getClaimStaffRole() {
    return getSetting('claim_staff_role');
  }

  function setClaimStaffRole(roleId) {
    return setSetting('claim_staff_role', roleId);
  }

  function getClaimStaffUser() {
    return getSetting('claim_staff_user');
  }

  function setClaimStaffUser(userId) {
    return setSetting('claim_staff_user', userId);
  }

  // And the public channel where finalized (approved) claims get posted —
  // its own log, separate from the request board.
  function getClaimBoardChannel() {
    return getSetting('claim_board_channel');
  }

  function setClaimBoardChannel(channelId) {
    return setSetting('claim_board_channel', channelId);
  }

  // And the category a claim ticket channel gets MOVED to once its claim is
  // approved — meant to be a private/staff-only category, so the resolved
  // ticket disappears from general view instead of sitting around or getting
  // deleted outright.
  function getClaimArchiveCategory() {
    return getSetting('claim_archive_category');
  }

  function setClaimArchiveCategory(categoryId) {
    return setSetting('claim_archive_category', categoryId);
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

  // Single bounty by id — used to pre-fill the approve/edit modal.
  async function getBountyById(id) {
    const result = await pool.query('SELECT * FROM bounties WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  // Overwrites the editable fields, e.g. after staff tweaks them in the
  // approve/edit modal. Status/approver are handled separately by approveBounty.
  async function updateBounty(id, { name, description, reward }) {
    await pool.query(
      `UPDATE bounties SET name = $2, description = $3, reward = $4 WHERE id = $1`,
      [id, name, description, reward],
    );
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

  // Approved bounties currently sitting on the board, oldest-approved first —
  // this is exactly the claimable pool for the claim-board dropdown (max 25
  // to match Discord's select menu limit).
  async function getClaimableBounties() {
    const result = await pool.query(
      `SELECT * FROM bounties WHERE status = 'approved' ORDER BY approved_at ASC LIMIT 25`,
    );
    return result.rows;
  }

  // Records where the approved card got posted, so a later claim can find and
  // edit that same message instead of posting a duplicate.
  async function setBoardMessage(id, channelId, messageId) {
    await pool.query(
      `UPDATE bounties SET board_channel_id = $2, board_message_id = $3 WHERE id = $1`,
      [id, channelId, messageId],
    );
  }

  // Flips an approved bounty to claimed — guarded by "still approved" so two
  // simultaneous claim approvals can't both succeed for the same bounty.
  // Returns the updated row (with board_channel_id/board_message_id) so the
  // caller can go update that board post, or null if someone beat them to it.
  async function claimBounty(id, claimerId) {
    const result = await pool.query(
      `UPDATE bounties SET status = 'claimed', claimer_id = $2, claimed_at = NOW()
       WHERE id = $1 AND status = 'approved'
       RETURNING *`,
      [id, claimerId],
    );
    return result.rows[0] ?? null;
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
    clearSetting,
    getTicketCategory,
    setTicketCategory,
    getStaffRole,
    setStaffRole,
    getStaffUser,
    setStaffUser,
    getBoardChannel,
    setBoardChannel,
    getClaimTicketCategory,
    setClaimTicketCategory,
    getClaimStaffRole,
    setClaimStaffRole,
    getClaimStaffUser,
    setClaimStaffUser,
    getClaimBoardChannel,
    setClaimBoardChannel,
    getClaimArchiveCategory,
    setClaimArchiveCategory,
    createBounty,
    getBountyById,
    updateBounty,
    approveBounty,
    denyBounty,
    getBounties,
    getClaimableBounties,
    setBoardMessage,
    claimBounty,
  };