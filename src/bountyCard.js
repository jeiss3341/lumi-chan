const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const { COLORS } = require('./constants');

const TYPE_TAGS = {
  solo: '🔒 Solo Only',
  stackable: '♾️ Stackable',
};

// The banner lives in the repo (assets/banner.jpeg), so it ships with the bot to
// Railway and never expires like a CDN link would. We attach the file to each
// message and the embed references it by name via attachment://.
const BANNER_FILE = path.join(__dirname, '..', 'assets', 'banner.jpeg');
const BANNER_NAME = 'banner.jpeg';

// Call this alongside the embed to attach the banner file to a message.
function bannerAttachment() {
  return new AttachmentBuilder(BANNER_FILE, { name: BANNER_NAME });
}

// The amount comes in as free text, so pull the first number out of whatever
// they typed and format it as money. Falls back to their raw text if there's
// no number in there at all.
function formatAmount(raw) {
  const match = String(raw).replace(/,/g, '').match(/\d+(\.\d+)?/);
  if (!match) return raw;
  const n = Number(match[0]);
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

// Builds the bounty card. Pass a different `status` to recolor it as it moves
// through the flow: 'pending' (blurple) → 'approved' (green) / 'denied' (red).
function buildBountyEmbed({ name, description, type, amountRaw, user, status = 'pending' }) {
  return new EmbedBuilder()
    .setColor(COLORS[status] ?? COLORS.pending)
    .setTitle(`📥 Bounty Request: ${name}`)
    .setDescription(description)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: 'Requester', value: `<@${user.id}>`, inline: true },
      { name: 'Reward', value: formatAmount(amountRaw), inline: true },
      { name: 'Type', value: TYPE_TAGS[type] ?? type, inline: true },
    )
    .setImage(`attachment://${BANNER_NAME}`)
    .setFooter({ text: 'Coastal Clash • Bounty System' })
    .setTimestamp();
}

module.exports = { buildBountyEmbed, formatAmount, bannerAttachment };