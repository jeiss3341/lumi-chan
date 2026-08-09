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
// No auth yet (deliberately deferred — see the warning banner on the page
// itself). Anyone with the URL can save edits right now.
const http = require('http');
const { buildStyleGuideHtml } = require('./styleGuide');
const overrides = require('./overrides');
const fieldSchema = require('./fieldSchema');
const qandaTopics = require('./qandaTopics');

// Caps how much a single submission can contain — generous for even the
// biggest unit's form, stingy for abuse.
const MAX_BODY_BYTES = 200_000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function renderPage(res, status, options) {
  const html = buildStyleGuideHtml(options);
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function redirectTo(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}

// POST /edit/:unitId — saves one of the 17 static units, or a
// `qanda-topic-<id>` unit (fieldSchema.unitFields handles both shapes).
async function handleEditUnit(req, res, unitId) {
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
      renderPage(res, 400, { failure: { unitId, attempted, errors } });
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
async function handleAddTopic(req, res) {
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
    renderPage(res, 400, { addTopicFailure: { attempted, errors } });
    return;
  }

  try {
    const id = await qandaTopics.addTopic(attempted);
    redirectTo(res, `/?saved=${encodeURIComponent(`qanda-topic-${id}`)}#unit-qanda-topic-${encodeURIComponent(id)}`);
  } catch (err) {
    if (err.message.includes('capped at')) {
      // The 25-topic cap — surface it the same way a validation error would,
      // attached to the label field so it's visible right where "Add" is.
      renderPage(res, 400, {
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

function handleGetPage(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const savedSection = url.searchParams.get('saved') || undefined;
    renderPage(res, 200, { savedSection });
  } catch (err) {
    console.error('Failed to build style guide page:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Something went wrong rendering the style guide.');
  }
}

function startServer() {
  const port = process.env.PORT || 3000;

  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];

    if (req.method === 'GET' && (path === '/' || path === '/style-guide')) {
      handleGetPage(req, res);
      return;
    }

    if (req.method === 'POST' && path.startsWith('/edit/')) {
      handleEditUnit(req, res, path.slice('/edit/'.length));
      return;
    }

    if (req.method === 'POST' && path === '/qanda/topics') {
      handleAddTopic(req, res);
      return;
    }

    const deleteMatch = path.match(/^\/qanda\/topics\/([^/]+)\/delete$/);
    if (req.method === 'POST' && deleteMatch) {
      handleRemoveTopic(req, res, decodeURIComponent(deleteMatch[1]));
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
