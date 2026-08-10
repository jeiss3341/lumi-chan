// Single source of truth for every editable field on the style-guide page:
// which "unit" (self-contained card) it belongs to, what Discord API
// constraint governs it, and its form label. Used by BOTH src/styleGuide/styleGuide.js
// (to render labels/hints/textareas) and src/styleGuide/server.js (to validate a
// submission before saving) — never hand-typed in two places.
//
// FIELD_KINDS' min/max values are verified against the actual installed
// @discordjs/builders validator source (Sapphire Shapeshift schemas), not
// guessed or copied from docs. Each has a `note` recording where it came
// from, since a wrong number here either wrongly blocks a valid edit or
// wrongly lets one through that Discord will reject when the bot tries to
// actually use it.
const FIELD_KINDS = {
  embedTitle: { min: 1, max: 256, note: 'EmbedBuilder.setTitle — titlePredicate' },
  embedDescription: { min: 1, max: 4096, note: 'EmbedBuilder.setDescription — descriptionPredicate' },
  embedFieldName: { min: 1, max: 256, note: 'EmbedBuilder field name — fieldNamePredicate' },
  buttonLabel: { min: 1, max: 80, note: 'ButtonBuilder.setLabel — buttonLabelValidator' },
  modalTitle: { min: 1, max: 45, note: 'ModalBuilder.setTitle — titleValidator' },
  // MODAL.claimProof's title is a prefix concatenated with the bounty name,
  // then .slice(0, 45)'d in modal.js — so it can never crash the modal, but
  // keeping this cap well under 45 leaves room for the name to stay visible.
  modalTitlePrefix: { min: 1, max: 20, note: 'Practical cap — modal.js already slices the combined title to 45 chars; a short prefix leaves room for the bounty name' },
  modalFieldLabel: { min: 1, max: 45, note: 'LabelBuilder.setLabel — labelPredicate' },
  modalFieldHelp: { min: 1, max: 100, note: 'LabelBuilder.setDescription — labelPredicate (always set in this codebase, so effectively required)' },
  modalPlaceholder: { min: 0, max: 100, note: 'TextInputBuilder.setPlaceholder — placeholderValidator' },
  selectOptionLabel: { min: 1, max: 100, note: 'StringSelectMenuOptionBuilder label — labelValueDescriptionValidator' },
  selectOptionDesc: { min: 1, max: 100, note: 'StringSelectMenuOptionBuilder description — labelValueDescriptionValidator' },
  selectPlaceholder: { min: 0, max: 150, note: 'StringSelectMenuBuilder.setPlaceholder' },
  // Discord validates emoji SHAPE, not a plain length range — this is a soft
  // cap that only exists to block someone pasting a huge string into an
  // emoji field, not a real Discord constraint.
  emojiField: { min: 1, max: 32, note: 'Soft cap only — not a real Discord API limit, just blocks garbage paste' },
  // Card title prefixes get concatenated with a bounty name the admin
  // doesn't control at edit time (up to 100 chars — modal.js's own
  // maxLength on the name field). Embed title hard-caps at 256; capping the
  // prefix at 100 leaves >55 chars of headroom even in the worst case.
  cardTitlePrefix: { min: 1, max: 100, note: 'Practical cap — concatenated with an admin-uncontrolled bounty name (up to 100 chars per modal.js), embed title hard limit is 256' },
  // TEXT.REPLIES.* and TEXT.TICKET.no*StaffConfigured are all sent as plain
  // `content:` on a message/interaction reply (confirmed via index.js), not
  // embed fields — Discord's plain message content cap applies, not the
  // embed limits above.
  messageContent: { min: 1, max: 2000, note: 'Plain Discord message content cap — confirmed these are all sent as content:, not embed fields' },
};

