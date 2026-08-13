// Builds the HTML for the public style-guide page (src/styleGuide/server.js serves it).
// The page is organized into small, self-contained "units" (one board, one
// form, one set of buttons, etc.) — each shows a live preview built from the
// CURRENT effective value (a saved override, or text.js's default) directly
// above its own small save form. src/styleGuide/fieldSchema.js is the single source of
// truth for which fields exist, which unit they belong to, their labels,
// and the Discord API limits they're validated against — nothing here
// duplicates that list.
//
// Button STYLES (Success/Danger/Primary/Secondary) aren't stored in
// text.js — they're a code-level choice made in panel.js/ticket.js — so
// BUTTON_STYLES below mirrors those files by hand. If you ever change a
// button's ButtonStyle there, update it here too.
const TEXT = require('../text');
const overrides = require('./overrides');
const fieldSchema = require('./fieldSchema');
const qandaTopics = require('./qandaTopics');
const { linesToText, textToLines } = require('./textLines');
const { COLORS } = TEXT.VISUALS;

// Shared theme variables + base reset, used by both the main style-guide
// page and the login page (src/styleGuide/buildLoginPageHtml below) so the
// two look like one product instead of a styled page linking to a bare one.
const BASE_STYLES = `
  :root {
    --paper: #faf6ee; --paper-raised: #ffffff; --ink: #16303f; --ink-soft: #3d5c6b;
    --muted: #6b8394; --line: #e2dccb; --line-soft: #ecE6d8; --accent: #1f8fb8;
    --accent-ink: #0d5a76; --code-bg: #f0ead9; --warn: #c14a2c; --warn-bg: #f7e3da;
    --shadow: 0 1px 2px rgba(18, 60, 84, 0.06), 0 6px 20px rgba(18, 60, 84, 0.07);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #10202a; --paper-raised: #172c38; --ink: #eef2ee; --ink-soft: #c3d3d9;
      --muted: #8ba6b3; --line: #2a4553; --line-soft: #21394450; --accent: #5cc4e8;
      --accent-ink: #8fd8f2; --code-bg: #0d1c24; --warn: #ff9d80; --warn-bg: #3a2420;
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.25), 0 10px 28px rgba(0, 0, 0, 0.35);
    }
  }
  :root[data-theme="dark"] {
    --paper: #10202a; --paper-raised: #172c38; --ink: #eef2ee; --ink-soft: #c3d3d9;
    --muted: #8ba6b3; --line: #2a4553; --line-soft: #21394450; --accent: #5cc4e8;
    --accent-ink: #8fd8f2; --code-bg: #0d1c24; --warn: #ff9d80; --warn-bg: #3a2420;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.25), 0 10px 28px rgba(0, 0, 0, 0.35);
  }
  :root[data-theme="light"] {
    --paper: #faf6ee; --paper-raised: #ffffff; --ink: #16303f; --ink-soft: #3d5c6b;
    --muted: #6b8394; --line: #e2dccb; --line-soft: #ecE6d8; --accent: #1f8fb8;
    --accent-ink: #0d5a76; --code-bg: #f0ead9; --warn: #c14a2c; --warn-bg: #f7e3da;
    --shadow: 0 1px 2px rgba(18, 60, 84, 0.06), 0 6px 20px rgba(18, 60, 84, 0.07);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 16px; line-height: 1.55; -webkit-font-smoothing: antialiased;
  }
  .mono { font-family: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace; }
  h1, h2, h3, h4 {
    font-family: Iowan Old Style, "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;
    color: var(--ink); font-weight: 600; text-wrap: balance; margin: 0;
  }
  a { color: var(--accent-ink); }
  .session-bar {
    display: flex; align-items: center; justify-content: center; gap: 18px; flex-wrap: wrap;
    background: var(--paper-raised); color: var(--ink-soft); text-align: center; font-size: 13.5px;
    font-weight: 600; padding: 10px 16px; border-bottom: 1px solid var(--line);
  }
  .session-bar a { color: var(--accent-ink); }
  .session-bar .nav-links { display: flex; gap: 4px; }
  .session-bar .nav-links a {
    padding: 5px 12px; border-radius: 6px; color: var(--ink-soft); text-decoration: none;
  }
  .session-bar .nav-links a:hover { background: var(--line-soft); }
  .session-bar .nav-links a.active { background: var(--accent); color: #fff; }
  .session-bar .session-info { color: var(--ink-soft); }
`;

// The top bar shown on every logged-in page — which page you're on (with a
// link to the other one) plus who's logged in / log out. `active` is
// 'style' or 'bounties'.
function topBar({ active, username }) {
  return `<div class="session-bar">
    <span class="nav-links">
      <a href="/" class="${active === 'style' ? 'active' : ''}">Content &amp; Style</a>
      <a href="/bounties" class="${active === 'bounties' ? 'active' : ''}">Bounties</a>
      <a href="/tickets" class="${active === 'tickets' ? 'active' : ''}">Tickets</a>
      <a href="/leaderboard" class="${active === 'leaderboard' ? 'active' : ''}">Leaderboard</a>
    </span>
    <span class="session-info">Logged in as <strong>${esc(username)}</strong> · <a href="/logout">Log out</a></span>
  </div>`;
}

const BUTTON_STYLES = {
  requestBounty: 'success', // panel.js buildPanel()
  claimBounty: 'primary', // panel.js buildClaimPanel()
  talkToStaff: 'primary', // panel.js buildTicketPanel()
  askQuestion: 'primary', // panel.js buildQandAPanel()
  submit: 'success', // ticket.js previewButtons()
  close: 'danger', // ticket.js previewButtons()
  approveBounty: 'success', // ticket.js staffReviewButtons()
  denyBounty: 'danger', // ticket.js staffReviewButtons()
  approveClaim: 'success', // ticket.js claimReviewButtons()
  denyClaim: 'danger', // ticket.js claimReviewButtons()
  includeRequester: 'secondary', // ticket.js claimReviewButtons()
  closeHelp: 'danger', // ticket.js helpTicketButtons()
  claimPage: 'secondary', // index.js buildClaimPickerPayload() — Prev/Next
};

