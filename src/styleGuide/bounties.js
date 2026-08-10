// Builds the HTML for the bounty admin pages (list, create, edit) —
// src/styleGuide/server.js serves these and does all the async work (DB
// reads/writes, resolving Discord usernames, syncing the live board post).
// This file only turns already-resolved data into HTML, same split as
// styleGuide.js/server.js.
const { esc, BASE_STYLES, topBar, fmtDate } = require('./styleGuide');
const { formatAmount, formatGroupType } = require('../bountyCard');
const { labelText } = require('./discordUsers');

// Player-facing name/description/reward caps mirror MODAL.bountyRequest's
// own TextInputBuilder limits (src/modal.js) — an admin-created bounty
// should be boxed in by the same Discord constraints a player's would be,
// since it renders through the same buildBountyEmbed().
const LIMITS = { name: 100, description: 1000, reward: 50, donator: 100 };

// Matches the Discord approve modal's Reward Type options (src/modal.js) and
// the DB's prize_type values — kept in one place so the two never drift.
const PRIZE_TYPES = [
  { value: 'cash', label: 'Money' },
  { value: 'NP', label: 'NP Code' },
  { value: 'Item', label: 'Merch/Items' },
  { value: 'Other', label: 'Other' },
];

// Same idea for Tier, matching the DB's tier values.
const TIERS = [
  { value: 'Boot', label: 'Boot' },
  { value: 'Shrimp', label: 'Shrimp' },
  { value: 'Crab', label: 'Crab' },
  { value: 'Pearl', label: 'Pearl' },
  { value: 'Blue NP', label: 'Blue NP' },
  { value: 'Treasure Chest', label: 'Treasure Chest' },
];

// Same idea for Group Type, matching the Discord request modal's options
// (src/modal.js) and the DB's group_type values.
const GROUP_TYPES = [
  { value: 'solo', label: 'Solo Only' },
  { value: 'premade', label: 'Premade Allowed' },
];

// Same idea for Claim Type — which of /deployclaimbounty's two active
// categories (Claim vs Submissions) this bounty's claim ticket opens under.
const CLAIM_TYPES = [
  { value: 'claim', label: 'Claim' },
  { value: 'submissions', label: 'Submissions' },
];

function formatClaimType(raw) {
  return CLAIM_TYPES.find((t) => t.value === raw)?.label ?? 'Claim (default)';
}

const STATUS_LABELS = {
  pending: '⏳ Pending',
  approved: '✅ Approved',
  claimed: '🏁 Claimed',
  denied: '⛔ Denied',
  cancelled: '🚫 Cancelled',
};

const STATUS_FILTERS = ['all', 'pending', 'approved', 'claimed', 'denied', 'cancelled'];

const GROUP_FILTERS = ['all', 'solo', 'premade'];
const GROUP_FILTER_LABELS = { all: 'All', solo: 'Solo Only', premade: 'Premade Allowed' };

// Statuses the admin edit page's free status-change control can move a
// bounty between — 'claimed' is deliberately excluded (see buildBountyEditHtml).
const STATUS_ORDER = ['pending', 'approved', 'denied', 'cancelled'];

function statusBadge(status) {
  const label = STATUS_LABELS[status] ?? status;
  return `<span class="status-badge status-${esc(status)}">${esc(label)}</span>`;
}

// `tags` is a { [discordId]: {username, nickname} } map the caller built by
// resolving users up front (src/styleGuide/bountyRoutes.js) — falls back to
// the raw id if a fetch failed (left the server, account deleted, etc.)
// rather than hiding it.
function userLabel(id, tags) {
  if (!id) return '—';
  const label = tags[id];
  return label
    ? `${esc(labelText(label))} <span class="id-hint mono">${esc(id)}</span>`
    : `<span class="mono">${esc(id)}</span>`;
}

// Both filter bars link with both query params so switching one doesn't
// drop whichever value the other is currently set to — except `group=all`
// is left out of the URL entirely, since that's the default anyway.
function groupParam(activeGroup) {
  return activeGroup === 'all' ? '' : `&group=${esc(activeGroup)}`;
}

