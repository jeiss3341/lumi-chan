// Eternal Return open-api.bser.io client for the Coastal Clash leaderboard.
//
// IMPORTANT: this does NOT reuse project-lumi/commands/hanabi.js's approach.
// That code calls the old /rank/{userNum}/... endpoint, which the game
// retired (userNum was removed from nickname lookups for player-privacy
// reasons, per Nimble Neuron's 9.4 patch notes) — it now 401s unconditionally.
// The current shape is /rank/uid/{userId}/{seasonId}/{mode}, where userId
// comes from the nickname lookup itself. See the memory file
// er_api_findings.md for how this was verified against the live API.
const API_URL = 'https://open-api.bser.io/v1';
const API_KEY = process.env.ER_API_KEY;

// Passive diagnostic logging only (er_api_call_log — see src/db.js). This
// is the one deliberate exception to erApi.js otherwise having zero DB
// coupling — scoped narrowly to logging calls this module already makes,
// never used to gate/alter any actual API call behavior.
const db = require('../db');

// Empirically hit "Too Many Requests" after ~5 rapid calls with no delay.
// This spacing matches hanabi.js's own proven 2.5s convention, rounded up
// slightly for headroom.
const CALL_SPACING_MS = 3000;

// Slightly wider spacing used ONLY by season verification below — that step
// is the one that's actually been bailing out intermittently in production,
// and unlike the main RP-refresh loop it has slack to spare (a 90s budget
// for at most 15 candidates), so trading a bit more time for a bit more
// margin costs nothing there. Left the main loop's CALL_SPACING_MS alone —
// widening that would slow down every single refresh cycle for no evidence
// of benefit, since the main loop isn't the one that's been failing.
const SEASON_VERIFICATION_SPACING_MS = 4000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Node's native fetch has NO default timeout — if the API ever accepts a
// connection but never responds, the call hangs forever with no error,
// silently stalling whatever awaited it (confirmed live: this is what was
// leaving leaderboard_meta stuck for 25+ minutes at a time in production,
// surviving even a container restart, since it can happen again on any
// boot). AbortSignal.timeout forces a clean rejection instead.
const FETCH_TIMEOUT_MS = 10000;

function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

// Looks up a player's current userId by nickname. Per the game's own
// changelog, this value is NOT stable — querying the same nickname again
// later can return a different userId (both still resolve to the same
// player, by design, for anti-stalking reasons). Never persist this value
// long-term; look it up fresh each time it's needed.
async function fetchUserId(nickname) {
  const res = await fetchWithTimeout(`${API_URL}/user/nickname?query=${encodeURIComponent(nickname)}`, {
    headers: { 'x-api-key': API_KEY },
  });
  const data = await res.json();
  if (data.code !== 200 || !data.user) return null;
  return data.user.userId;
}

// Fetches raw rank data for a player at a given season. matchingTeamMode 3
// is squad/trio ranked, matching hanabi.js's prior convention.
async function fetchRankRaw(userId, seasonId, matchingTeamMode = 3) {
  const res = await fetchWithTimeout(`${API_URL}/rank/uid/${userId}/${seasonId}/${matchingTeamMode}`, {
    headers: { accept: 'application/json', 'x-api-key': API_KEY },
  });
  return res.json();
}

// Fetches raw userRank data for a player at a given season, with retry on
// 429 (increasing backoff, same shape as hanabi.js's
// fetchPlayerMMRWithRetry). Returns null on any unrecoverable failure
// (nickname not found, non-retryable error). This is the shared fetch —
// fetchPlayerRP and isSeasonLive each apply a DIFFERENT interpretation of
// the result below, so neither filter lives in here.
// Small gap between the nickname lookup and the rank lookup below — these
// are two separate HTTP requests to the API with zero delay between them
// otherwise, regardless of how much spacing sits between different players'
// calls. If the API's limit is sensitive to back-to-back bursts (not just
// average rate over time), this pair firing instantly, every single player,
// could be tripping it independent of CALL_SPACING_MS/
// SEASON_VERIFICATION_SPACING_MS above.
const INTER_CALL_GAP_MS = 500;

