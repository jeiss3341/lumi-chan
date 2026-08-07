const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLORS } = require('./constants');

// The panel that lives (permanently) in the read-only bounty channel.
// Users can't type there — they interact through the button.
function buildPanel() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle('💰 Bounty Board')
    .setDescription(
      [
        'Want to put a bounty on the board? Press **Request Bounty** below.',
        '',
        "You'll fill out a short form, then a private channel opens where staff review and verify it with you.",
        '',
        '**Before you request, make sure your bounty is:**',
        '> 🔎 Verifiable & trackable (Dak.gg / Match ID)',
        '> ⚖️ Within reason — no "kill 100 Rozzis"',
        '> 🚫 Not creepy, invasive, or trolling',
        '> 📜 Within Eternal Return TOS',
      ].join('\n'),
    )
    .setFooter({ text: 'Coastal Clash • Bounty System' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('request_bounty')
      .setLabel('Request Bounty')
      .setStyle(ButtonStyle.Success)
      .setEmoji('📥'),
  );

  return { embeds: [embed], components: [row] };
}

module.exports = { buildPanel };
