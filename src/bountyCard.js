const { EmbedBuilder } = require('discord.js');
const { COLORS, BANNER_URL } = require('./constants');

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
function buildBountyEmbed({ name, description, amountRaw, user, status = 'pending' }) {
  return new EmbedBuilder()
    .setColor(COLORS[status] ?? COLORS.pending)
    .setTitle(`📥 Bounty Request: ${name}`)
    .setDescription(description)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: 'Requester', value: `<@${user.id}>`, inline: true },
      { name: 'Reward', value: formatAmount(amountRaw), inline: true },
    )
    .setImage(BANNER_URL)
    .setFooter({ text: 'Coastal Clash • Bounty System' })
    .setTimestamp();
}

module.exports = { buildBountyEmbed, formatAmount };