const DISCORD_STYLE_HEX = {
  success: '#248046',
  danger: '#da373c',
  primary: '#5865f2',
  secondary: '#4e5058',
};

function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

// Escapes for safe use in BOTH HTML text content and double-quoted HTML
// attributes (value="...", the shape every input/textarea on this page
// uses). Missing the quote/apostrophe escapes here was a real bug in an
// earlier version: a saved value containing a literal `"` (e.g. a line
// quoting something) silently truncated the value="..." attribute the next
// time the page rendered it, corrupting the saved content.
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// **bold** / *italic* → <b>/<em>, applied AFTER escaping so the markdown
// characters themselves are never HTML-escaped away.
function inline(str) {
  return esc(str)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
}

// Renders an already-effective array of lines (blank = paragraph break, '> '
// prefix = a quoted/rule line, **bold**/*italic* inline) into HTML.
function renderLines(lines) {
  const blocks = [];
  let quote = [];
  const flushQuote = () => {
    if (quote.length) {
      blocks.push(`<div class="quote">${quote.join('<br>')}</div>`);
      quote = [];
    }
  };
  for (const raw of lines) {
    const line = String(raw).trim();
    if (line === '') {
      flushQuote();
      continue;
    }
    if (line.startsWith('> ')) {
      quote.push(inline(line.slice(2)));
      continue;
    }
    flushQuote();
    blocks.push(`<p>${inline(line)}</p>`);
  }
  flushQuote();
  return blocks.join('\n');
}

function hex(num) {
  return '#' + num.toString(16).padStart(6, '0').toUpperCase();
}

function button(label, emoji, styleKey) {
  const style = BUTTON_STYLES[styleKey] ?? 'secondary';
  const emojiHtml = emoji ? `${esc(emoji)} ` : '';
  return `<span class="dbtn ${style}">${emojiHtml}${esc(label)}</span>`;
}

function panelPreview(title, descriptionText) {
  return `
    <div class="embed-preview">
      <div class="e-title">${esc(title)}</div>
      <div class="e-body">${renderLines(textToLines(descriptionText))}</div>
      <div class="e-foot">${esc(TEXT.FOOTER)}</div>
    </div>`;
}

function fieldTable(rows) {
  const body = rows
    .map((r) => `<tr><td>${esc(r.label)}</td><td class="mono">${esc(r.placeholder ?? '—')}</td><td>${esc(r.note)}</td></tr>`)
    .join('');
  return `<div class="table-wrap"><table class="field-table"><tr><th>Field</th><th>Placeholder</th><th>Note</th></tr>${body}</table></div>`;
}

function cardStateTable(rows) {
  const body = rows.map((r) => `<tr><td>${esc(r.state)}</td><td>${inline(r.title)}</td><td>${esc(r.color)}</td></tr>`).join('');
  return `<div class="table-wrap"><table class="field-table"><tr><th>State</th><th>Title</th><th>Embed color</th></tr>${body}</table></div>`;
}

function msgRow(trigger, text) {
  return `<div class="msg-row"><div class="trigger">${esc(trigger)}</div><div class="text">${inline(text)}</div></div>`;
}

// %s in a REPLIES string becomes this placeholder for display.
const withPlaceholder = (str, ph) => str.replace('%s', ph);

// Resolves every field belonging to a static unit (one listed in
// fieldSchema.FIELD_SCHEMA) into { path: currentEffectiveValue }. Multiline
// fields resolve to a single \n-joined string (ready for a <textarea> or for
// textToLines() when building a preview).
function staticUnitValues(unitId) {
  const values = {};
  for (const spec of fieldSchema.unitFields(unitId)) {
    const defaultRaw = getByPath(TEXT, spec.path);
    const defaultText = spec.multiline ? linesToText(defaultRaw) : defaultRaw;
    values[spec.path] = overrides.get(spec.path, defaultText);
  }
  return values;
}

// Same shape, for a Q&A topic unit — sourced from qandaTopics (which already
// resolves overrides vs. text.js defaults for the 6 original topics).
function topicUnitValues(id) {
  const t = qandaTopics.getTopic(id);
  return {
    [`QANDA.topics.${id}.label`]: t.label,
    [`QANDA.topics.${id}.description`]: t.description,
    [`QANDA.topics.${id}.title`]: t.title,
    [`QANDA.topics.${id}.body`]: linesToText(t.body),
  };
}

// Renders one self-contained unit: title, a preview built by the caller, and
// a save form with one input/textarea per field (pre-filled from `values`,
// unless this is the one unit that just failed validation — then its inputs
// show what was actually typed, with inline errors, and the preview above
// stays untouched/trustworthy since it's still built from `values`, never
// from the unvalidated attempt).
function renderUnit(unitId, title, previewHtml, values, failure) {
  const specs = fieldSchema.unitFields(unitId);
  const isFailedUnit = failure && failure.unitId === unitId;
  const errorByPath = isFailedUnit ? Object.fromEntries(failure.errors.map((e) => [e.path, e.message])) : {};

  const rows = specs
    .map((spec) => {
      const raw = isFailedUnit && failure.attempted[spec.path] !== undefined ? failure.attempted[spec.path] : values[spec.path];
      const err = errorByPath[spec.path];
      const hint = spec.hint ? `<br><span class="fhint">${esc(spec.hint)}</span>` : '';
      const control = spec.multiline
        ? `<textarea name="${esc(spec.path)}" class="ftextarea" rows="6">${esc(raw)}</textarea>`
        : `<input type="text" name="${esc(spec.path)}" value="${esc(raw)}" class="finput">`;
      return `
      <label class="frow${err ? ' has-error' : ''}">
        <span class="flabel">${esc(spec.label)}${hint}</span>
        ${control}
        ${err ? `<span class="field-error">⚠️ ${esc(err)}</span>` : ''}
      </label>`;
    })
    .join('');

  const failBanner = isFailedUnit
    ? `<div class="unit-fail-banner">⚠️ Not saved — fix the highlighted field${failure.errors.length > 1 ? 's' : ''} below and try again.</div>`
    : '';

  return `
    <div class="unit-card" id="unit-${esc(unitId)}">
      <h4 class="unit-title">${esc(title)}</h4>
      <div class="unit-preview">${previewHtml}</div>
      ${failBanner}
      <form method="POST" action="/edit/${esc(unitId)}" class="unit-form">
        ${rows}
        <button type="submit" class="save-btn">Save</button>
      </form>
    </div>`;
}

