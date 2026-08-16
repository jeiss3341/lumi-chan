const { EmbedBuilder } = require('discord.js');
const TEXT = require('./text');
const { resolveText } = require('./styleGuide/liveText');
const { fmtDateRelative } = require('./styleGuide/styleGuide');
const { COLORS, BANNER_URL } = TEXT.VISUALS;

// Discord's built-in `.setTimestamp()` footer auto-localizes to whatever
// timezone the VIEWER's own client/OS thinks it's in — which looked wrong
// on screen when that wasn't actually a NA timezone. Cards now print a
// fixed PT/ET string instead of relying on per-viewer rendering, kept in
// the short "Today"/"Yesterday"/M-D-YY phrasing Discord's own timestamps
// used to read (fmtDateRelative), rather than the admin site's longer
// "Aug 12, 2026" form (fmtDate) — cards want the punchier, familiar look.
function footerWithTimestamp() {
  return `${TEXT.FOOTER} • ${fmtDateRelative(new Date())}`;
}

// Reward is free text now (not just dollars — could be "250 NP", "5 gems",
// anything) so this is just a display-safe pass-through.
function formatAmount(raw) {
  const text = String(raw ?? '').trim();
  return text || '—';
}

const GROUP_TYPE_LABELS = { solo: 'Solo Only', premade: 'Premade Allowed', matched: 'Roll Required' };

function formatGroupType(raw) {
  return GROUP_TYPE_LABELS[raw] ?? '—';
}

// Builds the bounty card. Pass a different `status` to recolor AND retitle
// it as it moves through the flow: 'pending' ("Bounty Request", blurple) →
// 'approved' ("Bounty Approved", green). Denied tickets just close, so
// there's no 'denied' title — the pending one is a safe fallback.
function buildBountyEmbed({ name, description, amountRaw, groupType, user, status = 'pending', expiresAt = null }) {
  const titlePrefix =
    status === 'approved' ? resolveText('CARD.request.approvedTitlePrefix') : resolveText('CARD.request.titlePrefix');

  // Discord's own <t:UNIX:R> markdown renders as a live, auto-updating
  // "expires in 3 days" — per-viewer localized, no manual countdown math
  // needed. Folded into the description rather than its own field: the 3
  // fields below already fill exactly one row, so a 4th field (inline or
  // not) always strands itself alone on the next row with empty space
  // beside it — a description line just reads as another line of text,
  // no awkward layout either way. Omitted entirely for the (common)
  // non-expiring case.
  let fullDescription = description;
  if (expiresAt) {
    const unix = Math.floor(new Date(expiresAt).getTime() / 1000);
    fullDescription += `\n\n**${resolveText('CARD.request.fieldExpires')}:** <t:${unix}:R>`;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS[status] ?? COLORS.pending)
    .setTitle(`${titlePrefix} ${name}`)
    .setDescription(fullDescription)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: resolveText('CARD.request.fieldRequester'), value: `<@${user.id}>`, inline: true },
      { name: resolveText('CARD.request.fieldReward'), value: formatAmount(amountRaw), inline: true },
      { name: resolveText('CARD.request.fieldGroupType'), value: formatGroupType(groupType), inline: true },
    );

  embed.setImage(BANNER_URL).setFooter({ text: footerWithTimestamp() });
  return embed;
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
      // Group Type shown here to match the submissions board card
      // (buildLeaderboardEmbed below), which has always carried it — a claim
      // card had no way to tell Solo Only from Premade Allowed before this.
      // Sits third so the public claim-board card (which strips Original
      // Requester — see index.js approve_claim) reads Claimant/Reward/Group
      // Type on one row, leaving Teammates its own row underneath.
      { name: resolveText('CARD.request.fieldGroupType'), value: formatGroupType(bounty.group_type), inline: true },
      { name: resolveText('CARD.claim.fieldOriginalRequester'), value: `<@${bounty.requester_id}>`, inline: true },
    )
    .setImage(BANNER_URL)
    .setFooter({ text: footerWithTimestamp() });
}

// The single line describing where a submissions bounty currently stands —
// used by buildLeaderboardEmbed below. No leader yet (freshly approved,
// nobody's submitted) reads as "Open" instead. `closed` swaps "is leading"/
// "currently has" for "won with", once /endsubmissions finalizes it.
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
// final winner announcement, once /endsubmissions finalizes it. `leaderAvatarURL`
// is optional (the caller fetches it, same reasoning as buildBountyEmbed's
// `user` param) — omitted entirely (no thumbnail) if the leader can't be
// resolved, rather than showing a broken image.
function buildLeaderboardEmbed(bounty, { closed = false, leaderAvatarURL } = {}) {
  const titlePrefix = closed
    ? resolveText('CARD.submissions.closedTitlePrefix')
    : resolveText('CARD.submissions.openTitlePrefix');

  const embed = new EmbedBuilder()
    .setColor(closed ? COLORS.approved : COLORS.pending)
    .setTitle(`${titlePrefix} ${bounty.name}`)
    .setDescription(bounty.description);

  if (leaderAvatarURL) embed.setThumbnail(leaderAvatarURL);

  embed.addFields(
    { name: resolveText('CARD.request.fieldReward'), value: formatAmount(bounty.reward), inline: true },
    { name: resolveText('CARD.request.fieldGroupType'), value: formatGroupType(bounty.group_type), inline: true },
    { name: resolveText('CARD.submissions.fieldStanding'), value: leaderboardLine(bounty, { closed }), inline: false },
  );

  // The leader's premade teammates (Add Premade on their claim ticket), if
  // any — persisted onto the bounty row by setLeader/promoteSubmissionLeader
  // (src/db.js, index.js) specifically so this board post and the eventual
  // finalized card (/endsubmissions) can show them too, not just the ticket.
  if (bounty.leader_teammates) {
    embed.addFields({
      name: resolveText('CARD.claim.fieldTeammates'),
      value: bounty.leader_teammates.split(',').map((id) => `<@${id}>`).join(', '),
      inline: true,
    });
  }

  return embed
    .setImage(BANNER_URL)
    .setFooter({ text: footerWithTimestamp() });
}

module.exports = { buildBountyEmbed, buildClaimEmbed, buildLeaderboardEmbed, leaderboardLine, formatAmount, formatGroupType };
