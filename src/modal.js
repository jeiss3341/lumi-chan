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
// Max 5 top-level components per modal. We use all 5 (preferred name, name,
// group type, description, reward).
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

  // 3) Group Type — can this be completed alone, or does it allow a premade
  // group? Shown on the bounty card so claimants know before attempting it.
  const groupTypeSelect = new StringSelectMenuBuilder()
    .setCustomId('bounty_group_type')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: 'Solo Only', value: 'solo' },
      { label: 'Premade Allowed', value: 'premade' },
      { label: 'Roll Required', value: 'matched' },
    );
  const groupTypeLabel = new LabelBuilder()
    .setLabel(resolveText('MODAL.bountyRequest.groupType.label'))
    .setDescription(resolveText('MODAL.bountyRequest.groupType.description'))
    .setStringSelectMenuComponent(groupTypeSelect);

  // 4) Description — paragraph, all the flavor they want
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

  // 5) Reward — free text, since it isn't always cash (in-game currency, etc.)
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

  modal.addLabelComponents(donatorLabel, nameLabel, groupTypeLabel, descLabel, amountLabel);
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
// Tier and Claim Type live here (not step 2, where they used to) so that by
// the time step 2 is built, we already know whether this is a Submissions
// bounty — its leaderboard setup folds straight into step 2 instead of a
// separate step 3, keeping the whole approve flow to 2 pages regardless of
// claim type. 5 fields, right at Discord's per-modal cap.
function buildApproveModalStep1(bounty) {
  const modal = new ModalBuilder()
    .setCustomId(`approve_modal_step1:${bounty.id}`)
    .setTitle(`${TEXT.MODAL.approveEdit.title} (1/2)`);

  // Premade Allowed gets the plural label/hint — reminding staff this is
  // where the whole team's preferred names go (gathered by talking it over
  // with the requester in the ticket), not just the one requester's own
  // name. Same field either way (bounty_donator) — just the copy differs.
  const donatorCopy = bounty.group_type === 'premade'
    ? TEXT.MODAL.approveEdit.donatorPremade
    : TEXT.MODAL.approveEdit.donator;
  const donatorInput = new TextInputBuilder()
    .setCustomId('bounty_donator')
    .setStyle(TextInputStyle.Short)
    .setValue(bounty.donator_name ?? '')
    .setMaxLength(100)
    .setRequired(false);
  const donatorLabel = new LabelBuilder()
    .setLabel(donatorCopy.label)
    .setDescription(donatorCopy.description)
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

  const tierSelect = new StringSelectMenuBuilder()
    .setCustomId('bounty_tier')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: 'Boot', value: 'Boot', default: bounty.tier === 'Boot' },
      { label: 'Shrimp', value: 'Shrimp', default: bounty.tier === 'Shrimp' },
      { label: 'Crab', value: 'Crab', default: bounty.tier === 'Crab' },
      { label: 'Pearl', value: 'Pearl', default: bounty.tier === 'Pearl' },
      { label: 'Blue NP', value: 'Blue NP', default: bounty.tier === 'Blue NP' },
      { label: 'Treasure Chest', value: 'Treasure Chest', default: bounty.tier === 'Treasure Chest' },
    );
  const tierLabel = new LabelBuilder()
    .setLabel(TEXT.MODAL.approveEdit.tier.label)
    .setDescription(TEXT.MODAL.approveEdit.tier.description)
    .setStringSelectMenuComponent(tierSelect);

  // Claim Type — decides which of /deployclaimbounty's two active categories
  // (Claim vs Submissions) this bounty's claim ticket opens under later (see
  // index.js claim_proof_modal), and whether step 2 asks for a leaderboard
  // setup too. Defaults to Claim if unset.
  const claimTypeSelect = new StringSelectMenuBuilder()
    .setCustomId('bounty_claim_type')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: 'Claim', value: 'claim', default: !bounty.claim_type || bounty.claim_type === 'claim' },
      { label: 'Submissions', value: 'submissions', default: bounty.claim_type === 'submissions' },
      { label: 'Community', value: 'community', default: bounty.claim_type === 'community' },
    );
  const claimTypeLabel = new LabelBuilder()
    .setLabel(TEXT.MODAL.approveEdit.claimType.label)
    .setDescription(TEXT.MODAL.approveEdit.claimType.description)
    .setStringSelectMenuComponent(claimTypeSelect);

  modal.addLabelComponents(donatorLabel, nameLabel, descLabel, tierLabel, claimTypeLabel);
  return modal;
}

