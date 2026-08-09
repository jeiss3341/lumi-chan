const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  FileUploadBuilder,
} = require('discord.js');
const TEXT = require('./text');
const { resolveText } = require('./styleGuide/liveText');

// The bounty request form. Modern modals wrap every input in a LabelBuilder,
// which gives you the header + subtext you saw in the screenshot.
//
// Max 5 top-level components per modal. We use 4 (name, description, type, amount).
function buildBountyModal() {
  const modal = new ModalBuilder().setCustomId('bounty_modal').setTitle(resolveText('MODAL.bountyRequest.title'));

  // 1) Name of Bounty — single line
  const nameInput = new TextInputBuilder()
    .setCustomId('bounty_name')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(resolveText('MODAL.bountyRequest.name.placeholder'))
    .setMaxLength(100)
    .setRequired(true);
  const nameLabel = new LabelBuilder()
    .setLabel(resolveText('MODAL.bountyRequest.name.label'))
    .setDescription(resolveText('MODAL.bountyRequest.name.description'))
    .setTextInputComponent(nameInput);

  // 2) Description — paragraph, all the flavor they want
  const descInput = new TextInputBuilder()
    .setCustomId('bounty_description')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(resolveText('MODAL.bountyRequest.description.placeholder'))
    .setMaxLength(1000)
    .setRequired(true);
  const descLabel = new LabelBuilder()
    .setLabel(resolveText('MODAL.bountyRequest.description.label'))
    .setDescription(resolveText('MODAL.bountyRequest.description.description'))
    .setTextInputComponent(descInput);

  // 4) Reward — free text, since it isn't always cash (in-game currency, etc.)
  const amountInput = new TextInputBuilder()
    .setCustomId('bounty_amount')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(resolveText('MODAL.bountyRequest.reward.placeholder'))
    .setMaxLength(50)
    .setRequired(true);
  const amountLabel = new LabelBuilder()
    .setLabel(resolveText('MODAL.bountyRequest.reward.label'))
    .setDescription(resolveText('MODAL.bountyRequest.reward.description'))
    .setTextInputComponent(amountInput);

  modal.addLabelComponents(nameLabel, descLabel, amountLabel);
  return modal;
}

// Shown when staff presses Approve on a ticket. Pre-filled with the bounty's
// current values so they can tweak wording/reward before it ships to the
// board — nothing is finalized until they submit this modal. Staff-only, so
// (unlike the rest of this file) not part of the editable style-guide page —
// still reads straight from TEXT.
function buildApproveEditModal(bounty) {
  const modal = new ModalBuilder()
    .setCustomId(`approve_edit_modal:${bounty.id}`)
    .setTitle(TEXT.MODAL.approveEdit.title);

  const nameInput = new TextInputBuilder()
    .setCustomId('bounty_name')
    .setStyle(TextInputStyle.Short)
    .setValue(bounty.name)
    .setMaxLength(100)
    .setRequired(true);
  const nameLabel = new LabelBuilder()
    .setLabel(TEXT.MODAL.approveEdit.name.label)
    .setDescription(TEXT.MODAL.approveEdit.name.description)
    .setTextInputComponent(nameInput);

  const descInput = new TextInputBuilder()
    .setCustomId('bounty_description')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(bounty.description)
    .setMaxLength(1000)
    .setRequired(true);
  const descLabel = new LabelBuilder()
    .setLabel(TEXT.MODAL.approveEdit.description.label)
    .setDescription(TEXT.MODAL.approveEdit.description.description)
    .setTextInputComponent(descInput);

  const amountInput = new TextInputBuilder()
    .setCustomId('bounty_amount')
    .setStyle(TextInputStyle.Short)
    .setValue(bounty.reward ?? '')
    .setMaxLength(50)
    .setRequired(true);
  const amountLabel = new LabelBuilder()
    .setLabel(TEXT.MODAL.approveEdit.reward.label)
    .setDescription(TEXT.MODAL.approveEdit.reward.description)
    .setTextInputComponent(amountInput);

  modal.addLabelComponents(nameLabel, descLabel, amountLabel);
  return modal;
}

// Shown after a claimant picks a bounty from the claim-board dropdown.
// Collects the proof: written notes, plus an actual screenshot/clip upload —
// no channel is created until this is submitted.
function buildClaimProofModal(bounty) {
  const modal = new ModalBuilder()
    .setCustomId(`claim_proof_modal:${bounty.id}`)
    .setTitle(`${resolveText('MODAL.claimProof.titlePrefix')} ${bounty.name}`.slice(0, 45));

  const notesInput = new TextInputBuilder()
    .setCustomId('claim_notes')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(resolveText('MODAL.claimProof.notes.placeholder'))
    .setMaxLength(1000)
    .setRequired(true);
  const notesLabel = new LabelBuilder()
    .setLabel(resolveText('MODAL.claimProof.notes.label'))
    .setDescription(resolveText('MODAL.claimProof.notes.description'))
    .setTextInputComponent(notesInput);

  const fileInput = new FileUploadBuilder()
    .setCustomId('claim_files')
    .setMinValues(0)
    .setMaxValues(3)
    .setRequired(false);
  const fileLabel = new LabelBuilder()
    .setLabel(resolveText('MODAL.claimProof.files.label'))
    .setDescription(resolveText('MODAL.claimProof.files.description'))
    .setFileUploadComponent(fileInput);

  modal.addLabelComponents(notesLabel, fileLabel);
  return modal;
}

// Shown when the support board's "Talk to Staff" button is pressed. Optional
// Subject/Details — like an email's subject + body, both skippable. `source`
// gets baked into the customId so the submit handler knows how to respond
// (see index.js — this only ever fires from the support panel today, but the
// source tag keeps that explicit rather than assumed).
function buildTicketDetailsModal(source) {
  const modal = new ModalBuilder()
    .setCustomId(`ticket_details_modal:${source}`)
    .setTitle(resolveText('MODAL.ticketDetails.title'));

  const subjectInput = new TextInputBuilder()
    .setCustomId('ticket_subject')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(resolveText('MODAL.ticketDetails.subject.placeholder'))
    .setMaxLength(100)
    .setRequired(false);
  const subjectLabel = new LabelBuilder()
    .setLabel(resolveText('MODAL.ticketDetails.subject.label'))
    .setDescription(resolveText('MODAL.ticketDetails.subject.description'))
    .setTextInputComponent(subjectInput);

  const bodyInput = new TextInputBuilder()
    .setCustomId('ticket_body')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(resolveText('MODAL.ticketDetails.body.placeholder'))
    .setMaxLength(1000)
    .setRequired(false);
  const bodyLabel = new LabelBuilder()
    .setLabel(resolveText('MODAL.ticketDetails.body.label'))
    .setDescription(resolveText('MODAL.ticketDetails.body.description'))
    .setTextInputComponent(bodyInput);

  modal.addLabelComponents(subjectLabel, bodyLabel);
  return modal;
}

module.exports = { buildBountyModal, buildApproveEditModal, buildClaimProofModal, buildTicketDetailsModal };