async function fetchUserRank(nickname, seasonId, maxRetries = 5) {
  const userId = await fetchUserId(nickname);
  if (!userId) return null;
  await sleep(INTER_CALL_GAP_MS);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const data = await fetchRankRaw(userId, seasonId);
    if (data.code === 200 && data.userRank) {
      return data.userRank;
    }
    if (data.message === 'Too Many Requests') {
      const waitMs = 5000 * attempt;
      await sleep(waitMs);
      continue;
    }
    // Any other error (401, unexpected shape) — don't retry, it won't
    // resolve itself, and burning retries here just delays everyone else's
    // fetch in the same pass.
    return null;
  }
  return null;
}

// Fetches a player's current RP (the userRank.mmr field — misleadingly
// named by the API, but confirmed via the leaderboard mockup to be the
// value Coastal Clash actually displays and ranks by).
//
// Returns { rp, notPlayedYet } rather than a bare number — callers need
// to tell "hasn't played enough games THIS season" (rp: null,
// notPlayedYet: true — normal, expected, NOT alert-worthy) apart from an
// actual fetch failure (rp: null, notPlayedYet: false — worth alerting
// on). The API still returns a carried-over placeholder mmr from season
// 39 even when nobody's queued yet this season (confirmed via live
// testing — see er_api_findings memory), which would otherwise look like
// a real current result. `rank`/`serverRank` both sitting at 0 is the
// signal that nothing's actually been played yet; either going non-zero
// means real games are in. This filter is deliberately NOT applied
// inside fetchUserRank/isSeasonLive above — season DETECTION needs to
// see the carried-over placeholder (that's how a just-started season is
// told apart from one that doesn't exist yet at all); only the
// player-facing RP/display value needs the "actually played" filter.
async function fetchPlayerRP(nickname, seasonId, maxRetries = 5) {
  const userRank = await fetchUserRank(nickname, seasonId, maxRetries);
  if (!userRank) return { rp: null, notPlayedYet: false };
  const hasPlayedThisSeason = (userRank.rank ?? 0) > 0 || (userRank.serverRank ?? 0) > 0;
  if (!hasPlayedThisSeason) return { rp: null, notPlayedYet: true };
  return { rp: userRank.mmr ?? 0, notPlayedYet: false };
}

// ─────────────────────────────────────────────────────────────────────────
// Season ID — stored in Postgres (settings table), never hardcoded in
// source. /data/Season is unmaintained by the game (stale, capped years in
// the past — see er_api_findings.md) so there is no metadata endpoint that
// can answer "what season is live right now." Instead: trust the stored
// value, but verify it against real reference players before each use, and
// self-correct (walking forward a few IDs) if it looks stale.
//
// Originally checked mmr > 0 alone (a season that hasn't started returns
// completely zeroed data, including mmr, so any nonzero mmr looked like a
// live season's soft-reset baseline). That broke in practice: a dead
// season some players never actually played (confirmed live — see
// er_api_findings memory) can still return a nonzero, stale, carried-over
// mmr with rank/serverRank both 0, which the old check couldn't tell
// apart from a real one. Fixed to require rank or serverRank > 0 instead —
// actual played-this-season activity — same signal fetchPlayerRP already
// uses for "has this specific player played yet". By the time this
// verification runs at all (days into a live event, checking 10 random
// active players), real activity from at least one of them is a safe
// assumption — this isn't trying to catch "season live, zero games played
// by anyone yet" anymore, which was the point of the old mmr-only check.
// ─────────────────────────────────────────────────────────────────────────
const SEASON_SETTING_KEY = 'er_season_id';
const MAX_SEASON_PROBE_STEPS = 5;

// Confirmed live in production: fetchUserRank's own 429 retry loop (up to
// 5 attempts, 5s/10s/15s/20s backoff = up to 50s) compounds badly across
// up to 40 reference nicknames when the API is under sustained load —
// deploy logs showed verification stuck on the same step for 10+ minutes
// straight, across multiple separate refresh cycles, never completing.
// A hard time budget here caps the damage regardless of the underlying
// cause: if verification can't get a clean answer within it, bail out and
// let the caller treat this cycle as "couldn't verify, try again next
// time" (already a handled, graceful path) instead of blocking for
// potentially tens of minutes. Shared ACROSS the whole getVerifiedSeasonId
// call (every candidate season probed, not just one isSeasonLive call) —
// confirmed live that without this, a bad stretch chains multiple ~90s
// bailouts back to back (one per candidate season) into several minutes.
const SEASON_VERIFICATION_BUDGET_MS = 90 * 1000;

