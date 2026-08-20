// Twitch Helix client for the Coastal Clash live-status checker. Unlike
// the ER API (one player per call, 3s spacing to dodge rate limits),
// Helix's /streams endpoint accepts up to 100 user_login values in ONE
// request — the whole ~74-player roster fits in a single call, so this
// can run every refresh cycle with no rate-limit concern at all.
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const HELIX_BATCH_SIZE = 100;

// Eternal Return's Twitch category id — confirmed live via
// GET /helix/games?name=Eternal%20Return (name: "Eternal Return", stable
// id, doesn't need a lookup call every cycle).
const ETERNAL_RETURN_GAME_ID = '512864';

// App access token (client-credentials grant — no user login involved,
// the OAuth Redirect URL on the Twitch app doesn't matter for this flow
// at all). Lasts ~60 days, well past this event's ~17-day run, so an
// in-memory cache for the process lifetime is enough — no need to
// persist it in settings like the ER season ID.
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAppAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Twitch token exchange failed: ${data.message || res.status}`);
  }

  cachedToken = data.access_token;
  // Refresh 5 minutes early rather than cutting it exactly at expiry.
  cachedTokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;
  return cachedToken;
}

// Pulls the bare login handle out of whatever's stored in players.twitch
// — real data in this table is inconsistent ("twitch.tv/name",
// "https://www.twitch.tv/name", trailing slashes) since it was hand-typed
// by players, not validated. Returns null for an empty/unusable value.
function extractTwitchLogin(rawUrl) {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  const match = trimmed.match(/twitch\.tv\/([^/?#]+)/i);
  const login = match ? match[1] : trimmed.replace(/^@/, '');
  return login ? login.toLowerCase() : null;
}

// Queries live status for a batch of logins (<=100) in one call. Returns
// a Map of login -> { title, gameId } for CURRENTLY live streams — Helix
// only ever returns entries for streams that are actually live, so
// anyone not in the response is simply offline. gameId is Twitch's raw
// category id (see ETERNAL_RETURN_GAME_ID) — callers compare against
// that themselves rather than this module hardcoding what "counts".
async function fetchLiveLoginsBatch(logins) {
  if (!logins.length) return new Map();

  const token = await getAppAccessToken();
  const params = new URLSearchParams();
  for (const login of logins) params.append('user_login', login);

  const res = await fetch(`https://api.twitch.tv/helix/streams?${params.toString()}`, {
    headers: { 'Client-Id': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.data) {
    throw new Error(`Twitch streams query failed: ${data.message || res.status}`);
  }

  return new Map(data.data.map((stream) => [
    stream.user_login.toLowerCase(),
    // user_name is the streamer's actual Twitch display name — can differ
    // from their Coastal Clash roster name (players.name), which the "is
    // now live" announcement used to show instead, confirmed live to be
    // wrong for at least one player (S6Aemeath's roster name vs. their
    // real Twitch handle, Shayyxy).
    { title: stream.title, gameId: stream.game_id, gameName: stream.game_name, twitchDisplayName: stream.user_name },
  ]));
}

// Handles the >100-login case by chunking, even though the current ~74
// player roster never actually needs more than one batch.
async function fetchLiveLogins(logins) {
  const live = new Map();
  for (let i = 0; i < logins.length; i += HELIX_BATCH_SIZE) {
    const chunk = logins.slice(i, i + HELIX_BATCH_SIZE);
    const chunkLive = await fetchLiveLoginsBatch(chunk);
    for (const [login, info] of chunkLive) live.set(login, info);
  }
  return live;
}

module.exports = { getAppAccessToken, extractTwitchLogin, fetchLiveLogins, ETERNAL_RETURN_GAME_ID };