// Step 2 — shown after the "Continue" button following step 1's submit.
// Reward Type/Reward always; if step 1's Claim Type was Submissions, also
// collects the leaderboard setup (numeric/text metric + label) in this same
// modal — `claimType` is step 1's already-submitted value, known by the
// time this is built, so there's no need for a conditional 3rd page.
function buildApproveModalStep2(bounty, claimType) {
  const modal = new ModalBuilder()
    .setCustomId(`approve_modal_step2_submit:${bounty.id}`)
    .setTitle(`${TEXT.MODAL.approveEdit.title} (2/2)`);

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

  const components = [rewardTypeLabel, amountLabel];

  if (claimType === 'submissions') {
    const kindSelect = new StringSelectMenuBuilder()
      .setCustomId('submission_metric_kind')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        { label: 'Numeric (e.g. kills, score)', value: 'numeric' },
        { label: 'Other (staff judgment call, e.g. best clip)', value: 'text' },
      );
    const kindLabel = new LabelBuilder()
      .setLabel(TEXT.MODAL.approveEdit.submissionMetricKind.label)
      .setDescription(TEXT.MODAL.approveEdit.submissionMetricKind.description)
      .setStringSelectMenuComponent(kindSelect);

    const metricLabelInput = new TextInputBuilder()
      .setCustomId('submission_metric_label')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('kills')
      .setMaxLength(50)
      .setRequired(true);
    const metricLabelLabel = new LabelBuilder()
      .setLabel(TEXT.MODAL.approveEdit.submissionMetricLabel.label)
      .setDescription(TEXT.MODAL.approveEdit.submissionMetricLabel.description)
      .setTextInputComponent(metricLabelInput);

    components.push(kindLabel, metricLabelLabel);
  }

  // Yes/No gate — picking Yes doesn't collect a date here (Discord modals
  // can't reveal a field conditionally within one submission, and this
  // modal is already at its 5-component cap for submissions bounties
  // anyway). index.js reads this and, if Yes, follows up with a day-picker
  // button grid (a separate message, not a modal — buttons can't live
  // inside modals) instead of finalizing the approval immediately.
  const expiringSelect = new StringSelectMenuBuilder()
    .setCustomId('bounty_is_expiring')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: 'No — never expires', value: 'no', default: true },
      { label: 'Yes — pick an expiry day', value: 'yes' },
    );
  const expiringLabel = new LabelBuilder()
    .setLabel(TEXT.MODAL.approveEdit.isExpiring.label)
    .setDescription(TEXT.MODAL.approveEdit.isExpiring.description)
    .setStringSelectMenuComponent(expiringSelect);
  components.push(expiringLabel);

  modal.addLabelComponents(...components);
  return modal;
}

// Shown when staff presses Approve Claim on a numeric-metric submissions
// ticket — collects the value for THIS claimant before they can be promoted
// to leader (see index.js promoteSubmissionLeader). Never shown for a
// text-metric bounty — there's nothing to enter, staff's Approve click is
// the judgment call there.
function buildSubmissionValueModal(bounty) {
  const modal = new ModalBuilder()
    .setCustomId(`submission_value_modal_submit:${bounty.id}`)
    .setTitle(`Value (${bounty.submission_metric_label})`.slice(0, 45));

  const valueInput = new TextInputBuilder()
    .setCustomId('submission_value')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. 50')
    .setMaxLength(20)
    .setRequired(true);
  const valueLabel = new LabelBuilder()
    .setLabel(`Value (${bounty.submission_metric_label})`.slice(0, 45))
    .setDescription(`What are they leading with, in ${bounty.submission_metric_label}?`.slice(0, 100))
    .setTextInputComponent(valueInput);

  modal.addLabelComponents(valueLabel);
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
  const notesDescription = bounty.claim_type === 'community'
    ? resolveText('MODAL.claimProof.communityNotes.description')
    : resolveText('MODAL.claimProof.notes.description');
  const notesLabel = new LabelBuilder()
    .setLabel(resolveText('MODAL.claimProof.notes.label'))
    .setDescription(notesDescription)
    .setTextInputComponent(notesInput);

  const fileInput = new FileUploadBuilder()
    .setCustomId('claim_files')
    .setMinValues(0)
    .setMaxValues(4)
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

module.exports = {
  buildBountyModal,
  buildApproveModalStep1,
  buildApproveModalStep2,
  buildSubmissionValueModal,
  buildClaimProofModal,
  buildTicketDetailsModal,
};
