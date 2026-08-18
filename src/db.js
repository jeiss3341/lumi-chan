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

    await pool.query(`
      CREATE INDEX IF NOT EXISTS er_api_call_log_called_at_idx
      ON er_api_call_log (called_at);
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

    // group_type: 'solo' | 'premade' — whether a premade group is allowed to
    // complete this bounty together, or it must be done alone. Collected
    // straight from the player at request time, shown on the bounty card.
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS group_type TEXT;`);

    // claim_type: 'claim' | 'submissions' — which of the two claim-ticket
    // categories this bounty's claim opens under (see getSubmissionsTicketCategory
    // above). Staff-only, set during approval — unset/legacy bounties fall
    // back to 'claim' wherever this is read (see index.js claim_proof_modal).
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS claim_type TEXT;`);

    // reward used to be NUMERIC (dollars-only) — it's free text now, since
    // rewards can be anything ("250 NP", "5 gems", not just cash). Safe to
    // rerun every boot: casting TEXT to TEXT is a no-op once already migrated.
    await pool.query(`ALTER TABLE bounties ALTER COLUMN reward TYPE TEXT USING reward::TEXT;`);

    // Submission-type bounties (claim_type = 'submissions') stay open and
    // track a current "leader" instead of finalizing on the first approved
    // claim — see setLeader/setSubmissionMetric below. submission_metric_*
    // is set once, at the original bounty's approval; leader_* tracks
    // whoever's currently ahead, including which archived ticket
    // (channel+message) represents them, so a later claim that displaces
    // them knows exactly what to reopen. All null/unused for claim_type =
    // 'claim' bounties.
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS submission_metric_kind TEXT;`);
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS submission_metric_label TEXT;`);
    // Set once at approval time (buildApproveModalStep2's expiry picker) —
    // 11:59:59 PM PDT on whichever event day staff picked, same moment as
    // daily culling (see schedule.js's cullMomentForDay). Null means never
    // expires. Nothing currently sweeps bounties past this automatically —
    // it's read-only display for now (see bountyCard.js's Expires field).
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;`);
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS leader_id TEXT;`);
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS leader_value TEXT;`);
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS leader_ticket_channel_id TEXT;`);
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS leader_ticket_message_id TEXT;`);
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS leader_set_at TIMESTAMPTZ;`);
    // Comma-separated Discord ids of the leader's premade teammates (Add
    // Premade on their claim ticket), if any — carried here so the
    // submissions board post and the eventual finalized card
    // (/endsubmissions) can show them too, not just the ticket itself. Null
    // for a solo claim.
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS leader_teammates TEXT;`);

    // The leader's own claim notes (claim_proof_modal's text field — becomes
    // the claim ticket embed's description, see buildClaimEmbed) — carried
    // here the same way leader_teammates is, so the live standing card can
    // show what the current leader actually submitted as proof, not just
    // their score. Text only, deliberately — no file/image URLs (Discord
    // CDN attachment links can go stale over time; the ticket itself is
    // still the durable record of any uploaded files).
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS leader_proof TEXT;`);

    // The LIVE leaderboard post in the submissions board channel — distinct
    // from board_channel_id/board_message_id, which is always the plain,
    // never-edited-again "Bounty Approved" record in the request board
    // (same meaning for both claim_type='claim' and 'submissions' bounties).
    // These two stay null until the first claim is approved (see
    // promoteSubmissionLeader) — nothing sits in the submissions channel for
    // a bounty nobody's submitted to yet — then get edited in place on every
    // leader change, and deleted once the bounty is finalized
    // (announceSubmissionBountyPublicly).
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS submissions_board_channel_id TEXT;`);
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS submissions_board_message_id TEXT;`);

    // True once a closed submissions bounty's result has actually been
    // posted publicly (board post deleted from the live submissions
    // channel, "Bounty Closed" card logged to #claimed) — /endsubmissions
    // is the only thing that ever sets status='claimed' for a submissions
    // bounty, and it flips this in the same pass, for every bounty where
    // it's still false (a previous run only got as far as closing before
    // failing — see finalizeSubmissionBountyPrivately). Lets
    // /endsubmissions tell "already closed, just needs announcing" bounties
    // apart from "still open, needs closing AND announcing" ones. Always
    // false/irrelevant for claim_type='claim' bounties, which never had a
    // private/public split to begin with.
    await pool.query(`ALTER TABLE bounties ADD COLUMN IF NOT EXISTS submissions_finalized BOOLEAN NOT NULL DEFAULT false;`);

    // Coastal Clash player leaderboard — lives in this same Postgres instance
    // (shared with project-lumi's leaderboard site) but wasn't previously
    // created by any code; it existed only because someone added it by hand
    // in Railway's dashboard. IF NOT EXISTS means this is a no-op there,
    // and just formalizes the schema for local/future environments.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        name        TEXT PRIMARY KEY,
        region      TEXT NOT NULL DEFAULT '',
        twitch      TEXT NOT NULL DEFAULT '',
        youtube     TEXT NOT NULL DEFAULT '',
        mmr         INTEGER NOT NULL DEFAULT 0,
        culled      BOOLEAN NOT NULL DEFAULT false,
        indanger    BOOLEAN NOT NULL DEFAULT false,
        youtubelive BOOLEAN NOT NULL DEFAULT false,
        twitchlive  BOOLEAN NOT NULL DEFAULT false,
        ispro       BOOLEAN NOT NULL DEFAULT true
      );
    `);

    // Twitch tracking data lives in its OWN table, deliberately kept OUT
    // of players — that table is the exact shared contract project-lumi's
    // site queries directly (SELECT name, region, ..., ispro AS "isPro"
    // FROM players), and the user's explicit call was not to touch its
    // schema for internal bot-only bookkeeping. name is not a hard
    // foreign key (players existed before any code managed it — see
    // comment above — so this stays loosely coupled by convention, not
    // a DB-enforced constraint).
    //   title: the CURRENT stream title (shown on the "Live Now" post).
    //   last_game: the category as of the last check — detects a SWITCH
    //     into Eternal Return (not just "is live") for /deployliveupdate.
    //   announced_at: when they last triggered an announcement — the
    //     30-min cooldown (refreshTwitchLiveStatus) checks this so a
    //     stream crash-and-restart doesn't re-announce the same session.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS twitch_status (
        name         TEXT PRIMARY KEY,
        title        TEXT NOT NULL DEFAULT '',
        last_game    TEXT NOT NULL DEFAULT '',
        announced_at TIMESTAMPTZ
      );
    `);
    // live_twitch_url: whichever of a player's channels (players.twitch, or
    // their player_extra_twitch row below) was actually detected live on
    // the most recent check — the Live Now board/announcements link to
    // THIS, not blindly to players.twitch, so a player streaming on their
    // secondary channel gets linked correctly instead of to their (offline)
    // primary one. Null until the first check that finds them live.
    await pool.query(`ALTER TABLE twitch_status ADD COLUMN IF NOT EXISTS live_twitch_url TEXT;`);

    // Passive diagnostic log for the ER API rate-limit investigation —
    // records the raw request + response for every REAL call the bot
    // already makes (any fetchUserId/fetchRankRaw call, wherever it comes
    // from — the automatic timer, /apiburst, or the manual scripts), not
    // extra probing traffic. Matches Ilyfue's suggestion for his own bot
    // (flat errorlog.txt, 2 lines per call — request then response,
    // checked back on after a few hours) but as a table instead of a
    // file, since Railway's filesystem is ephemeral across redeploys and
    // a flat file wouldn't survive that. response_headers is included
    // specifically in case the API sends a rate-limit header we haven't
    // been looking at (e.g. a remaining-quota or retry-after value).
    // request_headers deliberately excludes the actual x-api-key value —
    // never log secrets. Temporary — meant to be queried by hand while
    // diagnosing, safe to drop once the investigation's done.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS er_api_call_log (
        id               SERIAL PRIMARY KEY,
        called_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        endpoint         TEXT NOT NULL,
        response_status  INTEGER,
        response_headers JSONB,
        response_body    JSONB,
        error_message    TEXT,
        duration_ms      INTEGER
      );
    `);

    // A second Twitch channel for players who stream from more than one
    // account (e.g. Neotep). Same reasoning as player_igns — kept as its
    // own table rather than a second column on players, since that
    // table's schema is project-lumi's read contract. Optional: most
    // players have no row here at all, and refreshTwitchLiveStatus treats
    // that as "no secondary channel", not an error.
    //
    // primary_twitch: a STABLE copy of the player's real primary channel,
    // captured once when their secondary channel is registered. Needed
    // because refreshTwitchLiveStatus now actively overwrites players.twitch
    // itself (swapping it to the secondary URL while that's the one live,
    // and back again otherwise) — project-lumi's site reads players.twitch
    // directly with no changes on their end, so making that field the
    // "correct channel right now" was the only way to get the live channel
    // to show there without touching their code. Once players.twitch can
    // be swapped, it's no longer safe to treat it as "the real primary" —
    // this column is the actual source of truth for that.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS player_extra_twitch (
        name           TEXT PRIMARY KEY,
        twitch         TEXT NOT NULL,
        primary_twitch TEXT
      );
    `);
    await pool.query(`ALTER TABLE player_extra_twitch ADD COLUMN IF NOT EXISTS primary_twitch TEXT;`);

    // Maps a player's display name (players.name — shown everywhere,
    // including project-lumi's site) to their actual Eternal Return IGN,
    // for the rare case those two differ (e.g. someone named "Quip" whose
    // in-game nickname is literally "AFK"). Same reasoning as twitch_status
    // above — kept as its own table rather than a column on players, since
    // that table's schema is project-lumi's read contract. Defaults to
    // matching name for everyone; self-heals on every boot for any player
    // added since (players isn't exclusively managed by this bot's code —
    // see comment above).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS player_igns (
        name TEXT PRIMARY KEY,
        ign  TEXT NOT NULL
      );
    `);
    // Dak.gg profile link — a Postgres GENERATED column, not a plain text
    // field, deliberately: it's always derived fresh from ign, so it can
    // never go stale the way a stored copy could (exactly the class of bug
    // that blocked an entire day's cull — see cull.js/timer.js history
    // around 2026-08-16, one player's stale ign silently broke everything
    // downstream of it). Correcting ign here automatically keeps dak
    // correct too, with no extra code anywhere. project-lumi's read
    // contract (same pattern as players.twitch, leaderboard_meta) — this
    // table's schema is what Ilyfue's site queries directly.
    await pool.query(`
      ALTER TABLE player_igns
      ADD COLUMN IF NOT EXISTS dak TEXT GENERATED ALWAYS AS ('https://dak.gg/er/players/' || ign) STORED;
    `);
    await pool.query(`
      INSERT INTO player_igns (name, ign)
      SELECT name, name FROM players
      ON CONFLICT (name) DO NOTHING;
    `);
    // Renamed from er_nicknames right after introducing it, before it had
    // any real data — drop the old empty one so it doesn't linger.
    await pool.query(`DROP TABLE IF EXISTS er_nicknames;`);

    // Single-row table exposing the schedule/countdown data that ONLY
    // lives inside this bot process's own code (src/coastalClash/schedule.js)
    // otherwise — the project-lumi site has no way to know "when's the
    // next cull" or "when was this last refreshed" without this. Written
    // by every refresh cycle (src/coastalClash/cull.js), read directly by
    // the site's own Postgres query — same shared-database pattern as
    // players, just its own table rather than bolting onto that one.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leaderboard_meta (
        id              INTEGER PRIMARY KEY DEFAULT 1,
        last_updated_at TIMESTAMPTZ,
        next_cull_at    TIMESTAMPTZ,
        CONSTRAINT single_row CHECK (id = 1)
      );
    `);

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

  // A second active category for claim tickets, alongside the one above —
  // which one a given bounty's claim ticket opens in is decided per-bounty
  // (bounties.claim_type, set by staff during approval), but both share the
  // same board channel and archive category, so only this category differs.
  function getSubmissionsTicketCategory() {
    return getSetting('submissions_ticket_category');
  }

  function setSubmissionsTicketCategory(categoryId) {
    return setSetting('submissions_ticket_category', categoryId);
  }

  // A third active category, alongside the two above — for claim_type =
  // 'community' tickets specifically, so they don't get mixed in with
  // regular claim tickets while pending review. Same board/staff config as
  // the other two; only the active category (here) and the eventual
  // archive category (getCommunityArchiveCategory) differ.
  function getCommunityTicketCategory() {
    return getSetting('community_ticket_category');
  }

  function setCommunityTicketCategory(categoryId) {
    return setSetting('community_ticket_category', categoryId);
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

  // A third public channel, specifically for submission-type bounties — this
  // is where an approved submissions bounty's card lives (instead of the
  // regular request board) and gets edited in place as the current leader
  // changes, since unlike a normal claim it doesn't finalize on the first
  // approval.
  function getSubmissionsBoardChannel() {
    return getSetting('submissions_board_channel');
  }

  function setSubmissionsBoardChannel(channelId) {
    return setSetting('submissions_board_channel', channelId);
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

  // Community-type claims (claim_type = 'community') archive to their own
  // separate category instead of claim_archive_category above — staff
  // collects them here for an external vote (Google Form/Discord poll,
  // not built into the bot), so they need to stay easy to browse as their
  // own group rather than mixed in with regular resolved claims.
  function getCommunityArchiveCategory() {
    return getSetting('community_archive_category');
  }

  function setCommunityArchiveCategory(categoryId) {
    return setSetting('community_archive_category', categoryId);
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

  // Coastal Clash leaderboard — same channel+message-id pattern as the
  // bounty board (getBoardChannel/setBoardMessage), but Pro and Casual are
  // fully independent: separate commands (/deployproleaderboard,
  // /deploycasualleaderboard), each with its own channel and message-id
  // setting (keyed by bracket), so they can live in different channels
  // entirely. The 30-min refresh timer and daily cull
  // (src/coastalClash/timer.js) edit each bracket's message in place in
  // whichever channel it was deployed to.
  function getLeaderboardChannel(bracket) {
    return getSetting(`coastal_clash_leaderboard_channel_${bracket}`);
  }

  function setLeaderboardChannel(bracket, channelId) {
    return setSetting(`coastal_clash_leaderboard_channel_${bracket}`, channelId);
  }

  function getLeaderboardMessageId(bracket) {
    return getSetting(`coastal_clash_leaderboard_message_${bracket}`);
  }

  function setLeaderboardMessageId(bracket, messageId) {
    return setSetting(`coastal_clash_leaderboard_message_${bracket}`, messageId);
  }

  // Called when someone manually deletes a bracket's leaderboard message
  // (index.js's messageDelete listener) — clears BOTH the channel and
  // message id so the refresh timer treats that bracket as "not deployed"
  // and stays quiet, instead of auto-recreating the message on the next
  // cycle (the old behavior: postOrUpdateBracketMessage falls back to
  // posting fresh whenever the stored message id fails to fetch).
  async function clearLeaderboardDeployment(bracket) {
    await clearSetting(`coastal_clash_leaderboard_channel_${bracket}`);
    await clearSetting(`coastal_clash_leaderboard_message_${bracket}`);
  }

  // "Live Now" post — a single message (not per-bracket) listing everyone
  // currently streaming, edited in place by the same refresh cycle that
  // updates twitchlive (src/coastalClash/cull.js refreshTwitchLiveStatus).
  function getLiveNowChannel() {
    return getSetting('coastal_clash_livenow_channel');
  }

  function setLiveNowChannel(channelId) {
    return setSetting('coastal_clash_livenow_channel', channelId);
  }

  function getLiveNowMessageId() {
    return getSetting('coastal_clash_livenow_message');
  }

  function setLiveNowMessageId(messageId) {
    return setSetting('coastal_clash_livenow_message', messageId);
  }

  // Same manual-delete-means-stop behavior as clearLeaderboardDeployment
  // above, for the Live Now board.
  async function clearLiveNowDeployment() {
    await clearSetting('coastal_clash_livenow_channel');
    await clearSetting('coastal_clash_livenow_message');
  }

  // "Eliminated — Live Now" — same idea as Live Now above, separate board,
  // separate message, for culled players still streaming (buildEliminated-
  // LiveNowEmbed, src/coastalClash/embed.js). No rank/RP tracked here,
  // same as that embed — neither means anything post-elimination.
  function getEliminatedLiveNowChannel() {
    return getSetting('coastal_clash_eliminatedlive_channel');
  }

  function setEliminatedLiveNowChannel(channelId) {
    return setSetting('coastal_clash_eliminatedlive_channel', channelId);
  }

  function getEliminatedLiveNowMessageId() {
    return getSetting('coastal_clash_eliminatedlive_message');
  }

  function setEliminatedLiveNowMessageId(messageId) {
    return setSetting('coastal_clash_eliminatedlive_message', messageId);
  }

  async function clearEliminatedLiveNowDeployment() {
    await clearSetting('coastal_clash_eliminatedlive_channel');
    await clearSetting('coastal_clash_eliminatedlive_message');
  }

  // "Live Update" announcement feed — a NEW message per stream that
  // switches into the Eternal Return category (src/coastalClash/cull.js
  // refreshLiveAnnouncements), not an edited-in-place status board like
  // Live Now above. No message-id tracking needed since nothing ever
  // gets edited, only posted.
  function getLiveAnnounceChannel() {
    return getSetting('coastal_clash_liveannounce_channel');
  }

  function setLiveAnnounceChannel(channelId) {
    return setSetting('coastal_clash_liveannounce_channel', channelId);
  }

  // Whether the ER API's season-40 data is treated as real, meaningful
  // current-season standing yet. Defaults OFF: the API technically returns
  // data for season 40 (carried-over placement MMR from season 39 — see
  // er_api_findings memory), but the user's explicit call is that this
  // does NOT count as "season 40 is out" for ranking purposes. While off,
  // refreshAllRP (src/coastalClash/cull.js) skips calling the ER API
  // entirely — cull/indanger logic still runs on whatever mmr is already
  // stored (0 until this is flipped on). Flip on once real season-40
  // standing should start being pulled for real.
  function getSeasonLive() {
    return getSetting('coastal_clash_season_live');
  }

  function setSeasonLive(isLive) {
    return setSetting('coastal_clash_season_live', isLive ? 'true' : 'false');
  }

  // /daychange and /dayprevious (TEST ONLY, index.js) edit this SAME
  // status message in place on every run, instead of each click posting a
  // brand new reply — same edit-in-place pattern as the leaderboard
  // messages. Channel is whichever channel a command was most recently
  // run in; message id is per-channel would be overkill for a testing
  // tool, so this is intentionally a single global slot.
  function getDayChangeStatusMessage() {
    return getSetting('coastal_clash_daychange_status_message');
  }

  function setDayChangeStatusMessage(channelId, messageId) {
    return setSetting('coastal_clash_daychange_status_message', `${channelId}:${messageId}`);
  }

  // Upserts the single leaderboard_meta row — called every refresh cycle
  // (src/coastalClash/cull.js) so project-lumi's site always has a fresh
  // "last updated" and an accurate "next cull" to count down to, both
  // sourced from this bot's own schedule logic that the site otherwise
  // has no visibility into at all.
  // startedAt is the cycle's START time, not "now" — the caller only
  // invokes this once the cycle has actually finished successfully (see
  // updateLeaderboardMeta in cull.js), but the timestamp stored reflects
  // when data-gathering began, not when it wrapped up. A full cycle takes
  // several minutes now, so stamping the finish time would overstate
  // freshness — the earliest players fetched are already that many
  // minutes stale by the time the cycle completes.
  // startedAt = null means "don't touch last_updated_at" — next_cull_at is
  // pure calendar math and should always stay current, but last_updated_at
  // must only advance when RP was ACTUALLY refreshed. Writing both together
  // unconditionally made the leaderboard claim fresh data during an outage
  // (and while season_live was paused), since the cycle still ran and still
  // rewrote the timestamp without fetching anything.
  async function setLeaderboardMeta(nextCullAt, startedAt) {
    await pool.query(
      `INSERT INTO leaderboard_meta (id, last_updated_at, next_cull_at)
       VALUES (1, $2, $1)
       ON CONFLICT (id) DO UPDATE SET
         last_updated_at = COALESCE(EXCLUDED.last_updated_at, leaderboard_meta.last_updated_at),
         next_cull_at = EXCLUDED.next_cull_at`,
      [nextCullAt, startedAt],
    );
  }

  // The only supported way to register a player's secondary Twitch
  // channel — always captures primary_twitch atomically from their
  // CURRENT players.twitch at the same time. That capture is load-bearing
  // (refreshTwitchLiveStatus actively overwrites players.twitch once a
  // secondary exists, and needs a stable, never-overwritten copy of the
  // real primary to swap back to) — doing this by hand risks skipping it,
  // which silently corrupts players.twitch after the first live-on-
  // secondary cycle (confirmed happening in testing). COALESCE on
  // primary_twitch means calling this again later to update just the
  // secondary channel won't clobber an already-captured primary.
  async function setPlayerExtraTwitch(name, secondaryTwitch) {
    await pool.query(
      `INSERT INTO player_extra_twitch (name, twitch, primary_twitch)
       SELECT $1, $2, twitch FROM players WHERE name = $1
       ON CONFLICT (name) DO UPDATE SET
         twitch = EXCLUDED.twitch,
         primary_twitch = COALESCE(player_extra_twitch.primary_twitch, EXCLUDED.primary_twitch)`,
      [name, secondaryTwitch],
    );
  }

  // See er_api_call_log's CREATE TABLE comment above for why this exists.
  // Fire-and-forget by design — a logging failure should never break the
  // actual API call it's describing, so callers don't need to await this
  // strictly or wrap it in their own try/catch.
  async function logApiCall({ endpoint, responseStatus, responseHeaders, responseBody, errorMessage, durationMs }) {
    try {
      await pool.query(
        `INSERT INTO er_api_call_log (endpoint, response_status, response_headers, response_body, error_message, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [endpoint, responseStatus ?? null, responseHeaders ?? null, responseBody ?? null, errorMessage ?? null, durationMs],
      );
    } catch (err) {
      console.error('Failed to write er_api_call_log row:', err.message);
    }
  }

  // Keeps er_api_call_log from growing unbounded now that a failed cycle
  // sweeps the full active roster (~74 rows) instead of just the ~15
  // reference players. "Cycle" is detected by time gaps — a new one starts
  // whenever more than 2 minutes pass between consecutive logged calls
  // (real cycles are 10 min apart and internally rapid-fire, so this
  // cleanly separates them without needing to pass a cycle ID around).
  // Called at the end of each refresh cycle — never awaited strictly by
  // callers, same fire-and-forget reasoning as logApiCall above.
  async function pruneApiCallLog() {
    try {
      await pool.query(`
        DELETE FROM er_api_call_log
        WHERE called_at < NOW() - INTERVAL '24 hours'
      `);
    } catch (err) {
      console.error('Failed to prune er_api_call_log:', err.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Coastal Clash players (admin site — src/styleGuide/leaderboardRoutes.js)
  // ─────────────────────────────────────────────────────────────────────────────

  // bracket: 'pro' | 'casual' | 'all'. Active players first (by RP desc),
  // eliminated ones after — same ordering logic as the Discord embed
  // (src/coastalClash/embed.js) so the admin page and the live leaderboard
  // never disagree about ordering.
  async function getPlayers(bracket = 'all') {
    if (bracket === 'all') {
      const result = await pool.query(`SELECT * FROM players ORDER BY ispro DESC, culled ASC, mmr DESC, name ASC`);
      return result.rows;
    }
    const result = await pool.query(
      `SELECT * FROM players WHERE ispro = $1 ORDER BY culled ASC, mmr DESC, name ASC`,
      [bracket === 'pro'],
    );
    return result.rows;
  }

  async function getPlayerByName(name) {
    const result = await pool.query('SELECT * FROM players WHERE name = $1', [name]);
    return result.rows[0] ?? null;
  }

  // Free-form update of the admin-editable fields — region/twitch/youtube
  // (player info) plus culled/indanger/ispro (staff override, e.g.
  // reversing a mistaken elimination or fixing a wrong bracket). mmr and
  // the live-stream flags are NOT editable here — they're written only by
  // the automated pipeline (src/coastalClash/cull.js refreshAllRP), since
  // hand-editing RP would silently desync from the real API standing.
  async function updatePlayer(name, { region, twitch, youtube, culled, indanger, ispro }) {
    const result = await pool.query(
      `UPDATE players SET region = $2, twitch = $3, youtube = $4, culled = $5, indanger = $6, ispro = $7
       WHERE name = $1 RETURNING *`,
      [name, region ?? '', twitch ?? '', youtube ?? '', culled, indanger, ispro],
    );
    return result.rows[0] ?? null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Bounty records
  // ─────────────────────────────────────────────────────────────────────────────

  // Insert a new bounty as 'pending' when the ticket is created. Returns its id
  // so we can bake it into the Approve/Deny buttons.
  async function createBounty({ name, description, reward, requesterId, donatorName, groupType }) {
    const result = await pool.query(
      `INSERT INTO bounties (name, description, reward, requester_id, donator_name, group_type, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      RETURNING id`,
      [name, description, reward, requesterId, donatorName ?? null, groupType ?? null],
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
  async function updateBounty(id, { name, description, reward, donatorName, prizeType, tier, groupType, claimType }) {
    await pool.query(
      `UPDATE bounties SET name = $2, description = $3, reward = $4, donator_name = $5, prize_type = $6, tier = $7, group_type = $8, claim_type = $9 WHERE id = $1`,
      [id, name, description, reward, donatorName ?? null, prizeType ?? null, tier ?? null, groupType ?? null, claimType ?? null],
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

  // Same idea as setBoardMessage, for the separate live submissions-board
  // post (see the column comments in initDb()) — called once, the moment
  // the first claim is approved, to record where that post landed.
  async function setSubmissionsBoardMessage(id, channelId, messageId) {
    await pool.query(
      `UPDATE bounties SET submissions_board_channel_id = $2, submissions_board_message_id = $3 WHERE id = $1`,
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

  // One-time write, from the new approve-modal step 3 (submissions bounties
  // only) — defines what this bounty's leaderboard is tracking. Never
  // touched again after this.
  async function setSubmissionMetric(id, { kind, label }) {
    await pool.query(
      `UPDATE bounties SET submission_metric_kind = $2, submission_metric_label = $3 WHERE id = $1`,
      [id, kind, label],
    );
  }

  // One-time write, from the approve-modal's expiry day-picker. `expiresAt`
  // is null for a non-expiring bounty (the common case) — never touched
  // again after approval.
  async function setBountyExpiry(id, expiresAt) {
    await pool.query(`UPDATE bounties SET expires_at = $2 WHERE id = $1`, [id, expiresAt]);
  }

  // Polled by index.js's expiry sweep (runs every few minutes) — every
  // still-open bounty whose expires_at has passed. 'approved' only:
  // claimed/denied/cancelled/expired bounties are already resolved, an
  // expires_at on one of those (shouldn't normally happen, but if staff
  // set one before a claim came in) is just inert leftover data.
  async function getExpiredBounties() {
    const result = await pool.query(
      `SELECT * FROM bounties WHERE status = 'approved' AND expires_at IS NOT NULL AND expires_at <= NOW()`,
    );
    return result.rows;
  }

  // Flips an expired bounty to 'expired' — same compare-and-swap guard as
  // setBountyStatus (only lands if it's still 'approved'), so a claim that
  // sneaks in between the sweep's SELECT and this UPDATE doesn't get
  // silently overwritten to expired out from under it. actorId is null —
  // this is a system action, not a staff member's.
  async function setBountyExpired(id) {
    return setBountyStatus(id, 'expired', null, 'approved');
  }

  // Promotes a submission claim to current leader. Guarded on 'approved' —
  // same reasoning as claimBounty above (someone else finalizing/closing the
  // bounty in between shouldn't get silently overwritten). Returns the
  // updated row PLUS previous_leader_id/previous_leader_ticket_channel_id/
  // previous_leader_ticket_message_id (whoever/whatever this just displaced,
  // read from the same statement's initial snapshot via the `old` CTE below
  // — a subquery inside RETURNING would instead see the row post-update,
  // which is the wrong thing here), or null if the guard failed.
  async function setLeader(id, { leaderId, value, ticketChannelId, ticketMessageId, teammates, proof }) {
    const result = await pool.query(
      `WITH old AS (
         SELECT leader_id, leader_ticket_channel_id, leader_ticket_message_id
         FROM bounties WHERE id = $1
       ),
       updated AS (
         UPDATE bounties SET leader_id = $2, leader_value = $3, leader_ticket_channel_id = $4,
           leader_ticket_message_id = $5, leader_teammates = $6, leader_proof = $7, leader_set_at = NOW()
         WHERE id = $1 AND status = 'approved'
         RETURNING *
       )
       SELECT updated.*, old.leader_id AS previous_leader_id,
         old.leader_ticket_channel_id AS previous_leader_ticket_channel_id,
         old.leader_ticket_message_id AS previous_leader_ticket_message_id
       FROM updated, old`,
      [id, leaderId, value ?? null, ticketChannelId, ticketMessageId, teammates?.length ? teammates.join(',') : null, proof || null],
    );
    return result.rows[0] ?? null;
  }

  // Every submissions-type bounty /endsubmissions still needs to touch —
  // either still open (status='approved') or closed already from a
  // previous partial run (status='claimed') but not yet publicly
  // announced. Once submissions_finalized is true a bounty never shows up
  // here again.
  async function getUnfinalizedSubmissionBounties() {
    const result = await pool.query(
      `SELECT * FROM bounties
       WHERE claim_type = 'submissions' AND submissions_finalized = false AND status IN ('approved', 'claimed')
       ORDER BY COALESCE(approved_at, created_at) ASC`,
    );
    return result.rows;
  }

  // Marks a submissions bounty's public result as posted — /endsubmissions'
  // last step for each bounty it processes, so re-running it is a no-op for
  // anything already announced.
  async function markSubmissionsFinalized(id) {
    await pool.query(`UPDATE bounties SET submissions_finalized = true WHERE id = $1`, [id]);
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
    getSubmissionsTicketCategory,
    setSubmissionsTicketCategory,
    getCommunityTicketCategory,
    setCommunityTicketCategory,
    getClaimStaffRole,
    setClaimStaffRole,
    getClaimStaffUser,
    setClaimStaffUser,
    getClaimBoardChannel,
    setClaimBoardChannel,
    getSubmissionsBoardChannel,
    setSubmissionsBoardChannel,
    getClaimArchiveCategory,
    setClaimArchiveCategory,
    getCommunityArchiveCategory,
    setCommunityArchiveCategory,
    getHelpTicketCategory,
    setHelpTicketCategory,
    getHelpArchiveCategory,
    setHelpArchiveCategory,
    getHelpStaffRole,
    setHelpStaffRole,
    getHelpStaffUser,
    setHelpStaffUser,
    getLeaderboardChannel,
    setLeaderboardChannel,
    getLeaderboardMessageId,
    setLeaderboardMessageId,
    clearLeaderboardDeployment,
    getLiveNowChannel,
    setLiveNowChannel,
    getLiveNowMessageId,
    setLiveNowMessageId,
    clearLiveNowDeployment,
    getEliminatedLiveNowChannel,
    setEliminatedLiveNowChannel,
    getEliminatedLiveNowMessageId,
    setEliminatedLiveNowMessageId,
    clearEliminatedLiveNowDeployment,
    getLiveAnnounceChannel,
    setLiveAnnounceChannel,
    setLeaderboardMeta,
    setPlayerExtraTwitch,
    logApiCall,
    pruneApiCallLog,
    getSeasonLive,
    setSeasonLive,
    getDayChangeStatusMessage,
    setDayChangeStatusMessage,
    getPlayers,
    getPlayerByName,
    updatePlayer,
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
    setSubmissionsBoardMessage,
    claimBounty,
    setSubmissionMetric,
    setBountyExpiry,
    getExpiredBounties,
    setBountyExpired,
    setLeader,
    getUnfinalizedSubmissionBounties,
    markSubmissionsFinalized,
  };