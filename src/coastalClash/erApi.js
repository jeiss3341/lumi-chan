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

// Two deliberate exceptions to erApi.js otherwise having zero DB coupling:
// passive diagnostic logging (er_api_call_log) below, and persisting
// circuit-breaker state (see the circuit breaker section further down) so
// it survives a Railway redeploy instead of silently resetting.
const db = require('../db');
const os = require('os');

// Confirmed live on 2026-08-14/15: the ER API block is ORIGIN-specific —
// Railway's outbound IP gets 403 while the exact same key succeeds from a
// developer's own machine at the same moment, every time. That makes
// CALL_ORIGIN load-bearing, not cosmetic: circuit-breaker state (below)
// MUST be scoped per origin, or a trip on Railway's real, blocked IP
// would incorrectly persist into a manual script run from an unblocked
// machine and refuse to even attempt a call that would actually succeed
// — confirmed happening live tonight (scripts/checkStragglers.js run
// from a Mac refused outright, reading Railway's OPEN circuit from the
// shared settings table, despite the Mac never having been blocked once
// all night). RAILWAY_ENVIRONMENT_NAME is auto-injected into every
// Railway-deployed service; its absence means this process is running
// somewhere else.
const CALL_ORIGIN = process.env.RAILWAY_ENVIRONMENT_NAME ? 'railway' : `manual:${os.hostname()}`;

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

// ─────────────────────────────────────────────────────────────────────────
// Request queue + circuit breaker
//
// Confirmed live on 2026-08-14/15 (see er_api_findings memory): the ER API
// returned 403 Forbidden from Railway's outbound IP while the SAME key,
// called from a developer's own machine at the same time, returned 200.
// That rules out the key being invalid and rules out a normal per-key rate
// limit (which would have also throttled the other machine) — it's an
// origin-level block, and every call from the blocked origin fails, not
// just some of them. The old design (manual per-call-site sleeps scattered
// across this file) had a real gap: nothing enforced spacing BETWEEN two
// different top-level phases (e.g. season verification finishing and RP
// refresh starting), only within a single loop. Centralizing every raw
// call through ONE queue closes that gap everywhere at once, and lets a
// circuit breaker sit in exactly one place instead of needing to be
// threaded through every caller.
//
// MIN_REQUEST_GAP_MS — the user's explicit call on 2026-08-15, settled at
// 1100 (tried 3000, then 2000, then 1500, before landing here). The
// original 3000 was chosen out of caution while the 403s looked like they
// might be a volume/pattern-triggered block — going faster would have been
// the wrong direction under that theory. Since then, ER_API_KEY was found
// to be missing from Railway's own environment entirely, which is a much
// simpler explanation for every 403 seen (missing/empty key returns the
// identical 403 Forbidden this API returns for a real block — confirmed
// by testing both cases directly). If that's the actual cause, there was
// never a real behavioral limit to be cautious against. Each player costs
// 2 calls here (fetchUserId + fetchRankRaw, see fetchUserRank below — the
// caller in cull.js doesn't pass a cachedUserId, so both run every pass).
// 1100ms brings a full ~74-90 player pass (~148-180 calls) down to roughly
// ~2.7-3.3 min, comfortably within REFRESH_INTERVAL_MINUTES' 10-min
// cadence (see timer.js).
const MIN_REQUEST_GAP_MS = 1100;

// How long the circuit stays OPEN (refusing all calls) after a 401/403.
// 30 minutes is long enough that a real block has a real chance to lift
// before the next probe, short enough that a false-positive trip doesn't
// sit broken for hours unnoticed. Overridable via env for testing without
// a code change.
const FORBIDDEN_COOLDOWN_MS = Number(process.env.ER_CIRCUIT_COOLDOWN_MS) || 30 * 60 * 1000;

const CIRCUIT_STATE = Object.freeze({
  CLOSED: 'CLOSED', // normal operation
  OPEN: 'OPEN', // refusing all calls until circuitOpenUntil
  HALF_OPEN: 'HALF_OPEN', // cooldown elapsed, one probe request in flight
});

