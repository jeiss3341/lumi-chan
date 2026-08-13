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

// Empirically hit "Too Many Requests" after ~5 rapid calls with no delay.
// This spacing matches hanabi.js's own proven 2.5s convention, rounded up
// slightly for headroom.
const CALL_SPACING_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Looks up a player's current userId by nickname. Per the game's own
// changelog, this value is NOT stable — querying the same nickname again
// later can return a different userId (both still resolve to the same
// player, by design, for anti-stalking reasons). Never persist this value
// long-term; look it up fresh each time it's needed.
async function fetchUserId(nickname) {
  const res = await fetch(`${API_URL}/user/nickname?query=${encodeURIComponent(nickname)}`, {
    headers: { 'x-api-key': API_KEY },
  });
  const data = await res.json();
  if (data.code !== 200 || !data.user) return null;
  return data.user.userId;
}

// Fetches raw rank data for a player at a given season. matchingTeamMode 3
// is squad/trio ranked, matching hanabi.js's prior convention.
async function fetchRankRaw(userId, seasonId, matchingTeamMode = 3) {
  const res = await fetch(`${API_URL}/rank/uid/${userId}/${seasonId}/${matchingTeamMode}`, {
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
async function fetchUserRank(nickname, seasonId, maxRetries = 5) {
  const userId = await fetchUserId(nickname);
  if (!userId) return null;

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
// A season that hasn't started yet returns completely zeroed data (mmr=0
// too, not just rank=0) for every player. A season that's live — even one
// that JUST started, with no ranked games played yet — still carries each
// player's previous-season MMR as a soft-reset baseline (rank/serverRank
// are 0, but mmr is not). That distinction is what isSeasonLive checks.
// ─────────────────────────────────────────────────────────────────────────
const SEASON_SETTING_KEY = 'er_season_id';
const MAX_SEASON_PROBE_STEPS = 5;

async function isSeasonLive(seasonId, referenceNicknames) {
  for (const nickname of referenceNicknames) {
    const userRank = await fetchUserRank(nickname, seasonId);
    await sleep(CALL_SPACING_MS);
    if (userRank && (userRank.mmr ?? 0) > 0) return true;
  }
  return false;
}

// Returns { seasonId, corrected }. `corrected` is true if the stored value
// was stale and this call updated it — callers should treat that as
// alert-worthy (DM the DM alert path we already wired for fetch failures).
async function getVerifiedSeasonId(db, referenceNicknames, dryRun = false) {
  const stored = await db.getSetting(SEASON_SETTING_KEY);
  let seasonId = stored ? parseInt(stored, 10) : 40;

  if (await isSeasonLive(seasonId, referenceNicknames)) {
    return { seasonId, corrected: false };
  }

  for (let step = 1; step <= MAX_SEASON_PROBE_STEPS; step++) {
    const candidate = seasonId + step;
    if (await isSeasonLive(candidate, referenceNicknames)) {
      if (!dryRun) await db.setSetting(SEASON_SETTING_KEY, String(candidate));
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
