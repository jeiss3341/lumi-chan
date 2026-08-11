const { EmbedBuilder } = require('discord.js');
const TEXT = require('./text');
const { resolveText } = require('./styleGuide/liveText');
const { COLORS, BANNER_URL } = TEXT.VISUALS;

// Reward is free text now (not just dollars — could be "250 NP", "5 gems",
// anything) so this is just a display-safe pass-through.
function formatAmount(raw) {
  const text = String(raw ?? '').trim();
  return text || '—';
}

const GROUP_TYPE_LABELS = { solo: 'Solo Only', premade: 'Premade Allowed' };

function formatGroupType(raw) {
  return GROUP_TYPE_LABELS[raw] ?? '—';
}

// Builds the bounty card. Pass a different `status` to recolor AND retitle
// it as it moves through the flow: 'pending' ("Bounty Request", blurple) →
// 'approved' ("Bounty Approved", green). Denied tickets just close, so
// there's no 'denied' title — the pending one is a safe fallback.
function buildBountyEmbed({ name, description, amountRaw, groupType, user, status = 'pending' }) {
  const titlePrefix =
    status === 'approved' ? resolveText('CARD.request.approvedTitlePrefix') : resolveText('CARD.request.titlePrefix');
  return new EmbedBuilder()
    .setColor(COLORS[status] ?? COLORS.pending)
    .setTitle(`${titlePrefix} ${name}`)
    .setDescription(description)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: resolveText('CARD.request.fieldRequester'), value: `<@${user.id}>`, inline: true },
      { name: resolveText('CARD.request.fieldReward'), value: formatAmount(amountRaw), inline: true },
      { name: resolveText('CARD.request.fieldGroupType'), value: formatGroupType(groupType), inline: true },
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
  const titlePrefix = status === 'approved' ? resolveText('CARD.claimedTitlePrefix') : resolveText('CARD.claim.titlePrefix');
  return new EmbedBuilder()
    .setColor(COLORS[status] ?? COLORS.pending)
    .setTitle(`${titlePrefix} ${bounty.name}`)
    .setDescription(notes)
    .setThumbnail(claimant.displayAvatarURL())
    .addFields(
      { name: resolveText('CARD.claim.fieldClaimant'), value: `<@${claimant.id}>`, inline: true },
      { name: resolveText('CARD.claim.fieldReward'), value: formatAmount(bounty.reward), inline: true },
      { name: resolveText('CARD.claim.fieldOriginalRequester'), value: `<@${bounty.requester_id}>`, inline: true },
    )
    .setImage(BANNER_URL)
    .setFooter({ text: TEXT.FOOTER })
    .setTimestamp();
}

// The single line describing where a submissions bounty currently stands —
// shared by buildLeaderboardEmbed below and index.js's ticket-reopen note
// when a leader gets displaced. No leader yet (freshly approved, nobody's
// submitted) reads as "Open" instead. `closed` swaps "is leading"/
// "currently has" for "won with", once staff presses Close Bounty.
function leaderboardLine(bounty, { closed = false } = {}) {
  if (!bounty.leader_id) return resolveText('CARD.submissions.noLeaderYet');

  const mention = `<@${bounty.leader_id}>`;
  if (bounty.submission_metric_kind === 'numeric') {
    const verb = resolveText(closed ? 'CARD.submissions.wonVerb' : 'CARD.submissions.leadingVerb');
    return `🏆 ${mention} ${verb} **${bounty.leader_value}** ${bounty.submission_metric_label}`;
  }

  const verb = resolveText(closed ? 'CARD.submissions.wonOtherVerb' : 'CARD.submissions.leadingOtherVerb');
  return `🏆 ${mention} ${verb} the ${bounty.submission_metric_label}`;
}

// Builds the card for the submissions board (see /deployclaimbounty) — same
// shell as buildBountyEmbed, but with a live "Standing" field instead of a
// fixed Requester, since this post stays open and gets edited in place as
// the leader changes (index.js's approve_claim, submissions branch) rather
// than finalizing on the first approved claim. `closed` retitles it to the
// final winner announcement, once staff presses Close Bounty.
function buildLeaderboardEmbed(bounty, { closed = false } = {}) {
  const titlePrefix = closed
    ? resolveText('CARD.submissions.closedTitlePrefix')
    : resolveText('CARD.request.approvedTitlePrefix');

  const embed = new EmbedBuilder()
    .setColor(closed ? COLORS.approved : COLORS.pending)
    .setTitle(`${titlePrefix} ${bounty.name}`)
    .setDescription(bounty.description)
    .addFields(
      { name: resolveText('CARD.request.fieldReward'), value: formatAmount(bounty.reward), inline: true },
      { name: resolveText('CARD.request.fieldGroupType'), value: formatGroupType(bounty.group_type), inline: true },
      { name: resolveText('CARD.submissions.fieldStanding'), value: leaderboardLine(bounty, { closed }), inline: false },
    );

  // The leader's premade teammates (Add Premade on their claim ticket), if
  // any — persisted onto the bounty row by setLeader/promoteSubmissionLeader
  // (src/db.js, index.js) specifically so this board post and the eventual
  // Close Bounty card can show them too, not just the ticket.
  if (bounty.leader_teammates) {
    embed.addFields({
      name: resolveText('CARD.claim.fieldTeammates'),
      value: bounty.leader_teammates.split(',').map((id) => `<@${id}>`).join(', '),
      inline: true,
    });
  }

  return embed
    .setImage(BANNER_URL)
    .setFooter({ text: TEXT.FOOTER })
    .setTimestamp();
}

module.exports = { buildBountyEmbed, buildClaimEmbed, buildLeaderboardEmbed, leaderboardLine, formatAmount, formatGroupType };