function buildStyleGuideHtml({ savedSection, failure, addTopicFailure, username } = {}) {
  const paletteSwatches = [
    { name: 'Ocean', hex: hex(COLORS.brand), use: 'Brand accent · pending bounty cards · every board\'s embed color' },
    { name: 'Turquoise', hex: hex(COLORS.approved), use: 'Approved bounty cards · "Approved" chip in the spreadsheet' },
    { name: 'Coral', hex: hex(COLORS.denied), use: '"Denied" chip in the spreadsheet only (denied tickets just close, no embed re-color)' },
    { name: 'Sand', hex: hex(COLORS.sand), use: 'Spreadsheet subtitle band' },
    { name: 'Navy', hex: hex(COLORS.navy), use: 'Spreadsheet header row / deep text' },
  ]
    .map(
      (s) => `
      <div class="swatch">
        <div class="chip" style="background:${s.hex}"></div>
        <div class="info"><div class="name">${esc(s.name)}</div><div class="hex">${s.hex}</div><div class="use">${esc(s.use)}</div></div>
      </div>`,
    )
    .join('');

  const discordSwatches = [
    { name: 'Success', hex: 'green', use: 'Go-forward actions: Submit, Approve, Approve Claim, Request Bounty' },
    { name: 'Danger', hex: 'red', use: 'Stop actions: Close, Deny, Deny Claim, Close Ticket' },
    { name: 'Primary', hex: 'blurple', use: 'Claim Bounty, Talk to Staff, Ask a Question' },
    { name: 'Secondary', hex: 'grey', use: 'Include Requester (a helper action, not a decision)' },
  ]
    .map(
      (s) => `
      <div class="swatch">
        <div class="chip" style="background:${DISCORD_STYLE_HEX[s.name.toLowerCase()]}"></div>
        <div class="info"><div class="name">${esc(s.name)}</div><div class="hex">${esc(s.hex)}</div><div class="use">${esc(s.use)}</div></div>
      </div>`,
    )
    .join('');

  // ══════════════════════════ Requesting a Bounty ══════════════════════
  const rv = {
    ...staticUnitValues('requesting-board'),
    ...staticUnitValues('requesting-form'),
    ...staticUnitValues('requesting-preview-buttons'),
    ...staticUnitValues('requesting-staff-buttons'),
    ...staticUnitValues('requesting-card'),
    ...staticUnitValues('requesting-messages'),
  };

  const requestingBoardHtml = renderUnit(
    'requesting-board',
    'Request Board',
    panelPreview(rv['PANEL.request.title'], rv['PANEL.request.description']) +
      `<div class="btn-row">${button(rv['PANEL.request.buttonLabel'], rv['PANEL.request.buttonEmoji'], 'requestBounty')}</div>
       <p class="btn-caption">Posted by <code class="mono">/deployrequestbounty</code>. Opens the request form.</p>`,
    staticUnitValues('requesting-board'),
    failure,
  );

  const requestingFormHtml = renderUnit(
    'requesting-form',
    'Request Form Fields',
    fieldTable([
      { label: rv['MODAL.bountyRequest.donator.label'], placeholder: rv['MODAL.bountyRequest.donator.placeholder'], note: rv['MODAL.bountyRequest.donator.description'] },
      { label: rv['MODAL.bountyRequest.name.label'], placeholder: rv['MODAL.bountyRequest.name.placeholder'], note: rv['MODAL.bountyRequest.name.description'] },
      { label: rv['MODAL.bountyRequest.groupType.label'], placeholder: 'Solo Only / Premade Allowed', note: rv['MODAL.bountyRequest.groupType.description'] },
      { label: rv['MODAL.bountyRequest.description.label'], placeholder: rv['MODAL.bountyRequest.description.placeholder'], note: rv['MODAL.bountyRequest.description.description'] },
      { label: rv['MODAL.bountyRequest.reward.label'], placeholder: rv['MODAL.bountyRequest.reward.placeholder'], note: rv['MODAL.bountyRequest.reward.description'] },
    ]) + `<p class="btn-caption">Modal title bar: <b>${esc(rv['MODAL.bountyRequest.title'])}</b></p>`,
    staticUnitValues('requesting-form'),
    failure,
  );

  const requestingPreviewButtonsHtml = renderUnit(
    'requesting-preview-buttons',
    'Preview Buttons (before a ticket exists)',
    `<div class="btn-row">
      ${button(rv['TICKET.submitButton'], rv['TICKET.submitEmoji'], 'submit')}
      ${button(rv['TICKET.closeButton'], rv['TICKET.closeEmoji'], 'close')}
    </div>`,
    staticUnitValues('requesting-preview-buttons'),
    failure,
  );

  const requestingStaffButtonsHtml = renderUnit(
    'requesting-staff-buttons',
    'Ticket Buttons (staff only)',
    `<div class="btn-row">
      ${button(rv['TICKET.approveBountyButton'], rv['TICKET.approveBountyEmoji'], 'approveBounty')}
      ${button(rv['TICKET.denyBountyButton'], rv['TICKET.denyBountyEmoji'], 'denyBounty')}
    </div>`,
    staticUnitValues('requesting-staff-buttons'),
    failure,
  );

  const requestingCardHtml = renderUnit(
    'requesting-card',
    'Bounty Card',
    cardStateTable([
      { state: 'Pending', title: `${rv['CARD.request.titlePrefix']} *{name}*`, color: 'Ocean' },
      { state: 'Approved', title: `${rv['CARD.request.approvedTitlePrefix']} *{name}*`, color: 'Turquoise' },
    ]) + `<p class="btn-caption">Fields shown: <b>${esc(rv['CARD.request.fieldRequester'])}</b>, <b>${esc(rv['CARD.request.fieldReward'])}</b>, <b>${esc(rv['CARD.request.fieldGroupType'])}</b>.</p>`,
    staticUnitValues('requesting-card'),
    failure,
  );

  const requestingMessagesHtml = renderUnit(
    'requesting-messages',
    'Messages',
    [
      msgRow('no staff configured', rv['REPLIES.missingRequestStaff']),
      msgRow('preview shown', rv['REPLIES.requestPreview']),
      msgRow('preview expired', rv['REPLIES.requestExpired']),
      msgRow('closed', rv['REPLIES.requestCancelled']),
      msgRow('duplicate title', withPlaceholder(rv['REPLIES.requestTitleTaken'], '{name}')),
      msgRow('ticket unpinged', rv['TICKET.noRequestStaffConfigured']),
    ].join(''),
    staticUnitValues('requesting-messages'),
    failure,
  );

  const requestingHtml = `
  <section class="block" id="requesting">
    <div class="block-head"><span class="glyph">${esc(rv['PANEL.request.buttonEmoji'])}</span><h2>Requesting a Bounty</h2></div>
    <p class="block-intro">A player proposes a bounty idea. Staff review it in a private ticket before it goes public.</p>
    ${requestingBoardHtml}
    ${requestingFormHtml}
    ${requestingPreviewButtonsHtml}
    ${requestingStaffButtonsHtml}
    ${requestingCardHtml}
    ${requestingMessagesHtml}
  </section>`;

  // ══════════════════════════ Claiming a Bounty ════════════════════════
  const cv = {
    ...staticUnitValues('claiming-board'),
    ...staticUnitValues('claiming-form'),
    ...staticUnitValues('claiming-picker'),
    ...staticUnitValues('claiming-staff-buttons'),
    ...staticUnitValues('claiming-card'),
    ...staticUnitValues('claiming-messages'),
  };

  const claimingBoardHtml = renderUnit(
    'claiming-board',
    'Claim Board',
    panelPreview(cv['PANEL.claim.title'], cv['PANEL.claim.description']) +
      `<div class="btn-row">${button(cv['PANEL.claim.buttonLabel'], cv['PANEL.claim.buttonEmoji'], 'claimBounty')}</div>
       <p class="btn-caption">Posted by <code class="mono">/deployclaimbounty</code>. Opens a searchable dropdown of approved bounties (paginated past 25).</p>`,
    staticUnitValues('claiming-board'),
    failure,
  );

  const claimingFormHtml = renderUnit(
    'claiming-form',
    'Claim Form Fields',
    fieldTable([
      { label: cv['MODAL.claimProof.notes.label'], placeholder: cv['MODAL.claimProof.notes.placeholder'], note: cv['MODAL.claimProof.notes.description'] },
      { label: cv['MODAL.claimProof.files.label'], placeholder: '—', note: cv['MODAL.claimProof.files.description'] },
    ]) + `<p class="btn-caption">Modal title prefix: <b>${esc(cv['MODAL.claimProof.titlePrefix'])}</b> (bounty name follows)</p>`,
    staticUnitValues('claiming-form'),
    failure,
  );

  const claimingPickerHtml = renderUnit(
    'claiming-picker',
    'Bounty Picker Dropdown',
    `<p class="btn-caption">Prompt: <b>${esc(cv['REPLIES.claimPickPrompt'])}</b> · Placeholder: <b>${esc(cv['REPLIES.claimSelectPlaceholder'])}</b></p>
     <div class="btn-row">
       ${button(cv['REPLIES.claimPrevButton'], null, 'claimPage')}
       ${button(cv['REPLIES.claimNextButton'], null, 'claimPage')}
     </div>`,
    staticUnitValues('claiming-picker'),
    failure,
  );

  const claimingStaffButtonsHtml = renderUnit(
    'claiming-staff-buttons',
    'Ticket Buttons (staff only)',
    `<div class="btn-row">
      ${button(cv['TICKET.approveClaimButton'], cv['TICKET.approveClaimEmoji'], 'approveClaim')}
      ${button(cv['TICKET.denyClaimButton'], cv['TICKET.denyClaimEmoji'], 'denyClaim')}
      ${button(cv['TICKET.includeRequesterButton'], cv['TICKET.includeRequesterEmoji'], 'includeRequester')}
      ${button(cv['TICKET.addPremadeButton'], cv['TICKET.addPremadeEmoji'], 'addPremade')}
    </div>
    <p class="btn-caption">"${esc(cv['TICKET.addPremadeButton'])}" only shows up on premade-type claims. Its search placeholder: <b>${esc(cv['TICKET.addPremadePlaceholder'])}</b></p>`,
    staticUnitValues('claiming-staff-buttons'),
    failure,
  );

  const claimingCardHtml = renderUnit(
    'claiming-card',
    'Claim Card',
    cardStateTable([
      { state: 'Pending', title: `${cv['CARD.claim.titlePrefix']} *{name}*`, color: 'Ocean' },
      { state: 'Approved', title: `${cv['CARD.claimedTitlePrefix']} *{name}*`, color: 'Turquoise' },
    ]) +
      `<p class="btn-caption">Fields shown: <b>${esc(cv['CARD.claim.fieldClaimant'])}</b>, <b>${esc(cv['CARD.claim.fieldReward'])}</b>, <b>${esc(cv['CARD.claim.fieldOriginalRequester'])}</b> (dropped from the public claim board post — ticket-only).</p>`,
    staticUnitValues('claiming-card'),
    failure,
  );

  const claimingMessagesHtml = renderUnit(
    'claiming-messages',
    'Messages',
    [
      msgRow('no staff configured', cv['REPLIES.missingClaimStaff']),
      msgRow('nothing to claim', cv['REPLIES.noClaimableBounties']),
      msgRow('already claimed', `${cv['REPLIES.claimBountyUnavailable']} / ${cv['REPLIES.claimNoLongerAvailable']}`),
      msgRow('approve race lost', cv['REPLIES.claimFinalizeFailed']),
      msgRow('include requester failed', cv['REPLIES.includeRequesterFailed']),
      msgRow('ticket unpinged', cv['TICKET.noClaimStaffConfigured']),
    ].join(''),
    staticUnitValues('claiming-messages'),
    failure,
  );

  const claimingHtml = `
  <section class="block" id="claiming">
    <div class="block-head"><span class="glyph">${esc(cv['PANEL.claim.buttonEmoji'])}</span><h2>Claiming a Bounty</h2></div>
    <p class="block-intro">A player who completed an approved bounty submits proof. No preview step — the proof itself is the submission.</p>
    ${claimingBoardHtml}
    ${claimingFormHtml}
    ${claimingPickerHtml}
    ${claimingStaffButtonsHtml}
    ${claimingCardHtml}
    ${claimingMessagesHtml}
  </section>`;

  // ══════════════════════════ Getting Help ═════════════════════════════
  const hv = {
    ...staticUnitValues('help-support-board'),
    ...staticUnitValues('help-support-form'),
    ...staticUnitValues('help-support-button'),
    ...staticUnitValues('help-support-messages'),
    ...staticUnitValues('help-qanda-board'),
  };

  const helpSupportBoardHtml = renderUnit(
    'help-support-board',
    'Support Board',
    panelPreview(hv['PANEL.ticket.title'], hv['PANEL.ticket.description']) +
      `<div class="btn-row">${button(hv['PANEL.ticket.buttonLabel'], hv['PANEL.ticket.buttonEmoji'], 'talkToStaff')}</div>
       <p class="btn-caption">Posted by <code class="mono">/deployticket</code>. Opens an optional Subject/Details form, then creates a ticket.</p>`,
    staticUnitValues('help-support-board'),
    failure,
  );

  const helpSupportFormHtml = renderUnit(
    'help-support-form',
    'Support Form Fields',
    fieldTable([
      { label: hv['MODAL.ticketDetails.subject.label'], placeholder: hv['MODAL.ticketDetails.subject.placeholder'], note: hv['MODAL.ticketDetails.subject.description'] },
      { label: hv['MODAL.ticketDetails.body.label'], placeholder: hv['MODAL.ticketDetails.body.placeholder'], note: hv['MODAL.ticketDetails.body.description'] },
    ]) + `<p class="btn-caption">Modal title bar: <b>${esc(hv['MODAL.ticketDetails.title'])}</b></p>`,
    staticUnitValues('help-support-form'),
    failure,
  );

  const helpSupportButtonHtml = renderUnit(
    'help-support-button',
    'Ticket Button (staff only)',
    `<div class="btn-row">${button(hv['TICKET.closeHelpButton'], hv['TICKET.closeHelpEmoji'], 'closeHelp')}</div>
     <p class="btn-caption">No approve/deny here, just closes it.</p>`,
    staticUnitValues('help-support-button'),
    failure,
  );

  const helpSupportMessagesHtml = renderUnit(
    'help-support-messages',
    'Messages',
    [
      msgRow('no staff configured', hv['REPLIES.missingTicketStaff']),
      msgRow('ticket unpinged', hv['TICKET.noHelpStaffConfigured']),
    ].join(''),
    staticUnitValues('help-support-messages'),
    failure,
  );

  const helpQandaBoardHtml = renderUnit(
    'help-qanda-board',
    'Q&A Board',
    panelPreview(hv['PANEL.qanda.title'], hv['PANEL.qanda.description']) +
      `<div class="btn-row">${button(hv['PANEL.qanda.buttonLabel'], hv['PANEL.qanda.buttonEmoji'], 'askQuestion')}</div>
       <p class="btn-caption">Posted by <code class="mono">/deployqanda</code>. Replies with a topic dropdown — "${esc(hv['QANDA.prompt'])}" (placeholder: "${esc(hv['QANDA.selectPlaceholder'])}")</p>`,
    staticUnitValues('help-qanda-board'),
    failure,
  );

  const qandaTopicUnitsHtml = qandaTopics
    .getAllTopics()
    .map((topic) => {
      const unitId = `qanda-topic-${topic.id}`;
      const values = topicUnitValues(topic.id);
      const preview = `
        <div class="topic">
          <div class="t-label">${esc(values[`QANDA.topics.${topic.id}.label`])} — ${esc(values[`QANDA.topics.${topic.id}.description`])}</div>
          <div class="t-title">${esc(values[`QANDA.topics.${topic.id}.title`])}</div>
          <div class="t-body">${renderLines(textToLines(values[`QANDA.topics.${topic.id}.body`]))}</div>
        </div>`;
      const removeForm = `
        <form method="POST" action="/qanda/topics/${esc(topic.id)}/delete" class="remove-form">
          <button type="submit" class="remove-btn">Remove this topic</button>
        </form>`;
      return renderUnit(unitId, `Q&A Topic: ${topic.title || topic.id}`, preview + removeForm, values, failure);
    })
    .join('');

  const addTopicErrors = addTopicFailure ? Object.fromEntries(addTopicFailure.errors.map((e) => [e.path, e.message])) : {};
  const addTopicVal = (path) => (addTopicFailure ? addTopicFailure.attempted[path] ?? '' : '');
  const addTopicField = (path, label, multiline) => {
    const err = addTopicErrors[path];
    const control = multiline
      ? `<textarea name="${esc(path)}" class="ftextarea" rows="6">${esc(addTopicVal(path))}</textarea>`
      : `<input type="text" name="${esc(path)}" value="${esc(addTopicVal(path))}" class="finput">`;
    return `
      <label class="frow${err ? ' has-error' : ''}">
        <span class="flabel">${esc(label)}</span>
        ${control}
        ${err ? `<span class="field-error">⚠️ ${esc(err)}</span>` : ''}
      </label>`;
  };
  const addTopicHtml = `
    <div class="unit-card" id="unit-qanda-add-topic">
      <h4 class="unit-title">Add a New Topic</h4>
      ${addTopicFailure ? `<div class="unit-fail-banner">⚠️ Not added — fix the highlighted field${addTopicFailure.errors.length > 1 ? 's' : ''} below and try again.</div>` : ''}
      <form method="POST" action="/qanda/topics" class="unit-form">
        ${addTopicField('label', 'Dropdown label')}
        ${addTopicField('description', 'Dropdown description')}
        ${addTopicField('title', 'Answer title')}
        ${addTopicField('body', 'Answer body', true)}
        <button type="submit" class="save-btn">Add Topic</button>
      </form>
    </div>`;

  const helpHtml = `
  <section class="block" id="help">
    <div class="block-head"><span class="glyph">${esc(hv['PANEL.ticket.buttonEmoji'])}</span><h2>Getting Help</h2></div>
    <p class="block-intro">Two separate boards. Q&amp;A never touches staff or creates a ticket; Talk to Staff always does.</p>
    ${helpSupportBoardHtml}
    ${helpSupportFormHtml}
    ${helpSupportButtonHtml}
    ${helpSupportMessagesHtml}
    ${helpQandaBoardHtml}
    <h3 class="sub-head">Q&amp;A Topics</h3>
    ${qandaTopicUnitsHtml}
    ${addTopicHtml}
  </section>`;

  const savedBanner = savedSection ? `<div class="toast">✅ Saved.</div>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lumi-chan — Content &amp; Style Reference</title>
<style>
${BASE_STYLES}
  .wrap { max-width: 880px; margin: 0 auto; padding: 0 28px 120px; }
  .toast {
    max-width: 880px; margin: 20px auto 0; padding: 12px 18px; border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 16%, var(--paper-raised)); color: var(--accent-ink);
    font-weight: 600; font-size: 14px; text-align: center;
  }
  .masthead { padding: 64px 0 36px; border-bottom: 1px solid var(--line); }
  .masthead .eyebrow {
    font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12.5px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--accent-ink); margin: 0 0 14px;
  }
  .masthead h1 { font-size: clamp(32px, 5vw, 44px); line-height: 1.08; }
  .masthead p.sub { margin: 14px 0 0; max-width: 62ch; color: var(--ink-soft); font-size: 17px; }
  .masthead .meta { margin-top: 22px; display: flex; gap: 18px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
  .masthead .meta span { white-space: nowrap; }
  nav.jump {
    position: sticky; top: 0; z-index: 20; background: color-mix(in srgb, var(--paper) 92%, transparent);
    backdrop-filter: blur(8px); border-bottom: 1px solid var(--line);
  }
  nav.jump .wrap {
    padding: 0 28px; max-width: 880px; display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none;
  }
  nav.jump .wrap::-webkit-scrollbar { display: none; }
  nav.jump a {
    flex: none; padding: 13px 14px; font-size: 13.5px; font-weight: 600; color: var(--ink-soft);
    text-decoration: none; border-bottom: 2px solid transparent; white-space: nowrap;
  }
  nav.jump a:hover { color: var(--accent-ink); }
  section.block { padding: 56px 0; border-bottom: 1px solid var(--line); }
  section.block:last-of-type { border-bottom: none; }
  .block-head { display: flex; align-items: baseline; gap: 14px; margin-bottom: 8px; }
  .block-head .glyph { font-size: 26px; line-height: 1; }
  .block-head h2 { font-size: 26px; }
  .block-intro { color: var(--ink-soft); max-width: 66ch; margin: 10px 0 32px; font-size: 15.5px; }
  h3.sub-head {
    font-size: 13px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--muted);
    font-family: ui-monospace, "SF Mono", Menlo, monospace; font-weight: 600; margin: 40px 0 14px;
  }
  .embed-preview {
    background: var(--paper-raised); border: 1px solid var(--line); border-left: 4px solid #2AA9D8;
    border-radius: 6px; padding: 16px 18px; box-shadow: var(--shadow);
  }
  .embed-preview .e-title { font-weight: 700; font-size: 16px; margin-bottom: 8px; }
  .embed-preview .e-body { font-size: 14.5px; color: var(--ink-soft); }
  .embed-preview .e-body p { margin: 0 0 10px; }
  .embed-preview .e-body p:last-child { margin-bottom: 0; }
  .embed-preview .e-body .quote {
    margin: 10px 0 0; padding: 8px 0 8px 14px; border-left: 2px solid var(--line);
    font-size: 14px; color: var(--ink-soft); line-height: 1.7;
  }
  .embed-preview .e-foot {
    margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line-soft); font-size: 12px; color: var(--muted);
  }
  .btn-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
  .dbtn {
    display: inline-flex; align-items: center; gap: 7px; padding: 8px 15px; border-radius: 4px;
    font-size: 13.5px; font-weight: 600; color: #fff; font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .dbtn.success { background: #248046; }
  .dbtn.danger { background: #da373c; }
  .dbtn.primary { background: #5865f2; }
  .dbtn.secondary { background: #4e5058; }
  .btn-caption { font-size: 12px; color: var(--muted); margin-top: 8px; }
  table.field-table { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 4px; }
  table.field-table th {
    text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted);
    font-weight: 600; padding: 0 12px 8px 0; border-bottom: 1px solid var(--line);
  }
  table.field-table td {
    padding: 11px 12px 11px 0; border-bottom: 1px solid var(--line-soft); vertical-align: top; color: var(--ink-soft);
  }
  table.field-table td:first-child { color: var(--ink); font-weight: 600; white-space: nowrap; }
  table.field-table tr:last-child td { border-bottom: none; }
  .table-wrap { overflow-x: auto; }
  .swatch-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; margin-top: 14px; }
  .swatch { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--paper-raised); box-shadow: var(--shadow); }
  .swatch .chip { height: 52px; }
  .swatch .info { padding: 10px 12px; }
  .swatch .name { font-weight: 700; font-size: 13.5px; }
  .swatch .hex { font-family: ui-monospace, monospace; font-size: 12px; color: var(--muted); margin-top: 2px; }
  .swatch .use { font-size: 12px; color: var(--ink-soft); margin-top: 6px; line-height: 1.4; }
  .palette-note {
    background: var(--paper-raised); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px;
    font-size: 13.5px; color: var(--ink-soft); margin-top: 18px;
  }
  .palette-note strong { color: var(--ink); }
  .msg-row { display: grid; grid-template-columns: minmax(140px, 220px) 1fr; gap: 14px; padding: 11px 0; border-bottom: 1px solid var(--line-soft); font-size: 13.5px; }
  .msg-row:last-child { border-bottom: none; }
  .msg-row .trigger { color: var(--muted); font-family: ui-monospace, monospace; font-size: 12.5px; padding-top: 1px; }
  .msg-row .text { color: var(--ink-soft); }
  .msg-row .text b { color: var(--ink); }
  .topic { background: var(--paper-raised); border-radius: 6px; padding: 4px 2px 14px; }
  .topic .t-label { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  .topic .t-title { font-weight: 700; font-size: 15.5px; margin-bottom: 10px; }
  .topic .t-body { font-size: 14px; color: var(--ink-soft); }
  .topic .t-body p { margin: 0 0 8px; }
  .topic .t-body p:last-child { margin-bottom: 0; }
  .topic .t-body .quote { border-left: 2px solid var(--line); padding-left: 12px; margin: 6px 0; color: var(--ink-soft); line-height: 1.7; }
  .topic .t-body b { color: var(--ink); }
  .unit-card { margin: 28px 0; padding: 20px 22px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper-raised); box-shadow: var(--shadow); }
  .unit-card:first-of-type { margin-top: 8px; }
  .unit-title { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-family: ui-monospace, monospace; margin: 0 0 14px; }
  .unit-preview { }
  .unit-fail-banner { background: var(--warn-bg); color: var(--warn); font-size: 13px; font-weight: 600; padding: 10px 14px; border-radius: 6px; margin: 14px 0 0; }
  .unit-form { margin-top: 18px; padding-top: 16px; border-top: 1px dashed var(--line); display: flex; flex-direction: column; gap: 12px; }
  .remove-form { margin-top: 10px; }
  .remove-btn {
    padding: 7px 14px; border-radius: 6px; border: 1px solid var(--warn); background: transparent; color: var(--warn);
    font-weight: 600; font-size: 12.5px; cursor: pointer;
  }
  .remove-btn:hover { background: var(--warn-bg); }
  .frow { display: grid; grid-template-columns: minmax(160px, 280px) 1fr; gap: 14px; align-items: start; font-size: 13.5px; }
  .flabel { color: var(--ink-soft); padding-top: 9px; }
  .fhint { color: var(--muted); font-size: 11.5px; font-weight: 400; }
  .finput, .ftextarea {
    width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px;
    background: var(--paper); color: var(--ink); font-family: inherit; font-size: 13.5px;
  }
  .ftextarea { min-height: 110px; resize: vertical; }
  .finput:focus, .ftextarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  .frow.has-error .finput, .frow.has-error .ftextarea { border-color: var(--warn); }
  .field-error { grid-column: 2; color: var(--warn); font-size: 12px; }
  .save-btn {
    align-self: flex-start; margin-top: 8px; padding: 10px 22px; border-radius: 6px; border: none;
    background: var(--accent); color: #fff; font-weight: 700; font-size: 14px; cursor: pointer;
  }
  .save-btn:hover { background: var(--accent-ink); }
  .save-btn:focus-visible, .remove-btn:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 2px; }
  footer.doc-foot { padding: 40px 0 10px; color: var(--muted); font-size: 12.5px; }
  @media (max-width: 640px) {
    .masthead { padding: 44px 0 28px; }
    section.block { padding: 40px 0; }
    .frow { grid-template-columns: 1fr; gap: 6px; }
    .field-error { grid-column: 1; }
  }
</style>
</head>
<body>

${topBar({ active: 'style', username })}

<nav class="jump">
  <div class="wrap">
    <a href="#palette">Palette</a>
    <a href="#requesting">Requesting</a>
    <a href="#claiming">Claiming</a>
    <a href="#help">Help &amp; Q&amp;A</a>
  </div>
</nav>

${savedBanner}
${failure ? `<div class="toast" style="background:color-mix(in srgb, var(--warn) 16%, var(--paper-raised)); color:var(--warn);">⚠️ Not saved — <a href="#unit-${esc(failure.unitId)}" style="color:inherit;">jump to the error</a></div>` : ''}
${addTopicFailure ? `<div class="toast" style="background:color-mix(in srgb, var(--warn) 16%, var(--paper-raised)); color:var(--warn);">⚠️ Topic not added — <a href="#unit-qanda-add-topic" style="color:inherit;">jump to the error</a></div>` : ''}

<div class="wrap">

  <header class="masthead">
    <p class="eyebrow">Lumi-chan</p>
    <h1>Content &amp; Style Reference</h1>
    <p class="sub">Every board, button, form, and message the bot sends, organized by what a player is actually doing. The preview at the top of each card is live; the form below it edits the bot directly.</p>
    <div class="meta">
      <span>Source: <code class="mono">src/text.js</code> + saved edits</span>
      <span>Rendered at request time</span>
    </div>
  </header>

  <section class="block" id="palette">
    <div class="block-head"><h2>Palette &amp; Materials</h2></div>
    <p class="block-intro">Two separate color systems are in play. The bot's own palette controls embed accents and the spreadsheet export. Discord's four button styles are fixed by the platform — buttons can only ever be one of these four, never a custom hex. Colors aren't editable here yet — this section is reference only.</p>
    <h3 class="sub-head">Bot embed palette</h3>
    <div class="swatch-grid">${paletteSwatches}</div>
    <h3 class="sub-head">Discord button colors (fixed by Discord)</h3>
    <div class="swatch-grid">${discordSwatches}</div>
    <div class="palette-note">
      <strong>Banner image</strong> — every board and card carries the same art (<span class="mono">${esc(TEXT.VISUALS.BANNER_URL)}</span>). <strong>Footer</strong> — every embed ends with <em>"${esc(TEXT.FOOTER)}"</em>.
    </div>
  </section>
  ${requestingHtml}
  ${claimingHtml}
  ${helpHtml}

  <footer class="doc-foot">
    Defaults come from <code class="mono">src/text.js</code>; saved edits are layered on top in the database and win over the default — and now actually change what the bot posts to Discord, not just this page. Nothing here ever changes text.js itself.
  </footer>

</div>
</body>
</html>`;
}