// { unit, path, kind, label, multiline? }
const FIELD_SCHEMA = [
  // ── Requesting a Bounty ──────────────────────────────────────────────
  { unit: 'requesting-board', path: 'PANEL.request.title', kind: 'embedTitle', label: 'Board title' },
  { unit: 'requesting-board', path: 'PANEL.request.description', kind: 'embedDescription', label: 'Board description', multiline: true, hint: 'Blank line = paragraph break. Start a line with "> " for a bullet.' },
  { unit: 'requesting-board', path: 'PANEL.request.buttonLabel', kind: 'buttonLabel', label: 'Button label' },
  { unit: 'requesting-board', path: 'PANEL.request.buttonEmoji', kind: 'emojiField', label: 'Button emoji' },

  { unit: 'requesting-form', path: 'MODAL.bountyRequest.title', kind: 'modalTitle', label: 'Form title (modal title bar)' },
  { unit: 'requesting-form', path: 'MODAL.bountyRequest.donator.label', kind: 'modalFieldLabel', label: 'Preferred Name field — label' },
  { unit: 'requesting-form', path: 'MODAL.bountyRequest.donator.description', kind: 'modalFieldHelp', label: 'Preferred Name field — helper text' },
  { unit: 'requesting-form', path: 'MODAL.bountyRequest.donator.placeholder', kind: 'modalPlaceholder', label: 'Preferred Name field — placeholder' },
  { unit: 'requesting-form', path: 'MODAL.bountyRequest.name.label', kind: 'modalFieldLabel', label: 'Name field — label' },
  { unit: 'requesting-form', path: 'MODAL.bountyRequest.name.description', kind: 'modalFieldHelp', label: 'Name field — helper text' },
  { unit: 'requesting-form', path: 'MODAL.bountyRequest.name.placeholder', kind: 'modalPlaceholder', label: 'Name field — placeholder' },
  { unit: 'requesting-form', path: 'MODAL.bountyRequest.description.label', kind: 'modalFieldLabel', label: 'Description field — label' },
  { unit: 'requesting-form', path: 'MODAL.bountyRequest.description.description', kind: 'modalFieldHelp', label: 'Description field — helper text' },
  { unit: 'requesting-form', path: 'MODAL.bountyRequest.description.placeholder', kind: 'modalPlaceholder', label: 'Description field — placeholder' },
  { unit: 'requesting-form', path: 'MODAL.bountyRequest.reward.label', kind: 'modalFieldLabel', label: 'Reward field — label' },
  { unit: 'requesting-form', path: 'MODAL.bountyRequest.reward.description', kind: 'modalFieldHelp', label: 'Reward field — helper text' },
  { unit: 'requesting-form', path: 'MODAL.bountyRequest.reward.placeholder', kind: 'modalPlaceholder', label: 'Reward field — placeholder' },
  { unit: 'requesting-form', path: 'MODAL.bountyRequest.groupType.label', kind: 'modalFieldLabel', label: 'Group Type field — label' },
  { unit: 'requesting-form', path: 'MODAL.bountyRequest.groupType.description', kind: 'modalFieldHelp', label: 'Group Type field — helper text' },

  { unit: 'requesting-preview-buttons', path: 'TICKET.submitButton', kind: 'buttonLabel', label: 'Submit — label' },
  { unit: 'requesting-preview-buttons', path: 'TICKET.submitEmoji', kind: 'emojiField', label: 'Submit — emoji' },
  { unit: 'requesting-preview-buttons', path: 'TICKET.closeButton', kind: 'buttonLabel', label: 'Close — label' },
  { unit: 'requesting-preview-buttons', path: 'TICKET.closeEmoji', kind: 'emojiField', label: 'Close — emoji' },

  { unit: 'requesting-staff-buttons', path: 'TICKET.approveBountyButton', kind: 'buttonLabel', label: 'Approve — label' },
  { unit: 'requesting-staff-buttons', path: 'TICKET.approveBountyEmoji', kind: 'emojiField', label: 'Approve — emoji' },
  { unit: 'requesting-staff-buttons', path: 'TICKET.denyBountyButton', kind: 'buttonLabel', label: 'Deny — label' },
  { unit: 'requesting-staff-buttons', path: 'TICKET.denyBountyEmoji', kind: 'emojiField', label: 'Deny — emoji' },

  { unit: 'requesting-card', path: 'CARD.request.titlePrefix', kind: 'cardTitlePrefix', label: 'Card title (pending)' },
  { unit: 'requesting-card', path: 'CARD.request.approvedTitlePrefix', kind: 'cardTitlePrefix', label: 'Card title (approved)' },
  { unit: 'requesting-card', path: 'CARD.request.fieldRequester', kind: 'embedFieldName', label: 'Card field name — requester' },
  { unit: 'requesting-card', path: 'CARD.request.fieldReward', kind: 'embedFieldName', label: 'Card field name — reward' },
  { unit: 'requesting-card', path: 'CARD.request.fieldGroupType', kind: 'embedFieldName', label: 'Card field name — group type' },

  { unit: 'requesting-messages', path: 'REPLIES.missingRequestStaff', kind: 'messageContent', label: 'Message — no staff configured' },
  { unit: 'requesting-messages', path: 'REPLIES.requestPreview', kind: 'messageContent', label: 'Message — preview shown' },
  { unit: 'requesting-messages', path: 'REPLIES.requestExpired', kind: 'messageContent', label: 'Message — preview expired' },
  { unit: 'requesting-messages', path: 'REPLIES.requestCancelled', kind: 'messageContent', label: 'Message — closed' },
  { unit: 'requesting-messages', path: 'REPLIES.requestTitleTaken', kind: 'messageContent', label: 'Message — duplicate title', hint: 'Keep %s in the text — it gets replaced with the bounty name.' },
  { unit: 'requesting-messages', path: 'TICKET.noRequestStaffConfigured', kind: 'messageContent', label: 'Message — ticket unpinged' },

  // ── Claiming a Bounty ────────────────────────────────────────────────
  { unit: 'claiming-board', path: 'PANEL.claim.title', kind: 'embedTitle', label: 'Board title' },
  { unit: 'claiming-board', path: 'PANEL.claim.description', kind: 'embedDescription', label: 'Board description', multiline: true, hint: 'Blank line = paragraph break. Start a line with "> " for a bullet.' },
  { unit: 'claiming-board', path: 'PANEL.claim.buttonLabel', kind: 'buttonLabel', label: 'Button label' },
  { unit: 'claiming-board', path: 'PANEL.claim.buttonEmoji', kind: 'emojiField', label: 'Button emoji' },

  { unit: 'claiming-form', path: 'MODAL.claimProof.titlePrefix', kind: 'modalTitlePrefix', label: 'Form title prefix (before the bounty name)' },
  { unit: 'claiming-form', path: 'MODAL.claimProof.notes.label', kind: 'modalFieldLabel', label: 'Proof field — label' },
  { unit: 'claiming-form', path: 'MODAL.claimProof.notes.description', kind: 'modalFieldHelp', label: 'Proof field — helper text' },
  { unit: 'claiming-form', path: 'MODAL.claimProof.notes.placeholder', kind: 'modalPlaceholder', label: 'Proof field — placeholder' },
  { unit: 'claiming-form', path: 'MODAL.claimProof.files.label', kind: 'modalFieldLabel', label: 'File upload — label' },
  { unit: 'claiming-form', path: 'MODAL.claimProof.files.description', kind: 'modalFieldHelp', label: 'File upload — helper text' },

  { unit: 'claiming-picker', path: 'REPLIES.claimPickPrompt', kind: 'messageContent', label: 'Dropdown prompt' },
  { unit: 'claiming-picker', path: 'REPLIES.claimSelectPlaceholder', kind: 'selectPlaceholder', label: 'Dropdown placeholder' },
  { unit: 'claiming-picker', path: 'REPLIES.claimPrevButton', kind: 'buttonLabel', label: 'Prev page button' },
  { unit: 'claiming-picker', path: 'REPLIES.claimNextButton', kind: 'buttonLabel', label: 'Next page button' },

  { unit: 'claiming-staff-buttons', path: 'TICKET.approveClaimButton', kind: 'buttonLabel', label: 'Approve Claim — label' },
  { unit: 'claiming-staff-buttons', path: 'TICKET.approveClaimEmoji', kind: 'emojiField', label: 'Approve Claim — emoji' },
  { unit: 'claiming-staff-buttons', path: 'TICKET.denyClaimButton', kind: 'buttonLabel', label: 'Deny Claim — label' },
  { unit: 'claiming-staff-buttons', path: 'TICKET.denyClaimEmoji', kind: 'emojiField', label: 'Deny Claim — emoji' },
  { unit: 'claiming-staff-buttons', path: 'TICKET.includeRequesterButton', kind: 'buttonLabel', label: 'Include Requester — label' },
  { unit: 'claiming-staff-buttons', path: 'TICKET.includeRequesterEmoji', kind: 'emojiField', label: 'Include Requester — emoji' },

  { unit: 'claiming-card', path: 'CARD.claim.titlePrefix', kind: 'cardTitlePrefix', label: 'Card title (pending)' },
  { unit: 'claiming-card', path: 'CARD.claimedTitlePrefix', kind: 'cardTitlePrefix', label: 'Card title (approved)' },
  { unit: 'claiming-card', path: 'CARD.claim.fieldClaimant', kind: 'embedFieldName', label: 'Card field name — claimant' },
  { unit: 'claiming-card', path: 'CARD.claim.fieldReward', kind: 'embedFieldName', label: 'Card field name — reward' },
  { unit: 'claiming-card', path: 'CARD.claim.fieldOriginalRequester', kind: 'embedFieldName', label: 'Card field name — original requester' },

  { unit: 'claiming-messages', path: 'REPLIES.missingClaimStaff', kind: 'messageContent', label: 'Message — no staff configured' },
  { unit: 'claiming-messages', path: 'REPLIES.noClaimableBounties', kind: 'messageContent', label: 'Message — nothing to claim' },
  { unit: 'claiming-messages', path: 'REPLIES.claimBountyUnavailable', kind: 'messageContent', label: 'Message — already claimed (1)' },
  { unit: 'claiming-messages', path: 'REPLIES.claimNoLongerAvailable', kind: 'messageContent', label: 'Message — already claimed (2)' },
  { unit: 'claiming-messages', path: 'REPLIES.claimFinalizeFailed', kind: 'messageContent', label: 'Message — approve race lost' },
  { unit: 'claiming-messages', path: 'REPLIES.includeRequesterFailed', kind: 'messageContent', label: 'Message — include requester failed' },
  { unit: 'claiming-messages', path: 'TICKET.noClaimStaffConfigured', kind: 'messageContent', label: 'Message — ticket unpinged' },

  // ── Getting Help ─────────────────────────────────────────────────────
  { unit: 'help-support-board', path: 'PANEL.ticket.title', kind: 'embedTitle', label: 'Support board title' },
  { unit: 'help-support-board', path: 'PANEL.ticket.description', kind: 'embedDescription', label: 'Support board description', multiline: true, hint: 'Blank line = paragraph break. Start a line with "> " for a bullet.' },
  { unit: 'help-support-board', path: 'PANEL.ticket.buttonLabel', kind: 'buttonLabel', label: 'Button label' },
  { unit: 'help-support-board', path: 'PANEL.ticket.buttonEmoji', kind: 'emojiField', label: 'Button emoji' },

  { unit: 'help-support-form', path: 'MODAL.ticketDetails.title', kind: 'modalTitle', label: 'Form title (modal title bar)' },
  { unit: 'help-support-form', path: 'MODAL.ticketDetails.subject.label', kind: 'modalFieldLabel', label: 'Subject field — label' },
  { unit: 'help-support-form', path: 'MODAL.ticketDetails.subject.description', kind: 'modalFieldHelp', label: 'Subject field — helper text' },
  { unit: 'help-support-form', path: 'MODAL.ticketDetails.subject.placeholder', kind: 'modalPlaceholder', label: 'Subject field — placeholder' },
  { unit: 'help-support-form', path: 'MODAL.ticketDetails.body.label', kind: 'modalFieldLabel', label: 'Details field — label' },
  { unit: 'help-support-form', path: 'MODAL.ticketDetails.body.description', kind: 'modalFieldHelp', label: 'Details field — helper text' },
  { unit: 'help-support-form', path: 'MODAL.ticketDetails.body.placeholder', kind: 'modalPlaceholder', label: 'Details field — placeholder' },

  { unit: 'help-support-button', path: 'TICKET.closeHelpButton', kind: 'buttonLabel', label: 'Close Ticket — label' },
  { unit: 'help-support-button', path: 'TICKET.closeHelpEmoji', kind: 'emojiField', label: 'Close Ticket — emoji' },

  { unit: 'help-support-messages', path: 'REPLIES.missingTicketStaff', kind: 'messageContent', label: 'Message — no staff configured' },
  { unit: 'help-support-messages', path: 'TICKET.noHelpStaffConfigured', kind: 'messageContent', label: 'Message — ticket unpinged' },

  { unit: 'help-qanda-board', path: 'PANEL.qanda.title', kind: 'embedTitle', label: 'Q&A board title' },
  { unit: 'help-qanda-board', path: 'PANEL.qanda.description', kind: 'embedDescription', label: 'Q&A board description', multiline: true, hint: 'Blank line = paragraph break. Start a line with "> " for a bullet.' },
  { unit: 'help-qanda-board', path: 'PANEL.qanda.buttonLabel', kind: 'buttonLabel', label: 'Button label' },
  { unit: 'help-qanda-board', path: 'PANEL.qanda.buttonEmoji', kind: 'emojiField', label: 'Button emoji' },
  { unit: 'help-qanda-board', path: 'QANDA.prompt', kind: 'embedDescription', label: 'Dropdown menu prompt' },
  { unit: 'help-qanda-board', path: 'QANDA.selectPlaceholder', kind: 'selectPlaceholder', label: 'Dropdown placeholder' },
];

