// A tiny HTTP server, separate from the Discord client, that serves the
// public style-guide page (src/styleGuide/styleGuide.js) and handles saving edits made
// through its per-unit forms. No framework — plain Node http + the built-in
// URLSearchParams for form-body parsing, since this is a handful of routes,
// not an app.
//
// Railway assigns PORT; locally it falls back to 3000. Binding to a port
// also means two bot instances running at once (see the recurring 10062
// duplicate-process issue) will now fail loudly with EADDRINUSE on startup
// instead of silently racing each other on Discord interactions.
//
// Gated behind Discord or Google OAuth login (src/styleGuide/auth.js) —
// every route below requires a valid session except /login, /login/discord,
// /auth/callback, /login/google, /auth/google/callback, and /logout
// themselves.
const http = require('http');
const crypto = require('crypto');
const { buildStyleGuideHtml, buildLoginPageHtml } = require('./styleGuide');
const overrides = require('./overrides');
const fieldSchema = require('./fieldSchema');
const qandaTopics = require('./qandaTopics');
const auth = require('./auth');
const bountyRoutes = require('./bountyRoutes');
const ticketRoutes = require('./ticketRoutes');
const { readBody, redirectTo } = require('./httpUtil');

// `session` is always present here — every caller runs after the auth gate
// in startServer() below.
function renderPage(req, res, status, session, options) {
  const html = buildStyleGuideHtml({ ...options, username: session.username });
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// POST /edit/:unitId — saves one of the 17 static units, or a
// `qanda-topic-<id>` unit (fieldSchema.unitFields handles both shapes).
async function handleEditUnit(req, res, session, unitId) {
  const fields = fieldSchema.unitFields(unitId);
  if (fields.length === 0) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found.');
    return;
  }

  try {
    const body = await readBody(req);
    const attempted = Object.fromEntries(new URLSearchParams(body));
    const { valid, errors } = fieldSchema.validate(unitId, attempted);

    if (!valid) {
      renderPage(req, res, 400, session, { failure: { unitId, attempted, errors } });
      return;
    }

    // Only write the fields that actually belong to (and were just
    // validated for) this unit — attempted may carry extra keys from a
    // hand-crafted POST that were never checked against fieldSchema.
    await overrides.setMany(fields.map((f) => [f.path, attempted[f.path]]));
    redirectTo(res, `/?saved=${encodeURIComponent(unitId)}#unit-${encodeURIComponent(unitId)}`);
  } catch (err) {
    handleSaveError(res, err);
  }
}

// POST /qanda/topics — adds a brand-new topic. No unit id exists yet, so
// this validates against plain field names (fieldSchema.validateNewTopic),
// not full QANDA.topics.<id>.* paths.
async function handleAddTopic(req, res, session) {
  // Read the body once, up front — req is a stream, and it can't be
  // re-read from a catch block below if something later throws.
  let attempted;
  try {
    const body = await readBody(req);
    attempted = Object.fromEntries(new URLSearchParams(body));
  } catch (err) {
    handleSaveError(res, err);
    return;
  }

  const { valid, errors } = fieldSchema.validateNewTopic(attempted);
  if (!valid) {
    renderPage(req, res, 400, session, { addTopicFailure: { attempted, errors } });
    return;
  }

  try {
    const id = await qandaTopics.addTopic(attempted);
    redirectTo(res, `/?saved=${encodeURIComponent(`qanda-topic-${id}`)}#unit-qanda-topic-${encodeURIComponent(id)}`);
  } catch (err) {
    if (err.message.includes('capped at')) {
      // The 25-topic cap — surface it the same way a validation error would,
      // attached to the label field so it's visible right where "Add" is.
      renderPage(req, res, 400, session, {
        addTopicFailure: { attempted, errors: [{ path: 'label', label: 'Dropdown label', message: err.message }] },
      });
      return;
    }
    handleSaveError(res, err);
  }
}

// POST /qanda/topics/:id/delete — removes a topic from the order list (see
// src/styleGuide/qandaTopics.js — never touches text.js, and a default topic can
// always be re-added by hand later since its text.js entry still exists).
async function handleRemoveTopic(req, res, id) {
  try {
    const removed = await qandaTopics.removeTopic(id);
    if (!removed) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('That topic no longer exists.');
      return;
    }
    redirectTo(res, '/');
  } catch (err) {
    handleSaveError(res, err);
  }
}

function handleSaveError(res, err) {
  if (err.message === 'BODY_TOO_LARGE') {
    res.writeHead(413, { 'Content-Type': 'text/plain' });
    res.end('That submission was too large.');
    return;
  }
  console.error('Style guide save failed:', err);
  res.writeHead(500, { 'Content-Type': 'text/plain' });
  res.end('Something went wrong saving your changes.');
}