function filterBar(activeStatus, activeGroup) {
  return `<div class="filter-bar">${STATUS_FILTERS.map((s) => {
    const label = s === 'all' ? 'All' : (STATUS_LABELS[s] ?? s);
    const cls = s === activeStatus ? 'filter-link active' : 'filter-link';
    return `<a class="${cls}" href="/bounties?status=${esc(s)}${groupParam(activeGroup)}">${esc(label)}</a>`;
  }).join('')}</div>`;
}

function groupFilterBar(activeGroup, activeStatus) {
  return `<div class="filter-bar">${GROUP_FILTERS.map((g) => {
    const cls = g === activeGroup ? 'filter-link active' : 'filter-link';
    return `<a class="${cls}" href="/bounties?status=${esc(activeStatus)}${groupParam(g)}">${esc(GROUP_FILTER_LABELS[g])}</a>`;
  }).join('')}</div>`;
}

function pageShell({ title, active, username, body }) {
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
  .filter-divider { width: 1px; height: 22px; background: var(--line); }
  .filter-link {
    padding: 7px 14px; border-radius: 999px; border: 1px solid var(--line); font-size: 13.5px;
    font-weight: 600; color: var(--ink-soft); text-decoration: none; background: var(--paper-raised);
  }
  .filter-link:hover { border-color: var(--accent); }
  .filter-link.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .new-btn {
    display: inline-block; padding: 9px 18px; border-radius: 8px; background: var(--accent);
    color: #fff; font-weight: 700; font-size: 13.5px; text-decoration: none; margin-bottom: 8px;
  }
  .new-btn:hover { background: var(--accent-ink); }
  .bounty-list { display: flex; flex-direction: column; gap: 12px; margin-top: 20px; }
  .bounty-row {
    background: var(--paper-raised); border: 1px solid var(--line); border-radius: 10px;
    padding: 16px 20px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  }
  .bounty-row .b-main { flex: 1; min-width: 220px; }
  .bounty-row .b-name { font-weight: 700; font-size: 15.5px; }
  .bounty-row .b-meta { color: var(--muted); font-size: 12.5px; margin-top: 3px; }
  .bounty-row .b-reward { font-weight: 700; color: var(--accent-ink); min-width: 90px; text-align: right; }
  .bounty-row .b-actions { display: flex; gap: 8px; align-items: center; }
  .status-badge {
    display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 700;
  }
  .status-pending { background: color-mix(in srgb, #f0b429 22%, var(--paper-raised)); color: #a5730a; }
  .status-approved { background: color-mix(in srgb, #1abc9c 22%, var(--paper-raised)); color: #0e8272; }
  .status-claimed { background: color-mix(in srgb, #1f8fb8 22%, var(--paper-raised)); color: var(--accent-ink); }
  .status-denied, .status-cancelled { background: var(--warn-bg); color: var(--warn); }
  .btn {
    padding: 7px 14px; border-radius: 6px; border: 1px solid var(--line); background: var(--paper);
    color: var(--ink-soft); font-weight: 600; font-size: 12.5px; cursor: pointer; text-decoration: none;
    display: inline-block;
  }
  .btn:hover { border-color: var(--accent); color: var(--accent-ink); }
  .btn-danger { border-color: var(--warn); color: var(--warn); }
  .btn-danger:hover { background: var(--warn-bg); }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent-ink); }
  .empty-state { color: var(--muted); font-size: 14.5px; padding: 40px 0; text-align: center; }
  .detail-card {
    background: var(--paper-raised); border: 1px solid var(--line); border-radius: 12px;
    padding: 28px 32px; margin-top: 24px;
  }
  .detail-meta { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .detail-meta .m-label { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 3px; }
  .detail-meta .m-value { font-size: 14px; color: var(--ink-soft); }
  .id-hint { color: var(--muted); font-size: 11.5px; }
  .frow { display: grid; grid-template-columns: minmax(140px, 220px) 1fr; gap: 14px; align-items: start; font-size: 13.5px; margin-bottom: 14px; }
  .flabel { color: var(--ink-soft); padding-top: 9px; }
  .fhint { color: var(--muted); font-size: 11.5px; font-weight: 400; }
  .finput, .ftextarea, .fselect {
    width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px;
    background: var(--paper); color: var(--ink); font-family: inherit; font-size: 13.5px;
  }
  .ftextarea { min-height: 110px; resize: vertical; }
  .finput:focus, .ftextarea:focus, .fselect:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  .field-error { grid-column: 2; color: var(--warn); font-size: 12px; }
  .frow.has-error .finput, .frow.has-error .ftextarea { border-color: var(--warn); }
  .save-row { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
  .action-row { flex-wrap: wrap; margin-top: 20px; padding-top: 20px; border-top: 1px dashed var(--line); }
  .board-link { font-size: 13px; }
  .status-changer summary { list-style: none; cursor: pointer; }
  .status-changer summary::-webkit-details-marker { display: none; }
  .status-changer summary::marker { content: ''; }
  .confirm-box {
    margin-top: 12px; padding: 14px 16px; border: 1px solid var(--warn); border-radius: 8px;
    background: var(--warn-bg); max-width: 480px;
  }
  .confirm-box p { margin: 0 0 12px; color: var(--warn); font-size: 13px; font-weight: 600; }
  .confirm-box form { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .confirm-box .fselect { width: auto; flex: 1; min-width: 150px; }
  @media (max-width: 640px) {
    .bounty-row { flex-direction: column; align-items: stretch; }
    .bounty-row .b-reward { text-align: left; }
    .frow { grid-template-columns: 1fr; gap: 6px; }
    .field-error { grid-column: 1; }
  }
</style>
</head>
<body>
${topBar({ active, username })}
<div class="wrap">
${body}
</div>
</body>
</html>`;
}

function buildBountiesListHtml({ bounties, tags, filterStatus, filterGroup, username, message }) {
  const toast = message
    ? `<div class="toast${message.warn ? ' warn' : ''}">${esc(message.text)}</div>`
    : '';

  const rows = bounties.length
    ? bounties.map((b) => `
      <div class="bounty-row">
        <div class="b-main">
          <div class="b-name">${esc(b.name)} ${statusBadge(b.status)}</div>
          <div class="b-meta">
            Requested by ${userLabel(b.requester_id, tags)} · ${fmtDate(b.created_at)} · ${esc(formatGroupType(b.group_type))}
            ${b.claimer_id ? ` · claimed by ${userLabel(b.claimer_id, tags)}` : ''}
          </div>
        </div>
        <div class="b-reward">${esc(formatAmount(b.reward))}</div>
        <div class="b-actions">
          <a class="btn" href="/bounties/${b.id}/edit">View / Edit</a>
        </div>
      </div>`).join('')
    : `<div class="empty-state">No bounties in this filter.</div>`;

  const body = `
  <header class="masthead">
    <p class="eyebrow">Lumi-chan · Admin</p>
    <h1>Bounties</h1>
    <p class="sub">Every bounty on record — requested, approved, claimed, denied, or cancelled. Editing an approved bounty here also updates its live post on the board.</p>
  </header>
  ${toast}
  <a class="new-btn" href="/bounties/new" style="margin-top:24px;">+ New Bounty</a>
  <div class="filter-row">
    ${filterBar(filterStatus, filterGroup)}
    <span class="filter-divider"></span>
    ${groupFilterBar(filterGroup, filterStatus)}
  </div>
  <div class="bounty-list">${rows}</div>`;

  return pageShell({ title: 'Bounties', active: 'bounties', username, body });
}

// Shared field-row renderer for the create/edit forms.
function fieldRow({ name, label, hint, value, error, multiline }) {
  const control = multiline
    ? `<textarea name="${esc(name)}" class="ftextarea">${esc(value ?? '')}</textarea>`
    : `<input type="text" name="${esc(name)}" value="${esc(value ?? '')}" class="finput">`;
  return `
    <label class="frow${error ? ' has-error' : ''}">
      <span class="flabel">${esc(label)}${hint ? `<br><span class="fhint">${esc(hint)}</span>` : ''}</span>
      ${control}
      ${error ? `<span class="field-error">⚠️ ${esc(error)}</span>` : ''}
    </label>`;
}

// Same shared row layout as fieldRow, but a <select> with a blank "not set"
// option — used for Reward Type, which (unlike name/description/reward)
// isn't required here even though it's required on the Discord approve modal.
function selectRow({ name, label, hint, value, options, error }) {
  const opts = options.map((o) => `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  return `
    <label class="frow${error ? ' has-error' : ''}">
      <span class="flabel">${esc(label)}${hint ? `<br><span class="fhint">${esc(hint)}</span>` : ''}</span>
      <select name="${esc(name)}" class="fselect">
        <option value=""${value ? '' : ' selected'}>— Not set —</option>
        ${opts}
      </select>
      ${error ? `<span class="field-error">⚠️ ${esc(error)}</span>` : ''}
    </label>`;
}

function buildBountyNewHtml({ username, errors = {}, values = {} }) {
  const body = `
  <header class="masthead">
    <p class="eyebrow">Lumi-chan · Admin</p>
    <h1>New Bounty</h1>
    <p class="sub">Adds a bounty directly, skipping the normal player request/ticket flow — useful for e.g. a sponsor bounty. Pick which button to submit with below.</p>
  </header>
  <div class="detail-card">
    <form method="POST" action="/bounties/new">
      ${fieldRow({ name: 'donator_name', label: 'Donator', value: values.donator_name, error: errors.donator_name, hint: `Optional — who to credit for the prize. Max ${LIMITS.donator} characters. Leave blank to use your own name.` })}
      ${fieldRow({ name: 'name', label: 'Name', value: values.name, error: errors.name, hint: `Max ${LIMITS.name} characters.` })}
      ${fieldRow({ name: 'description', label: 'Description', value: values.description, error: errors.description, multiline: true, hint: `Max ${LIMITS.description} characters.` })}
      ${selectRow({ name: 'tier', label: 'Tier', value: values.tier, error: errors.tier, options: TIERS, hint: 'Optional.' })}
      ${selectRow({ name: 'prize_type', label: 'Reward Type', value: values.prize_type, error: errors.prize_type, options: PRIZE_TYPES, hint: 'Optional — classifies the reward below.' })}
      ${fieldRow({ name: 'reward', label: 'Reward', value: values.reward, error: errors.reward, hint: `Max ${LIMITS.reward} characters — free text, e.g. "$10" or "250 NP".` })}
      ${selectRow({ name: 'group_type', label: 'Group Type', value: values.group_type, error: errors.group_type, options: GROUP_TYPES, hint: 'Optional — solo only, or premade allowed?' })}
      ${selectRow({ name: 'claim_type', label: 'Claim Type', value: values.claim_type, error: errors.claim_type, options: CLAIM_TYPES, hint: 'Optional — which category the claim ticket opens under. Defaults to Claim.' })}
      <div class="save-row">
        <button type="submit" name="initialStatus" value="pending" class="btn">Create as Pending</button>
        <button type="submit" name="initialStatus" value="approved" class="btn btn-primary">Create &amp; Post to Board</button>
      </div>
    </form>
  </div>`;
  return pageShell({ title: 'New Bounty', active: 'bounties', username, body });
}

function buildBountyEditHtml({ bounty, tags, boardLink, username, errors = {}, values, message }) {
  const v = values ?? bounty;
  const toast = message ? `<div class="toast${message.warn ? ' warn' : ''}">${esc(message.text)}</div>` : '';

  // 'claimed' can never be a target — only the real in-Discord claim flow
  // (src/db.js claimBounty) sets claimer_id/claimed_at, so setting status to
  // 'claimed' from here would leave those blank/inconsistent. But a bounty
  // that's CURRENTLY claimed can still move away to any of the other four —
  // e.g. to undo a wrongly-processed claim — so the control always shows.
  const otherStatuses = STATUS_ORDER.filter((s) => s !== bounty.status);
  const statusChanger = `<details class="status-changer">
      <summary class="btn">Change Status</summary>
      <div class="confirm-box">
        <p>Are you sure? Moving a bounty to Approved posts/updates it on the board; moving it away from Approved pulls it off the board. Takes effect immediately.</p>
        <form method="POST" action="/bounties/${bounty.id}/status">
          <select name="status" class="fselect">
            ${otherStatuses.map((s) => `<option value="${esc(s)}">${esc(STATUS_LABELS[s] ?? s)}</option>`).join('')}
          </select>
          <button type="submit" class="btn btn-primary">Confirm Change</button>
        </form>
      </div>
    </details>`;

  const body = `
  <header class="masthead">
    <p class="eyebrow">Lumi-chan · Admin</p>
    <h1>${esc(bounty.name)} ${statusBadge(bounty.status)}</h1>
    <p class="sub"><a href="/bounties">← Back to all bounties</a></p>
  </header>
  ${toast}
  <div class="detail-card">
    <div class="detail-meta">
      <div><div class="m-label">Requester</div><div class="m-value">${userLabel(bounty.requester_id, tags)}</div></div>
      <div><div class="m-label">Donator</div><div class="m-value">${esc(bounty.donator_name || '—')}</div></div>
      <div><div class="m-label">Tier</div><div class="m-value">${esc(bounty.tier || '—')}</div></div>
      <div><div class="m-label">Group Type</div><div class="m-value">${esc(formatGroupType(bounty.group_type))}</div></div>
      <div><div class="m-label">Claim Type</div><div class="m-value">${esc(formatClaimType(bounty.claim_type))}</div></div>
      <div><div class="m-label">Claimer</div><div class="m-value">${userLabel(bounty.claimer_id, tags)}</div></div>
      <div><div class="m-label">Created</div><div class="m-value">${fmtDate(bounty.created_at)}</div></div>
      <div><div class="m-label">Decided</div><div class="m-value">${fmtDate(bounty.approved_at)}</div></div>
      <div><div class="m-label">Claimed</div><div class="m-value">${fmtDate(bounty.claimed_at)}</div></div>
      <div><div class="m-label">Board post</div><div class="m-value board-link">${boardLink ? `<a href="${esc(boardLink)}" target="_blank" rel="noopener">View in Discord ↗</a>` : '—'}</div></div>
    </div>

    <form method="POST" action="/bounties/${bounty.id}/edit">
      ${fieldRow({ name: 'donator_name', label: 'Donator', value: v.donator_name, error: errors.donator_name, hint: `Optional — who to credit for the prize. Max ${LIMITS.donator} characters.` })}
      ${fieldRow({ name: 'name', label: 'Name', value: v.name, error: errors.name, hint: `Max ${LIMITS.name} characters.` })}
      ${fieldRow({ name: 'description', label: 'Description', value: v.description, error: errors.description, multiline: true, hint: `Max ${LIMITS.description} characters.` })}
      ${selectRow({ name: 'tier', label: 'Tier', value: v.tier, error: errors.tier, options: TIERS, hint: 'Optional.' })}
      ${selectRow({ name: 'prize_type', label: 'Reward Type', value: v.prize_type, error: errors.prize_type, options: PRIZE_TYPES, hint: 'Optional — classifies the reward below.' })}
      ${fieldRow({ name: 'reward', label: 'Reward', value: v.reward, error: errors.reward, hint: `Max ${LIMITS.reward} characters.` })}
      ${selectRow({ name: 'claim_type', label: 'Claim Type', value: v.claim_type, error: errors.claim_type, options: CLAIM_TYPES, hint: 'Optional — which category the claim ticket opens under. Defaults to Claim.' })}
      ${selectRow({ name: 'group_type', label: 'Group Type', value: v.group_type, error: errors.group_type, options: GROUP_TYPES, hint: 'Optional — solo only, or premade allowed?' })}
      <div class="save-row">
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
      ${bounty.status === 'approved' ? '<p class="fhint" style="margin-top:10px;">Saving updates the live board post to match.</p>' : ''}
      ${bounty.status === 'claimed' ? '<p class="fhint" style="margin-top:10px;">This bounty is claimed — its board post already moved to the claim log and isn\'t tracked here, so saving updates the record only, not any Discord message.</p>' : ''}
    </form>

    <div class="action-row">${statusChanger}</div>
  </div>`;

  return pageShell({ title: bounty.name, active: 'bounties', username, body });
}

module.exports = { buildBountiesListHtml, buildBountyNewHtml, buildBountyEditHtml, LIMITS, PRIZE_TYPES, TIERS, GROUP_TYPES, CLAIM_TYPES };
