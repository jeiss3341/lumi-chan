// Discord OAuth2 login for the style-guide admin page. No new dependencies —
// global fetch (Node 18+, see package.json engines) handles the Discord API
// calls, and the built-in crypto module signs the session cookie.
//
// "Authorized" means: the logged-in Discord user's ID is in ADMIN_USER_IDS
// (a comma-separated env var) — a plain, explicit allowlist, independent of
// the bounty/claim/help staff settings.
const crypto = require('crypto');

const SESSION_COOKIE = 'lumi_session';
const STATE_COOKIE = 'oauth_state';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} for Discord login.`);
  return value;
}

// ── Cookies ──────────────────────────────────────────────────────────────

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

// `Secure` is only set when the request actually arrived over HTTPS (Railway
// terminates TLS in front and sets x-forwarded-proto) — plain localhost
// keeps working without HTTPS.
function setCookie(res, req, name, value, { maxAgeSeconds } = {}) {
  const secure = req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
  res.setHeader('Set-Cookie', [...(res.getHeader('Set-Cookie') || []), parts.join('; ')]);
}

function clearCookie(res, req, name) {
  setCookie(res, req, name, '', { maxAgeSeconds: 0 });
}

// ── Session signing ──────────────────────────────────────────────────────

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', requiredEnv('SESSION_SECRET')).update(payloadB64).digest('base64url');
}

function signSession({ id, username }) {
  const payload = JSON.stringify({ id, username, exp: Date.now() + SESSION_TTL_MS });
  const payloadB64 = base64url(payload);
  return `${payloadB64}.${sign(payloadB64)}`;
}

// Returns the decoded { id, username, exp } if the cookie is present, well
// formed, correctly signed, and unexpired — otherwise null.
function verifySession(cookieValue) {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf('.');
  if (dot === -1) return null;
  const payloadB64 = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (typeof session.exp !== 'number' || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function getSession(req) {
  return verifySession(parseCookies(req)[SESSION_COOKIE]);
}

// ── Discord OAuth2 ───────────────────────────────────────────────────────

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: requiredEnv('DISCORD_CLIENT_ID'),
    redirect_uri: requiredEnv('DISCORD_REDIRECT_URI'),
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'consent',
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: requiredEnv('DISCORD_CLIENT_ID'),
    client_secret: requiredEnv('DISCORD_CLIENT_SECRET'),
    grant_type: 'authorization_code',
    code,
    redirect_uri: requiredEnv('DISCORD_REDIRECT_URI'),
  });
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Discord token exchange failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

async function fetchDiscordUser(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord user fetch failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { id: json.id, username: json.username };
}

// Checks the logged-in Discord user's ID against ADMIN_USER_IDS.
function isAuthorized(userId) {
  const allowlist = requiredEnv('ADMIN_USER_IDS').split(',').map((id) => id.trim()).filter(Boolean);
  return allowlist.includes(userId);
}

module.exports = {
  SESSION_COOKIE,
  STATE_COOKIE,
  parseCookies,
  setCookie,
  clearCookie,
  signSession,
  getSession,
  buildAuthorizeUrl,
  exchangeCode,
  fetchDiscordUser,
  isAuthorized,
};