// The page shown at GET /login before Discord is ever involved — a plain
// "Continue with Discord" button, so the admin's first sight of this tool
// isn't an unbranded bounce straight into Discord's own domain. `error`, if
// present, is an already-human-readable message (server.js decides what to
// say; this just displays it).
function buildLoginPageHtml({ error } = {}) {
  const errorHtml = error
    ? `<div class="login-error">⚠️ ${esc(error)}</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lumi-chan — Admin Login</title>
<style>
${BASE_STYLES}
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
  .login-card {
    max-width: 380px; width: 100%; background: var(--paper-raised); border: 1px solid var(--line);
    border-radius: 14px; box-shadow: var(--shadow); padding: 36px 32px; text-align: center;
  }
  .login-card .eyebrow {
    font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--accent-ink); margin: 0 0 10px;
  }
  .login-card h1 { font-size: 22px; margin: 0 0 10px; }
  .login-card p { color: var(--ink-soft); font-size: 14.5px; margin: 0 0 26px; }
  .discord-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    width: 100%; padding: 13px 20px; border-radius: 8px; border: none;
    background: #5865f2; color: #fff; font-weight: 700; font-size: 15px;
    text-decoration: none; cursor: pointer;
  }
  .discord-btn:hover { background: #4752c4; }
  .google-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    width: 100%; padding: 12px 20px; border-radius: 8px; border: 1px solid var(--line);
    background: #fff; color: #1f1f1f; font-weight: 700; font-size: 15px;
    text-decoration: none; cursor: pointer; margin-top: 12px;
  }
  .google-btn:hover { background: #f7f7f7; }
  .btn-divider {
    display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 12px;
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin: 18px 0;
  }
  .btn-divider::before, .btn-divider::after { content: ''; flex: 1; height: 1px; background: var(--line); }
  .login-error {
    background: var(--warn-bg); color: var(--warn); font-size: 13.5px; font-weight: 600;
    padding: 10px 14px; border-radius: 8px; margin: 0 0 20px;
  }
</style>
</head>
<body>
  <div class="login-card">
    <p class="eyebrow">Lumi-chan</p>
    <h1>Admin Login</h1>
    <p>Sign in to view and edit the bot's content &amp; style reference.</p>
    ${errorHtml}
    <a class="discord-btn" href="/login/discord">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.07.07 0 0 0-.075.035c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.036 19.736 19.736 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127c-.598.35-1.22.645-1.873.893a.076.076 0 0 0-.041.106c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.673-3.549-13.66a.061.061 0 0 0-.031-.028ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.955 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.946 2.419-2.157 2.419Z"/></svg>
      Continue with Discord
    </a>
    <div class="btn-divider">or</div>
    <a class="google-btn" href="/login/google">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.616z"/>
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.26c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
        <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
      </svg>
      Continue with Google
    </a>
  </div>
</body>
</html>`;
}

