const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const TEXT = require('./text');
const { resolveText } = require('./styleGuide/liveText');
const qandaTopics = require('./styleGuide/qandaTopics');
const { COLORS, BANNER_URL } = TEXT.VISUALS;

// Topics are an editable collection now (added/removed through the
// style-guide page, see src/styleGuide/qandaTopics.js) — not the fixed TEXT.QANDA.topics
// object. Both the dropdown options and individual answers read through it.
function qandaTopicOptions() {
  return qandaTopics.getAllTopics().map((topic) => ({
    label: topic.label,
    description: topic.description,
    value: topic.id,
  }));
}

// The dropdown attached to the menu and to every answer — always on a
// private (ephemeral) message by the time a player sees it, since the board
// itself only ever shows a button. Safe to update() in place wherever it's
// picked from.
function qandaSelectRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('qanda_select')
      .setPlaceholder(resolveText('QANDA.selectPlaceholder'))
      .addOptions(qandaTopicOptions()),
  );
}

// The Q&A board's "Ask a Question" button replies with THIS — a full embed
// (banner + footer, matching the answer it leads into) plus the dropdown.
// No modal/popup: this reply IS the picker.
function buildQandAMenu() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setDescription(resolveText('QANDA.prompt'))
    .setImage(BANNER_URL)
    .setFooter({ text: TEXT.FOOTER });

  return { embeds: [embed], components: [qandaSelectRow()] };
}

// Shown after a topic is picked from the dropdown. Keeps that dropdown
// attached so switching topics doesn't require pressing the button again.
// Returns null if topicKey isn't a currently-existing topic (stale/invalid
// pick, or one that's since been removed).
function buildQandAAnswer(topicKey) {
  if (!qandaTopics.getTopicOrder().includes(topicKey)) return null;
  const topic = qandaTopics.getTopic(topicKey);

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(topic.title)
    .setDescription(topic.body.join('\n'))
    .setImage(BANNER_URL)
    .setFooter({ text: TEXT.FOOTER });

  return { content: null, embeds: [embed], components: [qandaSelectRow()] };
}

module.exports = { buildQandAMenu, buildQandAAnswer };