// requestQueue/lastRequestStartedAt are fine staying purely in-memory —
// there's nothing meaningful to resume mid-queue after a restart, spacing
// just starts fresh. circuitState/circuitOpenUntil/circuitReason are
// different: this is exactly the class of bug that already bit
// coastal_clash_refresh_failure_count (timer.js) once — an in-memory-only
// value getting silently wiped by Railway's redeploy-on-every-push
// behavior, which meant a threshold that should trip after sustained
// failures never got the chance to. Persisted to the settings table under
// CIRCUIT_STATE_KEY below so an OPEN circuit survives a redeploy instead
// of quietly resetting to CLOSED and letting the next cycle make a real
// call it would otherwise have skipped.
let requestQueue = Promise.resolve();
let lastRequestStartedAt = 0;
let circuitState = CIRCUIT_STATE.CLOSED;
let circuitOpenUntil = 0;
let circuitReason = null;

// Scoped by CALL_ORIGIN — see its own comment above for why this must
// not be a single shared key across every process that requires this
// file.
const CIRCUIT_STATE_KEY = `coastal_clash_circuit_state:${CALL_ORIGIN}`;

// Loaded lazily (not at module-require time) because db.initDb() may not
// have run yet when this file is first required — index.js/cull.js
// require this module before awaiting initDb() at boot. Runs at most
// once per process; every call to fetchWithTimeout awaits this, but the
// loaded flag makes every call after the first a no-op.
let circuitStateLoaded = false;
async function ensureCircuitStateLoaded() {
  if (circuitStateLoaded) return;
  circuitStateLoaded = true; // set first — a concurrent call must not also load
  try {
    const stored = await db.getSetting(CIRCUIT_STATE_KEY);
    if (!stored) return;
    const parsed = JSON.parse(stored);
    // Only restore an OPEN state whose cooldown hasn't already elapsed —
    // a persisted OPEN with a past openUntil just means the process was
    // down through the whole cooldown with nobody to probe; resuming as
    // CLOSED is correct, the next real call decides fresh from there.
    if (parsed.state === CIRCUIT_STATE.OPEN && parsed.openUntil > Date.now()) {
      circuitState = CIRCUIT_STATE.OPEN;
      circuitOpenUntil = parsed.openUntil;
      circuitReason = parsed.reason;
      console.warn(`[ER API] restored OPEN circuit from settings (across a restart) — still blocked until ${new Date(circuitOpenUntil).toISOString()}`);
    }
  } catch (err) {
    // A failed load shouldn't crash startup — worst case the circuit
    // starts CLOSED and re-learns the real state from the next call.
    console.error('[ER API] failed to load persisted circuit state, starting CLOSED:', err.message);
  }
}

// Fire-and-forget, same convention as logRawCall below — persisting must
// never block or fail the actual API call it's describing.
function persistCircuitState() {
  db.setSetting(CIRCUIT_STATE_KEY, JSON.stringify({ state: circuitState, openUntil: circuitOpenUntil, reason: circuitReason })).catch((err) => {
    console.error('[ER API] failed to persist circuit state:', err.message);
  });
}

function openCircuit(reason) {
  circuitState = CIRCUIT_STATE.OPEN;
  circuitOpenUntil = Date.now() + FORBIDDEN_COOLDOWN_MS;
  circuitReason = reason;
  console.error(`[ER API] circuit OPEN (${reason}) until ${new Date(circuitOpenUntil).toISOString()}`);
  persistCircuitState();
}

function closeCircuit() {
  const recovered = circuitState !== CIRCUIT_STATE.CLOSED;
  circuitState = CIRCUIT_STATE.CLOSED;
  circuitOpenUntil = 0;
  circuitReason = null;
  if (recovered) console.info('[ER API] circuit CLOSED; probe succeeded');
  if (recovered) persistCircuitState();
}

function makeCircuitOpenError() {
  const error = new Error(`ER API circuit is open until ${new Date(circuitOpenUntil).toISOString()}`);
  error.code = 'ER_CIRCUIT_OPEN';
  error.retryAt = new Date(circuitOpenUntil).toISOString();
  error.reason = circuitReason;
  return error;
}

// Both codes mean "stop what you're doing, don't keep looping" — callers
// (refreshAllRP, isSeasonLive) check this to bail out of a whole pass
// immediately instead of continuing to iterate remaining players/candidates
// once the circuit has tripped or a live 401/403 has been seen.
function isCircuitBreakerError(error) {
  return error?.code === 'ER_CIRCUIT_OPEN' || error?.code === 'ER_API_FORBIDDEN';
}

