const { EmbedBuilder } = require('discord.js');
const TEXT = require('./text');
const { COLORS, BANNER_URL } = TEXT.VISUALS;

// Reward is free text now (not just dollars — could be "250 NP", "5 gems",
// anything) so this is just a display-safe pass-through.
function formatAmount(raw) {
  const text = String(raw ?? '').trim();
  return text || '—';
}

// Builds the bounty card. Pass a different `status` to recolor AND retitle
// it as it moves through the flow: 'pending' ("Bounty Request", blurple) →
// 'approved' ("Bounty Approved", green). Denied tickets just close, so
// there's no 'denied' title — the pending one is a safe fallback.
function buildBountyEmbed({ name, description, amountRaw, user, status = 'pending' }) {
  const titlePrefix =
    status === 'approved' ? TEXT.CARD.request.approvedTitlePrefix : TEXT.CARD.request.titlePrefix;
  return new EmbedBuilder()
    .setColor(COLORS[status] ?? COLORS.pending)
    .setTitle(`${titlePrefix} ${name}`)
    .setDescription(description)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: TEXT.CARD.request.fieldRequester, value: `<@${user.id}>`, inline: true },
      { name: TEXT.CARD.request.fieldReward, value: formatAmount(amountRaw), inline: true },
    )
    .setImage(BANNER_URL)
    .setFooter({ text: TEXT.FOOTER })
    .setTimestamp();
}

// Builds the claim-review card shown inside a claim ticket. `notes` is the
// claimant's proof/description text; the actual screenshot/clip is posted
// as a follow-up attachment message, not embedded here. 'approved' retitles
// it to "Bounty Claimed" — the shared finalized-claim title.
function buildClaimEmbed({ bounty, claimant, notes, status = 'pending' }) {
  const titlePrefix = status === 'approved' ? TEXT.CARD.claimedTitlePrefix : TEXT.CARD.claim.titlePrefix;
  return new EmbedBuilder()
    .setColor(COLORS[status] ?? COLORS.pending)
    .setTitle(`${titlePrefix} ${bounty.name}`)
    .setDescription(notes)
    .setThumbnail(claimant.displayAvatarURL())
    .addFields(
      { name: TEXT.CARD.claim.fieldClaimant, value: `<@${claimant.id}>`, inline: true },
      { name: TEXT.CARD.claim.fieldReward, value: formatAmount(bounty.reward), inline: true },
      { name: TEXT.CARD.claim.fieldOriginalRequester, value: `<@${bounty.requester_id}>`, inline: true },
    )
    .setImage(BANNER_URL)
    .setFooter({ text: TEXT.FOOTER })
    .setTimestamp();
}

module.exports = { buildBountyEmbed, buildClaimEmbed, formatAmount };