// Admin pages (bounties, tickets) and exports all show timestamps in both
// Pacific and Eastern regardless of the server's own timezone (Railway
// defaults to UTC) - PT first, then ET, since that's the order the team asked for.
const DATE_TZ_OPTS = { dateStyle: 'medium', timeZone: 'America/New_York' };
const TIME_TZ_OPTS = { hour: 'numeric', minute: '2-digit', hour12: true };

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  const date = d.toLocaleDateString('en-US', DATE_TZ_OPTS);
  // Clock time is correctly DST-adjusted per zone; the "PST"/"EST" suffixes
  // are fixed labels per request rather than Intl's DST-aware PDT/EDT.
  const pt = d.toLocaleTimeString('en-US', { ...TIME_TZ_OPTS, timeZone: 'America/Los_Angeles' });
  const et = d.toLocaleTimeString('en-US', { ...TIME_TZ_OPTS, timeZone: 'America/New_York' });
  return `${date}, ${pt} PST · ${et} EST`;
}

// Same PT/ET pairing as fmtDate, but with the day written the way Discord's
// own auto-localized timestamps used to read ("Today"/"Yesterday"/short
// M/D/YY) — used on bounty cards (src/bountyCard.js), which want that
// shorter, friendlier phrasing instead of fmtDate's full "medium" date.
// "Today"/"Yesterday" are bucketed by the Eastern calendar day specifically
// (not the viewer's own day) so it's a fixed, consistent boundary for
// everyone — the whole reason cards moved off Discord's real per-viewer
// auto-localized timestamp in the first place.
function fmtDateRelative(value) {
  if (!value) return '—';
  const d = new Date(value);
  const now = new Date();

  const dayKey = (date) => date.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const dKey = dayKey(d);

  const pt = d.toLocaleTimeString('en-US', { ...TIME_TZ_OPTS, timeZone: 'America/Los_Angeles' });
  const et = d.toLocaleTimeString('en-US', { ...TIME_TZ_OPTS, timeZone: 'America/New_York' });

  let day;
  if (dKey === todayKey) day = 'Today';
  else if (dKey === yesterdayKey) day = 'Yesterday';
  else day = d.toLocaleDateString('en-US', { dateStyle: 'short', timeZone: 'America/New_York' });

  return `${day}, ${pt} PST · ${et} EST`;
}

module.exports = { buildStyleGuideHtml, buildLoginPageHtml, BASE_STYLES, topBar, esc, fmtDate, fmtDateRelative };