// Exposed for diagnostics (e.g. a manual dry-run script checking circuit
// state before/after a pass) and for timer.js to describe *why* an alert
// is firing.
function getCircuitBreakerState() {
  return {
    state: circuitState,
    reason: circuitReason,
    retryAt: circuitOpenUntil ? new Date(circuitOpenUntil).toISOString() : null,
  };
}

// Every raw HTTP call in this file goes through here — the single choke
// point that makes the queue and circuit breaker apply uniformly, with no
// per-call-site wiring needed. requestQueue is a promise chain: each call
// attaches itself after the previous one settles (success OR failure,
// via the .then(ok, ok) below), so calls are strictly serialized and each
// one waits out MIN_REQUEST_GAP_MS from the previous call's START before
// firing.
function fetchWithTimeout(url, options = {}) {
  const request = requestQueue.then(async () => {
    await ensureCircuitStateLoaded();

    if (circuitState === CIRCUIT_STATE.OPEN) {
      if (Date.now() < circuitOpenUntil) {
        throw makeCircuitOpenError();
      }
      // Cooldown elapsed — allow exactly one request through as a probe.
      // Its outcome (below) decides whether to close the circuit or
      // reopen it for another full cooldown.
      circuitState = CIRCUIT_STATE.HALF_OPEN;
      console.warn('[ER API] circuit HALF_OPEN; allowing one probe request');
    }

    const elapsed = Date.now() - lastRequestStartedAt;
    const waitMs = Math.max(0, MIN_REQUEST_GAP_MS - elapsed);
    if (waitMs > 0) await sleep(waitMs);
    lastRequestStartedAt = Date.now();

    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (response.status === 401 || response.status === 403) {
        openCircuit(`HTTP ${response.status}`);
      } else if (circuitState === CIRCUIT_STATE.HALF_OPEN) {
        closeCircuit();
      }
      return response;
    } catch (error) {
      // A network-level failure (timeout, DNS, etc.) during a probe is
      // treated the same as a 401/403 probe result — re-open rather than
      // silently leaving the circuit HALF_OPEN with no path back to
      // either state.
      if (circuitState === CIRCUIT_STATE.HALF_OPEN) {
        openCircuit(`half-open probe failed: ${error.message}`);
      }
      throw error;
    }
  });

  // Chain the NEXT call off this one regardless of outcome — a failed
  // call must not break the queue for everyone behind it.
  requestQueue = request.then(() => undefined, () => undefined);
  return request;
}

// Passive diagnostic logging (er_api_call_log — see src/db.js) for the ER
// rate-limit investigation. Wired in at this lowest level, not at each
// higher-level caller, specifically so it automatically covers every real
// call anywhere in the codebase (the automatic timer, /apiburst, the
// manual scripts) with no per-call-site wiring needed. Never awaited by
// callers — logging failures must never affect the actual API call.
function logRawCall(endpoint, res, body, durationMs, errorMessage = null) {
  db.logApiCall({
    endpoint,
    responseStatus: res?.status ?? null,
    responseHeaders: res ? Object.fromEntries(res.headers.entries()) : null,
    responseBody: body ?? null,
    errorMessage,
    durationMs,
  });
}

// Turns a 401/403 response into a thrown, taggable error — the circuit
// itself already opened inside fetchWithTimeout the moment the response
// came back, this just stops the CALLER (fetchUserId/fetchRankRaw) from
// treating a Forbidden body as if it were an ordinary "not found" result.
function throwIfForbidden(res) {
  if (!res || (res.status !== 401 && res.status !== 403)) return;
  const error = new Error(`ER API returned HTTP ${res.status}`);
  error.code = 'ER_API_FORBIDDEN';
  error.status = res.status;
  error.retryAt = new Date(circuitOpenUntil).toISOString();
  throw error;
}

