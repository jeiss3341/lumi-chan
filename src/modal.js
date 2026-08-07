const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
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

  // 3) Solo Only / Stackable — a real dropdown, no typos possible
  const typeSelect = new StringSelectMenuBuilder()
    .setCustomId('bounty_type')
    .setPlaceholder('Make a selection')
    .setRequired(true) // modal-only property that forces a choice
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Solo Only')
        .setValue('solo')
        .setDescription('Only one person can claim this bounty')
        .setEmoji('🔒'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Stackable')
        .setValue('stackable')
        .setDescription('Multiple people can complete this bounty')
        .setEmoji('♾️'),
    );
  const typeLabel = new LabelBuilder()
    .setLabel('Solo Only or Stackable?')
    .setStringSelectMenuComponent(typeSelect);

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

  modal.addLabelComponents(nameLabel, descLabel, typeLabel, amountLabel);
  return modal;
}

module.exports = { buildBountyModal };
