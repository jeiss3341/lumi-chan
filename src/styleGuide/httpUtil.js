// Tiny framework-free helpers shared by src/styleGuide/server.js and
// src/styleGuide/bountyRoutes.js — kept in their own module so neither of
// those two has to require the other.
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

function redirectTo(res, location, status = 303) {
  res.writeHead(status, { Location: location });
  res.end();
}

module.exports = { readBody, redirectTo, MAX_BODY_BYTES };