function handleGetPage(req, res, session) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const savedSection = url.searchParams.get('saved') || undefined;
    renderPage(req, res, 200, session, { savedSection });
  } catch (err) {
    console.error('Failed to build style guide page:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Something went wrong rendering the style guide.');
  }
}

function textPage(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function loginPageRedirect(res, error) {
  redirectTo(res, `/login?error=${encodeURIComponent(error)}`, 302);
}

// GET /login — the branded landing page (src/styleGuide/styleGuide.js
// buildLoginPageHtml), with a "Continue with Discord" button. Its own
// failures (e.g. missing env config) render inline rather than kicking off
// anything with Discord.
function handleLoginPage(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const error = url.searchParams.get('error') || undefined;
  const html = buildLoginPageHtml({ error });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// GET /login/discord — the actual OAuth kickoff, reached by clicking the
// button on the login page. A random `state` guards against CSRF: it's
// stashed in a short-lived cookie and checked back against the callback's
// query param.
function handleStartDiscordLogin(req, res) {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    auth.setCookie(res, req, auth.STATE_COOKIE, state, { maxAgeSeconds: 300 });
    redirectTo(res, auth.buildAuthorizeUrl(state), 302);
  } catch (err) {
    console.error('Failed to start Discord login:', err);
    loginPageRedirect(res, "Login isn't configured yet — missing Discord OAuth settings.");
  }
}

// GET /auth/callback — exchanges the code, checks the logged-in Discord user
// against ADMIN_USER_IDS (src/styleGuide/auth.js isAuthorized), and either
// sets a session cookie or bounces back to /login with an explanation.
async function handleAuthCallback(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const cookies = auth.parseCookies(req);

    if (error) {
      loginPageRedirect(res, `Discord login was cancelled (${error}). Try again if that wasn't intended.`);
      return;
    }
    if (!code || !state || !cookies[auth.STATE_COOKIE] || state !== cookies[auth.STATE_COOKIE]) {
      loginPageRedirect(res, 'Login failed — the request expired or was tampered with. Try again.');
      return;
    }
    auth.clearCookie(res, req, auth.STATE_COOKIE);

    const accessToken = await auth.exchangeCode(code);
    const discordUser = await auth.fetchDiscordUser(accessToken);

    if (!auth.isAuthorized(discordUser.id)) {
      loginPageRedirect(
        res,
        `You're logged in as ${discordUser.username}, but that Discord account isn't on the admin allowlist for this page.`,
      );
      return;
    }

    auth.setCookie(res, req, auth.SESSION_COOKIE, auth.signSession(discordUser), { maxAgeSeconds: 7 * 24 * 60 * 60 });
    redirectTo(res, '/', 302);
  } catch (err) {
    console.error('Discord login failed:', err);
    loginPageRedirect(res, 'Something went wrong talking to Discord. Try again in a moment.');
  }
}

// GET /login/google — same shape as handleStartDiscordLogin, reused
// oauth_state cookie is fine since only one login flow is ever in flight
// per browser at a time.
function handleStartGoogleLogin(req, res) {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    auth.setCookie(res, req, auth.STATE_COOKIE, state, { maxAgeSeconds: 300 });
    redirectTo(res, auth.buildGoogleAuthorizeUrl(state), 302);
  } catch (err) {
    console.error('Failed to start Google login:', err);
    loginPageRedirect(res, "Google login isn't configured yet — missing Google OAuth settings.");
  }
}

// GET /auth/google/callback — same shape as handleAuthCallback, checked
// against ADMIN_GOOGLE_EMAILS instead of ADMIN_USER_IDS.
async function handleGoogleAuthCallback(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const cookies = auth.parseCookies(req);

    if (error) {
      loginPageRedirect(res, `Google login was cancelled (${error}). Try again if that wasn't intended.`);
      return;
    }
    if (!code || !state || !cookies[auth.STATE_COOKIE] || state !== cookies[auth.STATE_COOKIE]) {
      loginPageRedirect(res, 'Login failed — the request expired or was tampered with. Try again.');
      return;
    }
    auth.clearCookie(res, req, auth.STATE_COOKIE);

    const accessToken = await auth.exchangeGoogleCode(code);
    const googleUser = await auth.fetchGoogleUser(accessToken);

    if (!auth.isGoogleAuthorized(googleUser.email)) {
      loginPageRedirect(
        res,
        `You're logged in as ${googleUser.email}, but that Google account isn't on the admin allowlist for this page.`,
      );
      return;
    }

    auth.setCookie(res, req, auth.SESSION_COOKIE, auth.signSession(googleUser), { maxAgeSeconds: 7 * 24 * 60 * 60 });
    redirectTo(res, '/', 302);
  } catch (err) {
    console.error('Google login failed:', err);
    loginPageRedirect(res, 'Something went wrong talking to Google. Try again in a moment.');
  }
}