// Q&A topics aren't in FIELD_SCHEMA (they're a dynamic collection, see
// qandaTopics.js) — build their 4 fields on demand for any unit id shaped
// like `qanda-topic-<id>`.
function qandaTopicFields(id) {
  return [
    { unit: `qanda-topic-${id}`, path: `QANDA.topics.${id}.label`, kind: 'selectOptionLabel', label: 'Dropdown label' },
    { unit: `qanda-topic-${id}`, path: `QANDA.topics.${id}.description`, kind: 'selectOptionDesc', label: 'Dropdown description' },
    { unit: `qanda-topic-${id}`, path: `QANDA.topics.${id}.title`, kind: 'embedTitle', label: 'Answer title' },
    { unit: `qanda-topic-${id}`, path: `QANDA.topics.${id}.body`, kind: 'embedDescription', label: 'Answer body', multiline: true, hint: 'Blank line = paragraph break. Start a line with "> " for a bullet.' },
  ];
}

function unitFields(unitId) {
  if (unitId.startsWith('qanda-topic-')) {
    return qandaTopicFields(unitId.slice('qanda-topic-'.length));
  }
  return FIELD_SCHEMA.filter((f) => f.unit === unitId);
}

// The "Add a new topic" form isn't an existing unit — the topic (and its
// path-based keys) doesn't exist until the add succeeds — so it validates
// against plain field names (label/description/title/body) instead of full
// QANDA.topics.<id>.* paths.
const NEW_TOPIC_FIELDS = [
  { path: 'label', kind: 'selectOptionLabel', label: 'Dropdown label' },
  { path: 'description', kind: 'selectOptionDesc', label: 'Dropdown description' },
  { path: 'title', kind: 'embedTitle', label: 'Answer title' },
  { path: 'body', kind: 'embedDescription', label: 'Answer body', multiline: true, hint: 'Blank line = paragraph break. Start a line with "> " for a bullet.' },
];

// attempted: plain object of { path: rawStringValue }, as posted by a form.
// Shared core used by both validate() (an existing unit) and
// validateNewTopic() (the add-topic form, which has no unit id yet).
function validateFields(fields, attempted) {
  const errors = [];
  for (const f of fields) {
    const raw = attempted[f.path];
    if (raw === undefined) {
      errors.push({ path: f.path, label: f.label, message: 'Missing from submission.' });
      continue;
    }
    const rule = FIELD_KINDS[f.kind];
    const len = raw.length;
    if (len < rule.min) {
      errors.push({ path: f.path, label: f.label, message: rule.min === 1 ? 'Cannot be blank.' : `Must be at least ${rule.min} characters.` });
    } else if (len > rule.max) {
      errors.push({ path: f.path, label: f.label, message: `Too long — ${len} characters, max is ${rule.max}.` });
    }
  }
  return { valid: errors.length === 0, errors };
}

function validate(unitId, attempted) {
  return validateFields(unitFields(unitId), attempted);
}

function validateNewTopic(attempted) {
  return validateFields(NEW_TOPIC_FIELDS, attempted);
}

module.exports = { FIELD_KINDS, FIELD_SCHEMA, NEW_TOPIC_FIELDS, unitFields, validate, validateNewTopic };
