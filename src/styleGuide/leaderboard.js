// Builds the HTML for the Coastal Clash leaderboard admin pages (list,
// edit) — same split as bounties.js/bountyRoutes.js: this file only turns
// already-resolved data into HTML, leaderboardRoutes.js does the DB work.
const { esc, BASE_STYLES, topBar } = require('./styleGuide');

function statusBadge(player) {
  if (player.culled) return `<span class="status-badge status-eliminated">Eliminated</span>`;
  if (player.indanger) return `<span class="status-badge status-indanger">In Danger</span>`;
  return `<span class="status-badge status-active">Active</span>`;
}

function bracketBadge(isPro) {
  return `<span class="bracket-badge ${isPro ? 'bracket-pro' : 'bracket-casual'}">${isPro ? 'Pro' : 'Casual'}</span>`;
}

function liveIcons(player) {
  const parts = [];
  if (player.twitchlive) parts.push('<span class="live-dot" title="Live on Twitch">🟣 Twitch</span>');
  if (player.youtubelive) parts.push('<span class="live-dot" title="Live on YouTube">🔴 YouTube</span>');
  return parts.length ? parts.join(' ') : '';
}

function pageShell({ title, username, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lumi-chan — ${esc(title)}</title>
<style>
${BASE_STYLES}
  .wrap { max-width: 1000px; margin: 0 auto; padding: 0 28px 120px; }
  .masthead { padding: 44px 0 28px; border-bottom: 1px solid var(--line); }
  .masthead .eyebrow {
    font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12.5px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--accent-ink); margin: 0 0 12px;
  }
  .masthead h1 { font-size: 30px; }
  .masthead p.sub { margin: 12px 0 0; max-width: 62ch; color: var(--ink-soft); font-size: 15.5px; }
  .toast {
    max-width: 1000px; margin: 20px auto 0; padding: 12px 18px; border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 16%, var(--paper-raised)); color: var(--accent-ink);
    font-weight: 600; font-size: 14px; text-align: center;
  }
  .toast.warn { background: var(--warn-bg); color: var(--warn); }
  .filter-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 24px 0; }
  .filter-bar { display: flex; gap: 6px; flex-wrap: wrap; }
  .filter-link {
    padding: 7px 14px; border-radius: 999px; border: 1px solid var(--line); font-size: 13.5px;
    font-weight: 600; color: var(--ink-soft); text-decoration: none; background: var(--paper-raised);
  }
  .filter-link:hover { border-color: var(--accent); }
  .filter-link.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .section-heading { font-size: 18px; font-weight: 700; margin: 28px 0 12px; }
  .player-list { display: flex; flex-direction: column; gap: 10px; }
  .player-row {
    background: var(--paper-raised); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px 18px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  }
  .player-row.is-eliminated { opacity: 0.6; }
  .player-row .p-main { flex: 1; min-width: 200px; }
  .player-row .p-name { font-weight: 700; font-size: 15px; }
  .player-row .p-meta { color: var(--muted); font-size: 12.5px; margin-top: 3px; display: flex; gap: 8px; flex-wrap: wrap; }
  .player-row .p-mmr { font-weight: 700; color: var(--accent-ink); min-width: 90px; text-align: right; }
  .player-row .p-actions { display: flex; gap: 8px; align-items: center; }
  .status-badge, .bracket-badge {
    display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 700;
  }
  .status-active { background: color-mix(in srgb, #1abc9c 22%, var(--paper-raised)); color: #0e8272; }
  .status-indanger { background: color-mix(in srgb, #f0b429 22%, var(--paper-raised)); color: #a5730a; }
  .status-eliminated { background: var(--warn-bg); color: var(--warn); }
  .bracket-pro { background: color-mix(in srgb, #2aa9d8 22%, var(--paper-raised)); color: #1a6f8f; }
  .bracket-casual { background: color-mix(in srgb, #e4c9a0 40%, var(--paper-raised)); color: #8a6a2f; }
  .live-dot { font-size: 11.5px; font-weight: 600; }
  .btn {
    padding: 7px 14px; border-radius: 6px; border: 1px solid var(--line); background: var(--paper);
    color: var(--ink-soft); font-weight: 600; font-size: 12.5px; cursor: pointer; text-decoration: none;
    display: inline-block;
  }
  .btn:hover { border-color: var(--accent); color: var(--accent-ink); }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent-ink); }
  .empty-state { color: var(--muted); font-size: 14.5px; padding: 40px 0; text-align: center; }
  .detail-card {
    background: var(--paper-raised); border: 1px solid var(--line); border-radius: 12px;
    padding: 28px 32px; margin-top: 24px;
  }
  .detail-meta { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .detail-meta .m-label { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 3px; }
  .detail-meta .m-value { font-size: 14px; color: var(--ink-soft); }
  .frow { display: grid; grid-template-columns: minmax(140px, 220px) 1fr; gap: 14px; align-items: start; font-size: 13.5px; margin-bottom: 14px; }
  .flabel { color: var(--ink-soft); padding-top: 9px; }
  .fhint { color: var(--muted); font-size: 11.5px; font-weight: 400; }
  .finput, .fselect {
    width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px;
    background: var(--paper); color: var(--ink); font-family: inherit; font-size: 13.5px;
  }
  .finput:focus, .fselect:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  .fcheckbox-row { display: flex; align-items: center; gap: 8px; }
  .save-row { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
  @media (max-width: 640px) {
    .player-row { flex-direction: column; align-items: stretch; }
    .player-row .p-mmr { text-align: left; }
    .frow { grid-template-columns: 1fr; gap: 6px; }
  }
</style>
</head>
<body>
${topBar({ active: 'leaderboard', username })}
<div class="wrap">
${body}
</div>
</body>
</html>`;
}

function playerRow(player) {
  const rpDisplay = player.mmr === 0 ? 'N/A' : `${player.mmr} RP`;
  return `<div class="player-row${player.culled ? ' is-eliminated' : ''}">
    <div class="p-main">
      <div class="p-name">${esc(player.region ? `${player.region} | ` : '')}${esc(player.name)} ${statusBadge(player)}</div>
      <div class="p-meta">${bracketBadge(player.ispro)} ${liveIcons(player)}</div>
    </div>
    <div class="p-mmr">${esc(rpDisplay)}</div>
    <div class="p-actions">
      <a class="btn" href="/leaderboard/${encodeURIComponent(player.name)}/edit">View / Edit</a>
    </div>
  </div>`;
}

function buildLeaderboardListHtml({ players, filterBracket, username, message }) {
  const toast = message
    ? `<div class="toast${message.warn ? ' warn' : ''}">${esc(message.text)}</div>`
    : '';

  const filters = [
    { value: 'all', label: 'All' },
    { value: 'pro', label: 'Pro' },
    { value: 'casual', label: 'Casual' },
  ];
  const filterBar = `<div class="filter-bar">${filters.map((f) => {
    const cls = f.value === filterBracket ? 'filter-link active' : 'filter-link';
    return `<a class="${cls}" href="/leaderboard${f.value === 'all' ? '' : `?bracket=${f.value}`}">${esc(f.label)}</a>`;
  }).join('')}</div>`;

  const proPlayers = players.filter((p) => p.ispro);
  const casualPlayers = players.filter((p) => !p.ispro);

  const section = (label, list) => {
    if (!list.length) return '';
    return `<div class="section-heading">${esc(label)} (${list.length})</div>
    <div class="player-list">${list.map(playerRow).join('')}</div>`;
  };

  const body = `
  <header class="masthead">
    <p class="eyebrow">Lumi-chan · Admin</p>
    <h1>Leaderboard</h1>
    <p class="sub">Every Coastal Clash player — RP, bracket, and elimination status are written automatically by the daily cull. Editing a player here overrides that record; RP itself isn't editable, since hand-editing it would desync from the real API standing.</p>
  </header>
  ${toast}
  <div class="filter-row">${filterBar}</div>
  ${filterBracket !== 'casual' ? section('Pro Bracket', proPlayers) : ''}
  ${filterBracket !== 'pro' ? section('Casual Bracket', casualPlayers) : ''}
  ${!players.length ? '<div class="empty-state">No players yet.</div>' : ''}`;

  return pageShell({ title: 'Leaderboard', username, body });
}

function buildPlayerEditHtml({ player, username, message }) {
  const toast = message ? `<div class="toast${message.warn ? ' warn' : ''}">${esc(message.text)}</div>` : '';

  const body = `
  <header class="masthead">
    <p class="eyebrow">Lumi-chan · Admin</p>
    <h1>${esc(player.name)} ${statusBadge(player)}</h1>
    <p class="sub"><a href="/leaderboard">← Back to leaderboard</a></p>
  </header>
  ${toast}
  <div class="detail-card">
    <div class="detail-meta">
      <div><div class="m-label">RP</div><div class="m-value">${player.mmr === 0 ? 'N/A' : player.mmr}</div></div>
      <div><div class="m-label">Twitch Live</div><div class="m-value">${player.twitchlive ? 'Yes' : 'No'}</div></div>
      <div><div class="m-label">YouTube Live</div><div class="m-value">${player.youtubelive ? 'Yes' : 'No'}</div></div>
    </div>
    <p class="fhint" style="margin:-10px 0 20px;">RP and live-stream status are written automatically by the leaderboard pipeline — not editable here.</p>

    <form method="POST" action="/leaderboard/${encodeURIComponent(player.name)}/edit">
      <div class="frow">
        <div class="flabel">Region <span class="fhint">Shown as a prefix on the leaderboard, e.g. "NA".</span></div>
        <input class="finput" type="text" name="region" value="${esc(player.region ?? '')}" maxlength="10">
      </div>
      <div class="frow">
        <div class="flabel">Twitch</div>
        <input class="finput" type="text" name="twitch" value="${esc(player.twitch ?? '')}">
      </div>
      <div class="frow">
        <div class="flabel">YouTube</div>
        <input class="finput" type="text" name="youtube" value="${esc(player.youtube ?? '')}">
      </div>
      <div class="frow">
        <div class="flabel">Bracket</div>
        <select class="fselect" name="ispro">
          <option value="true" ${player.ispro ? 'selected' : ''}>Pro</option>
          <option value="false" ${!player.ispro ? 'selected' : ''}>Casual</option>
        </select>
      </div>
      <div class="frow">
        <div class="flabel">Status <span class="fhint">Staff override — e.g. reversing a mistaken elimination.</span></div>
        <div class="fcheckbox-row">
          <label><input type="checkbox" name="culled" value="true" ${player.culled ? 'checked' : ''}> Eliminated</label>
          <label><input type="checkbox" name="indanger" value="true" ${player.indanger ? 'checked' : ''}> In Danger</label>
        </div>
      </div>
      <div class="save-row">
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
    </form>
  </div>`;

  return pageShell({ title: player.name, username, body });
}

module.exports = { buildLeaderboardListHtml, buildPlayerEditHtml };
