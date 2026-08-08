const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  FileUploadBuilder,
} = require('discord.js');

// The bounty request form. Modern modals wrap every input in a LabelBuilder,
// which gives you the header + subtext you saw in the screenshot.
//
// Max 5 top-level components per modal. We use 4 (name, description, type, amount).
function buildBountyModal() {
  const modal = new ModalBuilder().setCustomId('bounty_modal').setTitle('Request a Bounty');

  // 1) Name of Bounty — single line
  const nameInput = new TextInputBuilder()
    .setCustomId('bounty_name')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('The Phantom Thief')
    .setMaxLength(100)
    .setRequired(true);
  const nameLabel = new LabelBuilder()
    .setLabel('Name of Bounty')
    .setDescription('A short, catchy title')
    .setTextInputComponent(nameInput);

  // 2) Description — paragraph, all the flavor they want
  const descInput = new TextInputBuilder()
    .setCustomId('bounty_description')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Describe the challenge, any flavor, and how it can be verified.')
    .setMaxLength(1000)
    .setRequired(true);
  const descLabel = new LabelBuilder()
    .setLabel('Description')
    .setDescription('What has to happen? Add all the flavor you want.')
    .setTextInputComponent(descInput);

  // 4) Amount Donated — single line (validated on submit since it's free text)
  const amountInput = new TextInputBuilder()
    .setCustomId('bounty_amount')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('10')
    .setMaxLength(10)
    .setRequired(true);
  const amountLabel = new LabelBuilder()
    .setLabel('Amount Donated ($)')
    .setDescription('Numbers only, e.g. 10')
    .setTextInputComponent(amountInput);

  modal.addLabelComponents(nameLabel, descLabel, amountLabel);
  return modal;
}

// Shown when staff presses Approve on a ticket. Pre-filled with the bounty's
// current values so they can tweak wording/reward before it ships to the
// board — nothing is finalized until they submit this modal.
function buildApproveEditModal(bounty) {
  const modal = new ModalBuilder()
    .setCustomId(`approve_edit_modal:${bounty.id}`)
    .setTitle('Review & Approve Bounty');

  const nameInput = new TextInputBuilder()
    .setCustomId('bounty_name')
    .setStyle(TextInputStyle.Short)
    .setValue(bounty.name)
    .setMaxLength(100)
    .setRequired(true);
  const nameLabel = new LabelBuilder()
    .setLabel('Name of Bounty')
    .setDescription('Edit if needed — this is what ships to the board')
    .setTextInputComponent(nameInput);

  const descInput = new TextInputBuilder()
    .setCustomId('bounty_description')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(bounty.description)
    .setMaxLength(1000)
    .setRequired(true);
  const descLabel = new LabelBuilder()
    .setLabel('Description')
    .setDescription('Edit if needed — this is what ships to the board')
    .setTextInputComponent(descInput);

  const amountInput = new TextInputBuilder()
    .setCustomId('bounty_amount')
    .setStyle(TextInputStyle.Short)
    .setValue(bounty.reward != null ? String(bounty.reward) : '')
    .setMaxLength(10)
    .setRequired(true);
  const amountLabel = new LabelBuilder()
    .setLabel('Amount Donated ($)')
    .setDescription('Numbers only, e.g. 10')
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
    .setTitle(`Claim: ${bounty.name}`.slice(0, 45));

  const notesInput = new TextInputBuilder()
    .setCustomId('claim_notes')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Describe how you completed this and how it can be verified.')
    .setMaxLength(1000)
    .setRequired(true);
  const notesLabel = new LabelBuilder()
    .setLabel('Proof / Notes')
    .setDescription('What did you do, and how can staff verify it?')
    .setTextInputComponent(notesInput);

  const fileInput = new FileUploadBuilder()
    .setCustomId('claim_files')
    .setMinValues(0)
    .setMaxValues(3)
    .setRequired(false);
  const fileLabel = new LabelBuilder()
    .setLabel('Proof (Screenshot or Video)')
    .setDescription('Optional — attach a screenshot or clip if you have one.')
    .setFileUploadComponent(fileInput);

  modal.addLabelComponents(notesLabel, fileLabel);
  return modal;
}

module.exports = { buildBountyModal, buildApproveEditModal, buildClaimProofModal };
