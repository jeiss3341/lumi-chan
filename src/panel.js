const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const TEXT = require('./text');
const { COLORS, BANNER_URL } = TEXT.VISUALS;

// The panel that lives (permanently) in the read-only bounty channel.
// Users can't type there — they interact through the button.
function buildPanel() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(TEXT.PANEL.request.title)
    .setDescription(TEXT.PANEL.request.description.join('\n'))
    .setImage(BANNER_URL)
    .setFooter({ text: TEXT.FOOTER });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('request_bounty')
      .setLabel(TEXT.PANEL.request.buttonLabel)
      .setStyle(ButtonStyle.Success)
      .setEmoji(TEXT.PANEL.request.buttonEmoji),
  );

  return { embeds: [embed], components: [row] };
}

// The panel that lives in the claim channel — a separate board from the
// request one above. Same read-only/button-only pattern.
function buildClaimPanel() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(TEXT.PANEL.claim.title)
    .setDescription(TEXT.PANEL.claim.description.join('\n'))
    .setImage(BANNER_URL)
    .setFooter({ text: TEXT.FOOTER });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('claim_bounty')
      .setLabel(TEXT.PANEL.claim.buttonLabel)
      .setStyle(ButtonStyle.Primary)
      .setEmoji(TEXT.PANEL.claim.buttonEmoji),
  );

  return { embeds: [embed], components: [row] };
}

// The panel for general support — a separate board from both above. Its
// button opens a ticket immediately (customId handled in index.js the same
// way "Talk to Staff" from /help is), no form or topic picker involved.
function buildTicketPanel() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(TEXT.PANEL.ticket.title)
    .setDescription(TEXT.PANEL.ticket.description.join('\n'))
    .setImage(BANNER_URL)
    .setFooter({ text: TEXT.FOOTER });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_help_ticket')
      .setLabel(TEXT.PANEL.ticket.buttonLabel)
      .setStyle(ButtonStyle.Primary)
      .setEmoji(TEXT.PANEL.ticket.buttonEmoji),
  );

  return { embeds: [embed], components: [row] };
}

// The panel for Q&A — entirely separate board from the support one above.
// Its button replies with a topic dropdown (index.js); nothing here ever
// creates a ticket.
function buildQandAPanel() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(TEXT.PANEL.qanda.title)
    .setDescription(TEXT.PANEL.qanda.description.join('\n'))
    .setImage(BANNER_URL)
    .setFooter({ text: TEXT.FOOTER });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_qanda')
      .setLabel(TEXT.PANEL.qanda.buttonLabel)
      .setStyle(ButtonStyle.Primary)
      .setEmoji(TEXT.PANEL.qanda.buttonEmoji),
  );

  return { embeds: [embed], components: [row] };
}

module.exports = { buildPanel, buildClaimPanel, buildTicketPanel, buildQandAPanel };
