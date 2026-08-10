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
  // Settings cache
  //
  // The settings table is tiny and only ever written by the two /deploy*
  // commands, but it's READ on nearly every interaction (staff role, ticket
  // category, board channels, archive category…). Each of those reads was a
  // separate network round-trip to Postgres. Since this is a single bot
  // process, we keep an in-memory mirror instead: preloaded once at startup,
  // kept in sync on every write, so reads are a Map lookup with no DB hit.
  // ─────────────────────────────────────────────────────────────────────────────
  const settingsCache = new Map();

  // Loads every existing setting into the cache. Called once from initDb().
  async function loadSettings() {
    const result = await pool.query('SELECT key, value FROM settings');
    settingsCache.clear();
    for (const row of result.rows) settingsCache.set(row.key, row.value);
  }

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
      reward           TEXT,
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

    // donator_name: who to credit for the prize — optional, set at request
    // time (falls back to the requester's Discord nickname if left blank).
    // prize_type: cash/NP/Item/Other — staff-only, set during approval, never
    // collected from the player. tier: None/Bronze/Silver/Gold — same,
    // staff-only. All three added after bounties already existed.
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS donator_name TEXT;`);
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS prize_type TEXT;`);
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS tier TEXT;`);

    // reward used to be NUMERIC (dollars-only) — it's free text now, since
    // rewards can be anything ("250 NP", "5 gems", not just cash). Safe to
    // rerun every boot: casting TEXT to TEXT is a no-op once already migrated.
    await pool.query(`ALTER TABLE bounties ALTER COLUMN reward TYPE TEXT USING reward::TEXT;`);

    // Warm the settings cache so the first interaction after boot doesn't have
    // to fall back to the DB for each setting it reads.
    await loadSettings();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Settings helpers (generic key/value)
  // ─────────────────────────────────────────────────────────────────────────────

  // Returns the stored value for a key, or null if it was never set. Served
  // from the in-memory cache; only the first read of a key that wasn't loaded
  // at startup touches the DB (and it's cached from then on).
  async function getSetting(key) {
    if (settingsCache.has(key)) return settingsCache.get(key);
    const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
    const value = result.rows[0]?.value ?? null;
    settingsCache.set(key, value);
    return value;
  }

  // Insert-or-update: sets the value, overwriting any existing one for that
  // key. Cache is updated only after the DB write succeeds.
  async function setSetting(key, value) {
    await pool.query(
      `INSERT INTO settings (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value],
    );
    settingsCache.set(key, value);
  }

  // Removes a key entirely, so getSetting() goes back to returning null for it.
  // Used when /deploy is re-run without a value that was previously set.
  async function clearSetting(key) {
    await pool.query('DELETE FROM settings WHERE key = $1', [key]);
    settingsCache.set(key, null);
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

  // The category a request ticket channel gets MOVED to once it's approved
  // or denied, mirroring getClaimArchiveCategory below — set from the admin
  // Tickets page (src/styleGuide/ticketRoutes.js) rather than a slash
  // command. If unset, closing falls back to the original delayed-delete
  // behavior (see index.js closeOrArchiveTicket).
  function getRequestArchiveCategory() {
    return getSetting('request_archive_category');
  }

  function setRequestArchiveCategory(categoryId) {
    return setSetting('request_archive_category', categoryId);
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

  // A third, entirely separate pipeline: general "talk to staff" support
  // tickets (opened from /help), configured via /deployticket. No board —
  // these aren't bounties, just a private conversation that gets closed
  // when it's resolved.
  function getHelpTicketCategory() {
    return getSetting('help_ticket_category');
  }

  function setHelpTicketCategory(categoryId) {
    return setSetting('help_ticket_category', categoryId);
  }

  // Same archive-on-close idea as request/claim tickets — set from the
  // admin Tickets page, not a slash command.
  function getHelpArchiveCategory() {
    return getSetting('help_archive_category');
  }

  function setHelpArchiveCategory(categoryId) {
    return setSetting('help_archive_category', categoryId);
  }

  function getHelpStaffRole() {
    return getSetting('help_staff_role');
  }

  function setHelpStaffRole(roleId) {
    return setSetting('help_staff_role', roleId);
  }

  function getHelpStaffUser() {
    return getSetting('help_staff_user');
  }

  function setHelpStaffUser(userId) {
    return setSetting('help_staff_user', userId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Bounty records
  // ─────────────────────────────────────────────────────────────────────────────

  // Insert a new bounty as 'pending' when the ticket is created. Returns its id
  // so we can bake it into the Approve/Deny buttons.
  async function createBounty({ name, description, reward, requesterId, donatorName }) {
    const result = await pool.query(
      `INSERT INTO bounties (name, description, reward, requester_id, donator_name, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING id`,
      [name, description, reward, requesterId, donatorName ?? null],
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
  async function updateBounty(id, { name, description, reward, donatorName, prizeType, tier }) {
    await pool.query(
      `UPDATE bounties SET name = $2, description = $3, reward = $4, donator_name = $5, prize_type = $6, tier = $7 WHERE id = $1`,
      [id, name, description, reward, donatorName ?? null, prizeType ?? null, tier ?? null],
    );
  }

  // Checks whether `name` is already used by an approved or claimed bounty
  // (case/whitespace-insensitive) — keeps official bounty titles unique.
  // Pending and denied bounties don't count: multiple pending requests can
  // share a title, they just can't BOTH become official. Pass `excludeId`
  // when checking a bounty against everyone ELSE (e.g. re-approving it
  // shouldn't conflict with itself). Returns the conflicting row, or null.
  async function findTitleConflict(name, excludeId = null) {
    const result = await pool.query(
      `SELECT id, name FROM bounties
       WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
         AND status IN ('approved', 'claimed')
         AND id IS DISTINCT FROM $2
       LIMIT 1`,
      [name, excludeId],
    );
    return result.rows[0] ?? null;
  }

  // Shared by approveBounty/denyBounty/cancelBounty/setBountyPending below —
  // all four are the exact same UPDATE with a different target status, and
  // the admin bounties page's free status-change control (src/styleGuide/
  // bountyRoutes.js) uses this directly to move a bounty to any of the four.
  //
  // `expectedStatus` makes the write a compare-and-swap: pass the status you
  // read a moment ago and the UPDATE only lands if it's still that, so two
  // people acting at once (staff pressing Approve in a Discord ticket while
  // an admin sets Denied on the web page) can't both "succeed" and leave the
  // board post and the DB disagreeing. Returns the updated row, or null if
  // someone else got there first — callers must handle null. Omit it for an
  // unconditional write (every pre-existing caller, unchanged).
  async function setBountyStatus(id, status, actorId, expectedStatus = null) {
    const result = await pool.query(
      `UPDATE bounties SET status = $2, approver_id = $3, approved_at = NOW()
       WHERE id = $1 AND ($4::text IS NULL OR status = $4)
       RETURNING *`,
      [id, status, actorId, expectedStatus],
    );
    return result.rows[0] ?? null;
  }

  // Flip a bounty to approved, recording who approved it and when.
  function approveBounty(id, approverId) {
    return setBountyStatus(id, 'approved', approverId);
  }

  // Flip a bounty to denied (kept for the audit trail; excluded from /allbounties).
  function denyBounty(id, approverId) {
    return setBountyStatus(id, 'denied', approverId);
  }

  // Soft-delete: flips a bounty to 'cancelled' rather than removing the row,
  // same audit-trail reasoning as denyBounty — used by the admin bounties
  // page (src/styleGuide/bounties.js) instead of a real DELETE, so a
  // mis-click stays recoverable and the history (who/when) isn't lost.
  function cancelBounty(id, cancelledBy) {
    return setBountyStatus(id, 'cancelled', cancelledBy);
  }

  // Reverts a bounty back to pending — the one transition none of the
  // Discord-side flows ever needed (nothing "un-approves" itself there), but
  // the admin page's free status control allows it.
  function setBountyPending(id, actorId) {
    return setBountyStatus(id, 'pending', actorId);
  }

  // Approved bounties currently sitting on the board, alphabetical by name —
  // this is exactly the claimable pool for the claim-board dropdown. Discord's
  // select menu is hard-capped at 25 options, so this is paginated: pass
  // `offset` to fetch a later page (the dropdown's own built-in type-to-search
  // still handles narrowing down within whichever page is showing). Returns
  // `total` too, so the caller knows whether Prev/Next should be enabled.
  async function getClaimableBounties(offset = 0) {
    const PAGE_SIZE = 25;
    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT * FROM bounties WHERE status = 'approved' ORDER BY name ASC LIMIT $1 OFFSET $2`,
        [PAGE_SIZE, offset],
      ),
      pool.query(`SELECT COUNT(*) FROM bounties WHERE status = 'approved'`),
    ]);
    return { rows: rows.rows, total: parseInt(count.rows[0].count, 10) };
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
    getRequestArchiveCategory,
    setRequestArchiveCategory,
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
    getHelpTicketCategory,
    setHelpTicketCategory,
    getHelpArchiveCategory,
    setHelpArchiveCategory,
    getHelpStaffRole,
    setHelpStaffRole,
    getHelpStaffUser,
    setHelpStaffUser,
    createBounty,
    getBountyById,
    updateBounty,
    findTitleConflict,
    approveBounty,
    denyBounty,
    cancelBounty,
    setBountyPending,
    setBountyStatus,
    getBounties,
    getClaimableBounties,
    setBoardMessage,
    claimBounty,
  };