// Looks up a player's current userId by nickname. Per the game's own
// changelog, this value is NOT stable — querying the same nickname again
// later can return a different userId (both still resolve to the same
// player, by design, for anti-stalking reasons). Never persist this value
// long-term; look it up fresh each time it's needed.
//
// Retries on 429 (genuine rate-limiting, distinct from the circuit
// breaker's 401/403 handling above) — this endpoint didn't retry at all
// before, unlike fetchRankRaw below, which was an inconsistency rather
// than a deliberate choice.
async function fetchUserId(nickname, maxRetries = 5) {
  const endpoint = `/user/nickname?query=${encodeURIComponent(nickname)}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const callStart = Date.now();
    let res, data;
    try {
      res = await fetchWithTimeout(`${API_URL}${endpoint}`, { headers: { 'x-api-key': API_KEY } });
      data = await res.json();
      logRawCall(endpoint, res, data, Date.now() - callStart);
    } catch (err) {
      // Don't log circuit-open rejections as if they were a real failed
      // call — the request never actually went out.
      if (err.code !== 'ER_CIRCUIT_OPEN') {
        logRawCall(endpoint, res, null, Date.now() - callStart, err.message);
      }
      throw err;
    }

    throwIfForbidden(res);

    if (res.status === 429 || data.message === 'Too Many Requests') {
      if (attempt === maxRetries) return null;
      const waitMs = 5000 * attempt;
      console.warn(`[ER API] nickname lookup rate-limited for ${nickname}; retrying in ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    if (data.code !== 200 || !data.user) return null;
    return data.user.userId;
  }

  return null;
}

// Fetches raw rank data for a player at a given season. matchingTeamMode 3
// is squad/trio ranked, matching hanabi.js's prior convention.
async function fetchRankRaw(userId, seasonId, matchingTeamMode = 3) {
  const endpoint = `/rank/uid/${userId}/${seasonId}/${matchingTeamMode}`;
  const callStart = Date.now();
  let res, data;
  try {
    res = await fetchWithTimeout(`${API_URL}${endpoint}`, { headers: { accept: 'application/json', 'x-api-key': API_KEY } });
    data = await res.json();
    logRawCall(endpoint, res, data, Date.now() - callStart);
  } catch (err) {
    if (err.code !== 'ER_CIRCUIT_OPEN') {
      logRawCall(endpoint, res, null, Date.now() - callStart, err.message);
    }
    throw err;
  }
  throwIfForbidden(res);
  return data;
}

