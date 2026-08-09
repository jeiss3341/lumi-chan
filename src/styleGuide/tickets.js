// Builds the HTML for the admin Tickets pages (list + detail) —
// src/styleGuide/ticketRoutes.js does all the async Discord/DB work and
// hands this file already-resolved data to render, same split as
// bounties.js/bountyRoutes.js.
//
// Unlike bounties, there's no database table for tickets — every ticket
// shown here is a live Discord channel, enumerated on each page load from
// the configured ticket/archive categories (see ticketRoutes.js). "Active"
// means still in its original category; "Archived" means moved into the
// configured archive category on close (index.js closeOrArchiveTicket) —
// closed tickets from before archiving was set up were deleted and have no
// record here at all.
const { esc, BASE_STYLES, topBar } = require('./styleGuide');

const TYPE_LABELS = { request: '🏖️ Request', claim: '🏁 Claim', help: '💬 Help' };
const TYPE_FILTERS = ['all', 'request', 'claim', 'help'];
const STATUS_FILTERS = ['all', 'active', 'archived'];

function typeBadge(type) {
  return `<span class="type-badge type-${esc(type)}">${esc(TYPE_LABELS[type] ?? type)}</span>`;
}

function statusBadge(status) {
  return `<span class="status-badge status-${esc(status)}">${status === 'active' ? '🟢 Active' : '📦 Archived'}</span>`;
}

function fmtDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
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
  .settings-card {
    background: var(--paper-raised); border: 1px solid var(--line); border-radius: 10px;
    padding: 18px 22px; margin: 24px 0; font-size: 13.5px;
  }
  .settings-card summary { cursor: pointer; font-weight: 700; color: var(--ink-soft); }
  .settings-card p.hint { color: var(--muted); font-size: 12.5px; margin: 10px 0 16px; }
  .settings-row { display: grid; grid-template-columns: 160px 1fr; gap: 12px; align-items: center; margin-bottom: 10px; }
  .settings-row label { color: var(--ink-soft); font-weight: 600; }
  .settings-row input {
    padding: 7px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper);
    color: var(--ink); font-family: inherit; font-size: 13px;
  }
  .settings-card .save-btn {
    margin-top: 6px; padding: 8px 16px; border-radius: 6px; border: none; background: var(--accent);
    color: #fff; font-weight: 700; font-size: 12.5px; cursor: pointer;
  }
  .filter-group { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 10px 0; }
  .filter-group .fg-label { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; margin-right: 4px; }
  .filter-link {
    padding: 6px 13px; border-radius: 999px; border: 1px solid var(--line); font-size: 13px;
    font-weight: 600; color: var(--ink-soft); text-decoration: none; background: var(--paper-raised); cursor: pointer;
  }
  .filter-link:hover { border-color: var(--accent); }
  .filter-link.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .ticket-list { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }
  .ticket-row {
    background: var(--paper-raised); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px 18px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    text-decoration: none; color: inherit;
  }
  .ticket-row:hover { border-color: var(--accent); }
  .ticket-row .t-main { flex: 1; min-width: 220px; }
  .ticket-row .t-name { font-weight: 700; font-size: 14.5px; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .ticket-row .t-meta { color: var(--muted); font-size: 12.5px; margin-top: 3px; }
  .type-badge, .status-badge {
    display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 700;
  }
  .type-request { background: color-mix(in srgb, #2AA9D8 22%, var(--paper-raised)); color: var(--accent-ink); }
  .type-claim { background: color-mix(in srgb, #1abc9c 22%, var(--paper-raised)); color: #0e8272; }
  .type-help { background: color-mix(in srgb, #8a6fd1 22%, var(--paper-raised)); color: #6a4fc0; }
  .status-active { background: color-mix(in srgb, #1abc9c 20%, var(--paper-raised)); color: #0e8272; }
  .status-archived { background: var(--line-soft); color: var(--muted); }
  .empty-state { color: var(--muted); font-size: 14.5px; padding: 40px 0; text-align: center; }
  .chat-log { display: flex; flex-direction: column; gap: 16px; margin-top: 24px; }
  .chat-msg { display: flex; gap: 12px; }
  .chat-msg .avatar {
    width: 36px; height: 36px; border-radius: 50%; flex: none; background: var(--line-soft);
    display: flex; align-items: center; justify-content: center; font-weight: 700; color: var(--muted); overflow: hidden;
  }
  .chat-msg .avatar img { width: 100%; height: 100%; object-fit: cover; }
  .chat-msg .body { flex: 1; min-width: 0; }
  .chat-msg .who { font-weight: 700; font-size: 13.5px; }
  .chat-msg .who .when { font-weight: 400; color: var(--muted); font-size: 11.5px; margin-left: 6px; }
  .chat-msg .text { font-size: 14px; color: var(--ink-soft); white-space: pre-wrap; word-break: break-word; margin-top: 2px; }
  .chat-msg .text.hidden-note { color: var(--muted); font-style: italic; font-size: 13px; }
  .chat-msg .embed-note {
    margin-top: 6px; padding: 8px 12px; border-left: 3px solid var(--accent); background: var(--paper-raised);
    font-size: 13px; color: var(--ink-soft); border-radius: 0 6px 6px 0;
  }
  .chat-msg .attach img { max-width: 320px; max-height: 240px; border-radius: 8px; margin-top: 8px; display: block; }
  .chat-msg .attach a { display: inline-block; margin-top: 8px; font-size: 13px; }
  .board-link { font-size: 13px; }
  @media (max-width: 640px) {
    .ticket-row { flex-direction: column; align-items: stretch; }
    .settings-row { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
${topBar({ active: 'tickets', username })}
<div class="wrap">
${body}
</div>
<script>
  // Pure convenience — filter links just rewrite the query string and
  // reload, same effect as typing a new URL. No state lives in JS.
  document.querySelectorAll('.filter-link[data-value]').forEach((el) => {
    el.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.set(el.dataset.filter, el.dataset.value);
      window.location.href = url.toString();
    });
  });
</script>
</body>
</html>`;
}

function buildTicketsListHtml({ groups, type, status, archiveSettings, username, message }) {
  const toast = message ? `<div class="toast${message.warn ? ' warn' : ''}">${esc(message.text)}</div>` : '';

  const rows = groups.length
    ? groups.map((t) => `
      <a class="ticket-row" href="/tickets/${esc(t.id)}">
        <div class="t-main">
          <div class="t-name">#${esc(t.name)}</div>
          <div class="t-meta">Opened ${fmtDate(t.createdAt)}${t.topic ? ` · ${esc(t.topic)}` : ''}</div>
        </div>
        ${typeBadge(t.type)}
        ${statusBadge(t.status)}
      </a>`).join('')
    : `<div class="empty-state">No tickets match this filter.</div>`;

  const typeFilterLinks = TYPE_FILTERS.map((v) => {
    const label = v === 'all' ? 'All Types' : (TYPE_LABELS[v] ?? v);
    const cls = v === type ? 'filter-link active' : 'filter-link';
    return `<a class="${cls}" data-filter="type" data-value="${esc(v)}">${esc(label)}</a>`;
  }).join('');
  const statusFilterLinks = STATUS_FILTERS.map((v) => {
    const label = v === 'all' ? 'All Statuses' : (v === 'active' ? '🟢 Active' : '📦 Archived');
    const cls = v === status ? 'filter-link active' : 'filter-link';
    return `<a class="${cls}" data-filter="status" data-value="${esc(v)}">${esc(label)}</a>`;
  }).join('');

  const settingsRow = (label, name, value) => `
    <div class="settings-row">
      <label>${esc(label)}</label>
      <input type="text" name="${esc(name)}" value="${esc(value ?? '')}" placeholder="Discord category ID">
    </div>`;

  const body = `
  <header class="masthead">
    <p class="eyebrow">Lumi-chan · Admin</p>
    <h1>Tickets</h1>
    <p class="sub">Every request, claim, and help ticket currently open, plus any that have been archived on close. Click one to read its message log.</p>
  </header>
  ${toast}
  <details class="settings-card">
    <summary>Archive category settings</summary>
    <p class="hint">Closing a ticket moves it into the matching category below instead of deleting it, so it keeps showing up here. Leave a category blank to keep the old behavior (delete on close) for that ticket type. Paste a Discord category's ID (right-click it in Discord with Developer Mode on → Copy Channel ID).</p>
    <form method="POST" action="/tickets/archive-settings">
      ${settingsRow('Request tickets', 'request_archive_category', archiveSettings.request)}
      ${settingsRow('Claim tickets', 'claim_archive_category', archiveSettings.claim)}
      ${settingsRow('Help tickets', 'help_archive_category', archiveSettings.help)}
      <button type="submit" class="save-btn">Save</button>
    </form>
  </details>
  <div class="filter-group"><span class="fg-label">Type</span>${typeFilterLinks}</div>
  <div class="filter-group"><span class="fg-label">Status</span>${statusFilterLinks}</div>
  <div class="ticket-list">${rows}</div>`;

  return pageShell({ title: 'Tickets', username, body });
}

function renderAttachment(a) {
  const isImage = (a.contentType || '').startsWith('image/');
  return isImage
    ? `<div class="attach"><img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></div>`
    : `<div class="attach"><a href="${esc(a.url)}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a></div>`;
}

function buildTicketDetailHtml({ ticket, messages, username, message }) {
  const toast = message ? `<div class="toast${message.warn ? ' warn' : ''}">${esc(message.text)}</div>` : '';

  const log = messages.length
    ? messages.map((m) => {
      const hasAttachments = (m.attachments || []).length > 0;
      // The bot doesn't request the (privileged) Message Content intent —
      // see index.js — so Discord blanks out `content` for anything a real
      // user sent. A message with nothing to show almost always means that,
      // not an actually-empty message (Discord won't let you send one), so
      // say so plainly rather than just leaving a confusing blank row.
      const nothingToShow = !m.content && !m.embedSummary && !hasAttachments;
      return `
      <div class="chat-msg">
        <div class="avatar">${m.avatarUrl ? `<img src="${esc(m.avatarUrl)}" alt="">` : esc((m.author || '?').slice(0, 1).toUpperCase())}</div>
        <div class="body">
          <div class="who">${esc(m.author)}<span class="when">${fmtDate(m.createdAt)}</span></div>
          ${m.content ? `<div class="text">${esc(m.content)}</div>` : ''}
          ${m.embedSummary ? `<div class="embed-note">${esc(m.embedSummary)}</div>` : ''}
          ${(m.attachments || []).map(renderAttachment).join('')}
          ${nothingToShow ? '<div class="text hidden-note">(message text not visible to this page)</div>' : ''}
        </div>
      </div>`;
    }).join('')
    : `<div class="empty-state">No messages in this ticket.</div>`;

  const body = `
  <header class="masthead">
    <p class="eyebrow">Lumi-chan · Admin</p>
    <h1>#${esc(ticket.name)} ${typeBadge(ticket.type)} ${statusBadge(ticket.status)}</h1>
    <p class="sub"><a href="/tickets">← Back to all tickets</a> · <a href="${esc(ticket.discordLink)}" target="_blank" rel="noopener">View in Discord ↗</a></p>
  </header>
  ${toast}
  <div class="chat-log">${log}</div>`;

  return pageShell({ title: `#${ticket.name}`, username, body });
}

module.exports = { buildTicketsListHtml, buildTicketDetailHtml, TYPE_LABELS };