function handleLogout(req, res) {
  auth.clearCookie(res, req, auth.SESSION_COOKIE);
  redirectTo(res, '/', 302);
}

function startServer(client) {
  const port = process.env.PORT || 3000;

  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];

    if (req.method === 'GET' && path === '/login') {
      handleLoginPage(req, res);
      return;
    }
    if (req.method === 'GET' && path === '/login/discord') {
      handleStartDiscordLogin(req, res);
      return;
    }
    if (req.method === 'GET' && path === '/auth/callback') {
      handleAuthCallback(req, res);
      return;
    }
    if (req.method === 'GET' && path === '/login/google') {
      handleStartGoogleLogin(req, res);
      return;
    }
    if (req.method === 'GET' && path === '/auth/google/callback') {
      handleGoogleAuthCallback(req, res);
      return;
    }
    if (req.method === 'GET' && path === '/logout') {
      handleLogout(req, res);
      return;
    }

    const session = auth.getSession(req);
    if (!session) {
      if (req.method === 'GET') {
        redirectTo(res, '/login', 302);
      } else {
        // A POST with no/expired session can only be a stale form (or a
        // direct request) — send them to log back in rather than 401ing.
        redirectTo(res, '/login', 303);
      }
      return;
    }

    if (req.method === 'GET' && (path === '/' || path === '/style-guide')) {
      handleGetPage(req, res, session);
      return;
    }

    if (req.method === 'POST' && path.startsWith('/edit/')) {
      handleEditUnit(req, res, session, path.slice('/edit/'.length));
      return;
    }

    if (req.method === 'POST' && path === '/qanda/topics') {
      handleAddTopic(req, res, session);
      return;
    }

    const deleteMatch = path.match(/^\/qanda\/topics\/([^/]+)\/delete$/);
    if (req.method === 'POST' && deleteMatch) {
      handleRemoveTopic(req, res, decodeURIComponent(deleteMatch[1]));
      return;
    }

    if (req.method === 'GET' && path === '/bounties') {
      bountyRoutes.handleBountiesList(req, res, session, client);
      return;
    }
    if (req.method === 'GET' && path === '/bounties/new') {
      bountyRoutes.handleNewBountyPage(res, session);
      return;
    }
    if (req.method === 'POST' && path === '/bounties/new') {
      bountyRoutes.handleCreateBounty(req, res, session, client);
      return;
    }

    const bountyIdMatch = path.match(/^\/bounties\/(\d+)\/(edit|status)$/);
    if (bountyIdMatch) {
      const [, idStr, action] = bountyIdMatch;
      const id = Number(idStr);
      if (req.method === 'GET' && action === 'edit') {
        bountyRoutes.handleEditBountyPage(req, res, session, client, id);
        return;
      }
      if (req.method === 'POST' && action === 'edit') {
        bountyRoutes.handleEditBounty(req, res, session, client, id);
        return;
      }
      if (req.method === 'POST' && action === 'status') {
        bountyRoutes.handleChangeBountyStatus(req, res, session, client, id);
        return;
      }
    }

    if (req.method === 'GET' && path === '/tickets') {
      ticketRoutes.handleTicketsList(req, res, session, client);
      return;
    }
    if (req.method === 'POST' && path === '/tickets/archive-settings') {
      ticketRoutes.handleSaveArchiveSettings(req, res);
      return;
    }
    // Discord channel IDs are 64-bit snowflakes — always handled as strings,
    // never Number()'d (unlike bounty ids above), since they'd lose
    // precision past Number.MAX_SAFE_INTEGER.
    const ticketIdMatch = path.match(/^\/tickets\/(\d+)$/);
    if (req.method === 'GET' && ticketIdMatch) {
      ticketRoutes.handleTicketDetail(req, res, session, client, ticketIdMatch[1]);
      return;
    }

    res.writeHead(req.method === 'GET' ? 404 : 405, { 'Content-Type': 'text/plain' });
    res.end(req.method === 'GET' ? 'Not found.' : 'Method Not Allowed');
  });

  server.on('error', (err) => {
    console.error('Style guide server failed to start:', err.message);
  });

  server.listen(port, () => {
    console.log(`Style guide server listening on port ${port}`);
  });

  return server;
}

module.exports = { startServer };
