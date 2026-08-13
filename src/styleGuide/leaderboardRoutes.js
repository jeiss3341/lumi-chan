// Route handlers for the Coastal Clash leaderboard admin page (list /
// edit) — same split as bountyRoutes.js/bounties.js: this file does the
// DB work, src/styleGuide/leaderboard.js does the HTML. Unlike bounties,
// this never touches the live Discord client directly — the leaderboard
// messages are kept in sync by the existing timer
// (src/coastalClash/timer.js), not by this admin page.
const { getPlayers, getPlayerByName, updatePlayer } = require('../db');
const { buildLeaderboardListHtml, buildPlayerEditHtml } = require('./leaderboard');
const { readBody } = require('./httpUtil');

const VALID_BRACKETS = ['all', 'pro', 'casual'];

function handleLeaderboardError(res, err) {
  if (err.message === 'BODY_TOO_LARGE') {
    res.writeHead(413, { 'Content-Type': 'text/plain' });
    res.end('That submission was too large.');
    return;
  }
  console.error('Leaderboard admin action failed:', err);
  res.writeHead(500, { 'Content-Type': 'text/plain' });
  res.end('Something went wrong.');
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Player not found.');
}

function renderPage(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function handleLeaderboardList(req, res, session) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const bracketParam = url.searchParams.get('bracket') || 'all';
    const filterBracket = VALID_BRACKETS.includes(bracketParam) ? bracketParam : 'all';
    const savedName = url.searchParams.get('saved');

    const players = await getPlayers(filterBracket);
    const message = savedName ? { text: `Saved changes for ${savedName}.` } : undefined;

    renderPage(res, 200, buildLeaderboardListHtml({ players, filterBracket, username: session.username, message }));
  } catch (err) {
    handleLeaderboardError(res, err);
  }
}

async function handlePlayerEditPage(req, res, session, name) {
  try {
    const player = await getPlayerByName(name);
    if (!player) {
      notFound(res);
      return;
    }
    renderPage(res, 200, buildPlayerEditHtml({ player, username: session.username }));
  } catch (err) {
    handleLeaderboardError(res, err);
  }
}

async function handleEditPlayer(req, res, session, name) {
  try {
    const player = await getPlayerByName(name);
    if (!player) {
      notFound(res);
      return;
    }

    const body = await readBody(req);
    const fields = Object.fromEntries(new URLSearchParams(body));

    await updatePlayer(name, {
      region: (fields.region ?? '').slice(0, 10),
      twitch: fields.twitch ?? '',
      youtube: fields.youtube ?? '',
      ispro: fields.ispro === 'true',
      culled: fields.culled === 'true',
      indanger: fields.indanger === 'true',
    });

    res.writeHead(303, { Location: `/leaderboard?saved=${encodeURIComponent(name)}` });
    res.end();
  } catch (err) {
    handleLeaderboardError(res, err);
  }
}

module.exports = { handleLeaderboardList, handlePlayerEditPage, handleEditPlayer };