// Fetches raw userRank data for a player at a given season, with retry on
// 429 (increasing backoff, same shape as hanabi.js's
// fetchPlayerMMRWithRetry). Returns null on any unrecoverable failure
// (nickname not found, non-retryable error). This is the shared fetch —
// fetchPlayerRP and isSeasonLive each apply a DIFFERENT interpretation of
// the result below, so neither filter lives in here.
//
// cachedUserId lets callers that already resolved this nickname (e.g.
// isSeasonLive probing multiple candidate seasons for the SAME reference
// players) skip the redundant nickname lookup entirely — fetchUserId
// doesn't depend on season, so re-resolving it per candidate wastes a full
// extra API call for no new information. null is a valid cached value
// (nickname genuinely not found) and short-circuits immediately below.
async function fetchUserRank(nickname, seasonId, maxRetries = 5, cachedUserId = undefined) {
  let userId = cachedUserId;
  if (userId === undefined) {
    userId = await fetchUserId(nickname);
  }
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
// on). The API still returns a carried-over placeholder mmr from the
// prior season even when nobody's queued yet this season (confirmed via
// live testing — see er_api_findings memory), which would otherwise look
// like a real current result. `rank`/`serverRank` both sitting at 0 is the
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
// season some players never actually played can still return a nonzero,
// stale, carried-over mmr with rank/serverRank both 0, which the old
// check couldn't tell apart from a real one. Fixed to require rank or
// serverRank > 0 instead — actual played-this-season activity — same
// signal fetchPlayerRP already uses for "has this specific player played
// yet".
// ─────────────────────────────────────────────────────────────────────────
const SEASON_SETTING_KEY = 'er_season_id';
const MAX_SEASON_PROBE_STEPS = 5;

// Confirmed live in production: fetchUserRank's own 429 retry loop (up to
// 5 attempts, 5s/10s/15s/20s backoff = up to 50s) compounds badly across
// up to 40 reference nicknames when the API is under sustained load —
// deploy logs showed verification stuck on the same step for 10+ minutes
// straight. A hard time budget here caps the damage regardless of the
// underlying cause: if verification can't get a clean answer within it,
// bail out and let the caller treat this cycle as "couldn't verify, try
// again next time" instead of blocking for potentially tens of minutes.
// Shared ACROSS the whole getVerifiedSeasonId call (every candidate season
// probed, not just one isSeasonLive call).
const SEASON_VERIFICATION_BUDGET_MS = 90 * 1000;

// userIdCache is shared ACROSS every candidate season probed within one
// getVerifiedSeasonId call — a nickname's userId doesn't change based on
// which season is being checked, so resolving it once per verification
// pass (instead of once per candidate, up to 6x redundant) cuts real,
// avoidable call volume during exactly the scenario (repeated bailouts)
// that generates the most traffic.
async function isSeasonLive(seasonId, referenceNicknames, deadline, userIdCache) {
  for (const nickname of referenceNicknames) {
    if (Date.now() > deadline) {
      console.error(`Coastal Clash: season-verification time budget exceeded (${SEASON_VERIFICATION_BUDGET_MS}ms) — bailing out early this cycle.`);
      return false;
    }
    try {
      let userId = userIdCache.get(nickname);
      if (userId === undefined) {
        // maxRetries=1 here specifically (not fetchUserId's own default
        // of 5) — this loop only needs ANY one of up to 40 candidates to
        // answer, so failing fast on a 429 and moving to the next
        // candidate beats burning up to 50s of backoff retrying one of
        // them, which could otherwise blow the whole 90s budget on a
        // single nickname.
        userId = await fetchUserId(nickname, 1);
        userIdCache.set(nickname, userId);
      }
      // Same reasoning: maxRetries=1 on the rank lookup too.
      const userRank = await fetchUserRank(nickname, seasonId, 1, userId);
      if (userRank && ((userRank.rank ?? 0) > 0 || (userRank.serverRank ?? 0) > 0)) return true;
    } catch (err) {
      // A tripped circuit means every remaining candidate would fail
      // identically and instantly — no point looping through the rest,
      // let it propagate so the caller (getVerifiedSeasonId → cull.js →
      // timer.js) can alert immediately instead of silently exhausting
      // the reference pool.
      if (isCircuitBreakerError(err)) throw err;
      // Any other single flaky/timed-out reference player shouldn't sink
      // the whole verification pass — move on to the next candidate.
      console.error(`Coastal Clash: season-verification fetch threw for ${nickname}:`, err.message);
    }
  }
  return false;
}

// Confirmed via direct testing that a healthy call resolves in well under
// a second — the season itself doesn't change cycle-to-cycle, so
// re-verifying from scratch with up to 40 API calls every single refresh
// is pure waste. Cache a confirmed-live result for a while and skip
// re-verification entirely until it goes stale.
const VERIFICATION_CACHE_MS = 20 * 60 * 1000;
let cachedVerification = null; // { seasonId, verifiedAt }

// Returns { seasonId, corrected }. `corrected` is true if the stored value
// was stale and this call updated it — callers should treat that as
// alert-worthy.
async function getVerifiedSeasonId(db, referenceNicknames, dryRun = false) {
  const stored = await db.getSetting(SEASON_SETTING_KEY);
  let seasonId = stored ? parseInt(stored, 10) : 40;

  if (cachedVerification && cachedVerification.seasonId === seasonId && Date.now() - cachedVerification.verifiedAt < VERIFICATION_CACHE_MS) {
    return { seasonId, corrected: false };
  }

  const deadline = Date.now() + SEASON_VERIFICATION_BUDGET_MS;
  const userIdCache = new Map();

  if (await isSeasonLive(seasonId, referenceNicknames, deadline, userIdCache)) {
    cachedVerification = { seasonId, verifiedAt: Date.now() };
    return { seasonId, corrected: false };
  }

  for (let step = 1; step <= MAX_SEASON_PROBE_STEPS; step++) {
    if (Date.now() > deadline) break;
    const candidate = seasonId + step;
    if (await isSeasonLive(candidate, referenceNicknames, deadline, userIdCache)) {
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
  fetchUserId,
  fetchRankRaw,
  fetchUserRank,
  fetchPlayerRP,
  SEASON_SETTING_KEY,
  getVerifiedSeasonId,
  isCircuitBreakerError,
  getCircuitBreakerState,
};
