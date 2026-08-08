const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const TEXT = require('./text');
const { COLORS, BANNER_URL } = TEXT.VISUALS;

function qandaTopicOptions() {
  return Object.entries(TEXT.QANDA.topics).map(([value, topic]) => ({
    label: topic.label,
    description: topic.description,
    value,
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
      .setPlaceholder(TEXT.QANDA.selectPlaceholder)
      .addOptions(qandaTopicOptions()),
  );
}

// The Q&A board's "Ask a Question" button replies with THIS — a full embed
// (banner + footer, matching the answer it leads into) plus the dropdown.
// No modal/popup: this reply IS the picker.
function buildQandAMenu() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setDescription(TEXT.QANDA.prompt)
    .setImage(BANNER_URL)
    .setFooter({ text: TEXT.FOOTER });

  return { embeds: [embed], components: [qandaSelectRow()] };
}

// Shown after a topic is picked from the dropdown. Keeps that dropdown
// attached so switching topics doesn't require pressing the button again.
// Returns null if topicKey doesn't match a known topic (stale/invalid pick).
function buildQandAAnswer(topicKey) {
  const topic = TEXT.QANDA.topics[topicKey];
  if (!topic) return null;

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(topic.title)
    .setDescription(topic.body.join('\n'))
    .setImage(BANNER_URL)
    .setFooter({ text: TEXT.FOOTER });

  return { content: null, embeds: [embed], components: [qandaSelectRow()] };
}

module.exports = { buildQandAMenu, buildQandAAnswer };
