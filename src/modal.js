const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  FileUploadBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const TEXT = require('./text');
const { resolveText } = require('./styleGuide/liveText');

// The bounty request form. Modern modals wrap every input in a LabelBuilder,
// which gives you the header + subtext you saw in the screenshot.
//
// Max 5 top-level components per modal. We use 4 (preferred name, name, description, reward).
function buildBountyModal() {
  const modal = new ModalBuilder().setCustomId('bounty_modal').setTitle(resolveText('MODAL.bountyRequest.title'));

  // 1) Preferred Name — optional. Who to credit for the prize; falls back to
  // the requester's Discord nickname if left blank (see index.js ticket_submit).
  const donatorInput = new TextInputBuilder()
    .setCustomId('bounty_donator')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(resolveText('MODAL.bountyRequest.donator.placeholder'))
    .setMaxLength(50)
    .setRequired(false);
  const donatorLabel = new LabelBuilder()
    .setLabel(resolveText('MODAL.bountyRequest.donator.label'))
    .setDescription(resolveText('MODAL.bountyRequest.donator.description'))
    .setTextInputComponent(donatorInput);

  // 2) Name of Bounty — single line
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

  // 3) Description — paragraph, all the flavor they want
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

  modal.addLabelComponents(donatorLabel, nameLabel, descLabel, amountLabel);
  return modal;
}

// Shown when staff presses Approve on a ticket. Pre-filled with the bounty's
// current values so they can tweak wording before it ships to the board —
// nothing is finalized until step 2 (buildApproveModalStep2) is submitted.
// Staff-only, so (unlike the rest of this file) not part of the editable
// style-guide page — still reads straight from TEXT.
//
// Split across two modals because Discord caps a modal at 5 top-level
// components and this bounty now needs 6 fields total (preferred name, name,
// description, reward, reward type, tier). A modal submission can't directly
// open another modal, so index.js bridges the two with an intermediate
// "Continue" button — see approve_modal_step1 / approve_modal_step2 there.
function buildApproveModalStep1(bounty) {
  const modal = new ModalBuilder()
    .setCustomId(`approve_modal_step1:${bounty.id}`)
    .setTitle(TEXT.MODAL.approveEdit.title);

  const donatorInput = new TextInputBuilder()
    .setCustomId('bounty_donator')
    .setStyle(TextInputStyle.Short)
    .setValue(bounty.donator_name ?? '')
    .setMaxLength(50)
    .setRequired(false);
  const donatorLabel = new LabelBuilder()
    .setLabel(TEXT.MODAL.approveEdit.donator.label)
    .setDescription(TEXT.MODAL.approveEdit.donator.description)
    .setTextInputComponent(donatorInput);

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

  modal.addLabelComponents(donatorLabel, nameLabel, descLabel);
  return modal;
}

// Step 2 — shown after the "Continue" button following step 1's submit.
// Tier and Reward Type are staff-only, never shown to players.
function buildApproveModalStep2(bounty) {
  const modal = new ModalBuilder()
    .setCustomId(`approve_modal_step2_submit:${bounty.id}`)
    .setTitle(`${TEXT.MODAL.approveEdit.title} (2/2)`);

  const tierSelect = new StringSelectMenuBuilder()
    .setCustomId('bounty_tier')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: 'None', value: 'None', default: !bounty.tier || bounty.tier === 'None' },
      { label: 'Bronze', value: 'Bronze', default: bounty.tier === 'Bronze' },
      { label: 'Silver', value: 'Silver', default: bounty.tier === 'Silver' },
      { label: 'Gold', value: 'Gold', default: bounty.tier === 'Gold' },
    );
  const tierLabel = new LabelBuilder()
    .setLabel(TEXT.MODAL.approveEdit.tier.label)
    .setDescription(TEXT.MODAL.approveEdit.tier.description)
    .setStringSelectMenuComponent(tierSelect);

  // Reward Type — pre-selects the bounty's current value if it already has
  // one (e.g. re-approving after a status revert).
  const rewardTypeSelect = new StringSelectMenuBuilder()
    .setCustomId('bounty_reward_type')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: 'Money', value: 'cash', default: bounty.prize_type === 'cash' },
      { label: 'NP Code', value: 'NP', default: bounty.prize_type === 'NP' },
      { label: 'Merch/Items', value: 'Item', default: bounty.prize_type === 'Item' },
      { label: 'Other', value: 'Other', default: bounty.prize_type === 'Other' },
    );
  const rewardTypeLabel = new LabelBuilder()
    .setLabel(TEXT.MODAL.approveEdit.rewardType.label)
    .setDescription(TEXT.MODAL.approveEdit.rewardType.description)
    .setStringSelectMenuComponent(rewardTypeSelect);

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

  modal.addLabelComponents(tierLabel, rewardTypeLabel, amountLabel);
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

module.exports = { buildBountyModal, buildApproveModalStep1, buildApproveModalStep2, buildClaimProofModal, buildTicketDetailsModal };
