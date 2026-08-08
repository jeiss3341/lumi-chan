const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
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

module.exports = { buildBountyModal };