async function isSeasonLive(seasonId, referenceNicknames, deadline) {
  for (const nickname of referenceNicknames) {
    if (Date.now() > deadline) {
      console.error(`Coastal Clash: season-verification time budget exceeded (${SEASON_VERIFICATION_BUDGET_MS}ms) — bailing out early this cycle.`);
      return false;
    }
    const callStart = Date.now();
    try {
      // maxRetries=1 (no 429 backoff retries) — this only needs ANY one
      // of up to 40 candidates to answer, so failing fast and moving to
      // the next candidate beats burning up to 50s retrying one of them.
      const userRank = await fetchUserRank(nickname, seasonId, 1);
      const outcome = userRank ? 'ok' : 'no_userrank';
      db.logApiCall('season_verification', nickname, outcome, Date.now() - callStart);
      if (userRank && ((userRank.rank ?? 0) > 0 || (userRank.serverRank ?? 0) > 0)) return true;
    } catch (err) {
      // A single flaky/timed-out reference player shouldn't sink the
      // whole verification pass — move on to the next candidate.
      console.error(`Coastal Clash: season-verification fetch threw for ${nickname}:`, err.message);
      db.logApiCall('season_verification', nickname, `error: ${err.message}`, Date.now() - callStart);
    }
    await sleep(SEASON_VERIFICATION_SPACING_MS);
  }
  return false;
}

// Confirmed via direct testing that a healthy call resolves in well under
// a second — the season itself doesn't change cycle-to-cycle, so
// re-verifying from scratch with up to 40 API calls every single 10-min
// refresh is pure waste (and, per the theory above, likely a real
// contributor to whatever's rate-limiting Railway's outbound IP). Cache a
// confirmed-live result for a while and skip re-verification entirely
// until it goes stale.
const VERIFICATION_CACHE_MS = 20 * 60 * 1000;
let cachedVerification = null; // { seasonId, verifiedAt }

// Returns { seasonId, corrected }. `corrected` is true if the stored value
// was stale and this call updated it — callers should treat that as
// alert-worthy (DM the DM alert path we already wired for fetch failures).
async function getVerifiedSeasonId(db, referenceNicknames, dryRun = false) {
  const stored = await db.getSetting(SEASON_SETTING_KEY);
  let seasonId = stored ? parseInt(stored, 10) : 40;

  if (cachedVerification && cachedVerification.seasonId === seasonId && Date.now() - cachedVerification.verifiedAt < VERIFICATION_CACHE_MS) {
    return { seasonId, corrected: false };
  }

  const deadline = Date.now() + SEASON_VERIFICATION_BUDGET_MS;

  if (await isSeasonLive(seasonId, referenceNicknames, deadline)) {
    cachedVerification = { seasonId, verifiedAt: Date.now() };
    return { seasonId, corrected: false };
  }

  for (let step = 1; step <= MAX_SEASON_PROBE_STEPS; step++) {
    if (Date.now() > deadline) break;
    const candidate = seasonId + step;
    if (await isSeasonLive(candidate, referenceNicknames, deadline)) {
      if (!dryRun) await db.setSetting(SEASON_SETTING_KEY, String(candidate));
      cachedVerification = { seasonId: candidate, verifiedAt: Date.now() };
      return { seasonId: candidate, corrected: true };
    }
  }

  // Nothing found forward — don't silently guess. Caller must handle null
  // (this should alert, not proceed with a made-up season).
  return { seasonId: null, corrected: false };
}

module.exports = {
  sleep,
  CALL_SPACING_MS,
  fetchUserId,
  fetchRankRaw,
  fetchUserRank,
  fetchPlayerRP,
  SEASON_SETTING_KEY,
  getVerifiedSeasonId,
};
