const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  UserSelectMenuBuilder,
} = require('discord.js');
const TEXT = require('./text');
const { resolveText, applyEmoji } = require('./styleGuide/liveText');
const { COLORS, BANNER_URL } = TEXT.VISUALS;

// Turns parts like ('pending', 'jeiss', 'Catching 6789!') into a Discord-safe
// channel name like "pending-jeiss-catching-6789". Discord lowercases and
// hyphenates channel names anyway and strips most punctuation, so we do it
// up front to keep the result predictable. The pretty title (caps +
// punctuation) still lives in the embed. Order of parts is up to the caller
// — request/claim tickets deliberately use different orders (see below).
function toChannelName(...parts) {
  const raw = parts.join('-');
  let clean = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '') // drop anything Discord wouldn't keep
    .trim()
    .replace(/\s+/g, '-') // spaces → hyphens
    .replace(/-+/g, '-') // collapse repeated hyphens
    .replace(/^-+|-+$/g, ''); // drop leading/trailing hyphens (e.g. a part that was emoji-only)

  if (!clean) {
    // Every part was all emoji/symbols and stripped to nothing — fall back
    // to just the first part (usually the status prefix, e.g. "pending").
    clean = parts[0]?.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'bounty';
  }

  return clean.slice(0, 90); // stay well under Discord's 100-char limit
}

// Default sort: plain alphabetical by channel name.
function byName(a, b) {
  return a.name.localeCompare(b.name);
}

// Claim tickets sort by bounty title first, then by creation time within
// matching titles (oldest first) — so if the same bounty gets claimed by
// multiple people before one is approved, whoever went first shows first.
// The title comes from the channel's TOPIC, not parsed from its name: the
// name is "claim-{title}-{claimant}" and both halves are slugified, so
// there's no reliable way to tell where the title ends and the claimant's
// name begins just from the string. Falls back to the name itself for any
// channel that predates this (no topic set).
function byClaimTitleThenAge(a, b) {
  const titleCompare = (a.topic || a.name).localeCompare(b.topic || b.name);
  if (titleCompare !== 0) return titleCompare;
  return a.createdTimestamp - b.createdTimestamp;
}

// Re-sorts every channel directly in `category`, in ONE bulk API call (not
// one call per channel). `compare` defaults to plain alphabetical by name;
// pass byClaimTitleThenAge (or another comparator) for categories that need
// smarter grouping. Called after a ticket lands in a category so browsing it
// doesn't depend on creation order. Swallows its own errors — if the bot's
// permissions don't allow reordering, the ticket itself still exists and
// works fine, it just stays wherever Discord put it.
async function alphabetizeCategory(category, compare = byName) {
  if (!category) return;
  const channels = [...category.children.cache.values()].sort(compare);
  if (channels.length === 0) return;
  await category.guild.channels
    .setPositions(channels.map((channel, position) => ({ channel, position })))
    .catch(console.error);
}

// [Submit] [Close] shown on the EPHEMERAL preview, before any channel exists.
function previewButtons() {
  return new ActionRowBuilder().addComponents(
    applyEmoji(
      new ButtonBuilder()
        .setCustomId('ticket_submit')
        .setLabel(resolveText('TICKET.submitButton'))
        .setStyle(ButtonStyle.Success),
      'TICKET.submitEmoji',
    ),
    applyEmoji(
      new ButtonBuilder()
        .setCustomId('ticket_cancel')
        .setLabel(resolveText('TICKET.closeButton'))
        .setStyle(ButtonStyle.Danger),
      'TICKET.closeEmoji',
    ),
  );
}

// [Approve] [Deny] shown INSIDE the ticket. Only staff can use these (checked
// in the handler). The bounty's database id is baked into the customId so the
// right row gets updated on approve/deny — and this survives bot restarts.
function staffReviewButtons(bountyId) {
  return new ActionRowBuilder().addComponents(
    applyEmoji(
      new ButtonBuilder()
        .setCustomId(`approve_bounty:${bountyId}`)
        .setLabel(resolveText('TICKET.approveBountyButton'))
        .setStyle(ButtonStyle.Success),
      'TICKET.approveBountyEmoji',
    ),
    applyEmoji(
      new ButtonBuilder()
        .setCustomId(`deny_bounty:${bountyId}`)
        .setLabel(resolveText('TICKET.denyBountyButton'))
        .setStyle(ButtonStyle.Danger),
      'TICKET.denyBountyEmoji',
    ),
  );
}

// [Approve Claim] [Deny Claim] shown inside a claim ticket. Same idea as
// staffReviewButtons above, just a distinct customId prefix so the handler
// can tell "approve a request" and "approve a claim" apart.
// `groupType` is the bounty's own group_type ('solo' | 'premade' | 'matched'
// | null) — "Add Premade" shows up for both premade AND solo-queue-match
// bounties, since a matched claimant still needs a way to tag whoever they
// were randomly teamed with (same member-picker mechanism, just naming the
// person differently in practice) — only a true solo-only claim has no one
// to add.
function claimReviewButtons(bountyId, groupType) {
  const buttons = [
    applyEmoji(
      new ButtonBuilder()
        .setCustomId(`approve_claim:${bountyId}`)
        .setLabel(resolveText('TICKET.approveClaimButton'))
        .setStyle(ButtonStyle.Success),
      'TICKET.approveClaimEmoji',
    ),
    applyEmoji(
      new ButtonBuilder()
        .setCustomId(`deny_claim:${bountyId}`)
        .setLabel(resolveText('TICKET.denyClaimButton'))
        .setStyle(ButtonStyle.Danger),
      'TICKET.denyClaimEmoji',
    ),
    applyEmoji(
      new ButtonBuilder()
        .setCustomId(`include_requester:${bountyId}`)
        .setLabel(resolveText('TICKET.includeRequesterButton'))
        .setStyle(ButtonStyle.Secondary),
      'TICKET.includeRequesterEmoji',
    ),
  ];

  if (groupType === 'premade' || groupType === 'matched') {
    buttons.push(
      applyEmoji(
        new ButtonBuilder()
          .setCustomId(`add_premade:${bountyId}`)
          .setLabel(resolveText('TICKET.addPremadeButton'))
          .setStyle(ButtonStyle.Secondary),
        'TICKET.addPremadeEmoji',
      ),
    );
  }

  return new ActionRowBuilder().addComponents(...buttons);
}

// Shown after "Add Premade" is pressed — a native Discord user-search picker
// (type-to-filter server members, up to 10 at once). Granting access happens
// when this is submitted (see index.js add_premade_select), not here.
// ticketMessageId is baked into the customId (same idea as
// helpTicketCloseConfirm's messageId below) so the select's submit handler
// knows which message to add a Teammates field to — this select lives on
// its own fresh ephemeral reply, not the ticket message itself, so
// interaction.message there won't be it.
function addPremadeSelectRow(bountyId, ticketMessageId) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`add_premade_select:${bountyId}:${ticketMessageId}`)
      .setPlaceholder(resolveText('TICKET.addPremadePlaceholder'))
      .setMinValues(1)
      .setMaxValues(10),
  );
}

// [Close Ticket] shown inside a general support ticket. No approve/deny here
// — there's nothing to decide, just a conversation that gets closed once
// it's resolved. Pressing it doesn't close anything by itself — it shows an
// ephemeral (staff-only) confirmation first, see helpTicketCloseConfirm
// below — so a second press on an already-closed ticket can't happen.
function helpTicketButtons() {
  return new ActionRowBuilder().addComponents(
    applyEmoji(
      new ButtonBuilder()
        .setCustomId('close_help_ticket')
        .setLabel(resolveText('TICKET.closeHelpButton'))
        .setStyle(ButtonStyle.Danger),
      'TICKET.closeHelpEmoji',
    ),
  );
}

// [Yes, Close It] [Cancel] — the ephemeral confirmation shown after Close
// Ticket is pressed. `messageId` is baked into the confirm button's
// customId so its handler knows which message (the original ticket post)
// to recolor/strip buttons from — the ephemeral confirmation is a separate
// message, not the one the original button lived on.
function helpTicketCloseConfirm(messageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm_close_help_ticket:${messageId}`)
      .setLabel(resolveText('TICKET.confirmCloseHelpButton'))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('cancel_close_help_ticket')
      .setLabel(resolveText('TICKET.cancelCloseHelpButton'))
      .setStyle(ButtonStyle.Secondary),
  );
}

function staffMentions(staffRoleId, staffUserId) {
  const mentions = [];
  if (staffRoleId) mentions.push(`<@&${staffRoleId}>`);
  if (staffUserId) mentions.push(`<@${staffUserId}>`);
  return mentions;
}

// Shared by createTicket and createClaimTicket: makes the private channel
// with the standard overwrites (hidden from everyone, visible to the
// requester/claimant, the bot, and configured staff). The caller resolves
// which category to use — request and claim tickets can live under entirely
// different categories, each set by their own /deploy* command.
//
// Throws 'NO_CATEGORY' if that category was never configured.
async function createReviewChannel({ guild, member, botId, channelName, staffRoleId, staffUserId, categoryId, topic }) {
  if (!categoryId) throw new Error('NO_CATEGORY');

  const overwrites = [
    // Hidden from everyone by default...
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    // ...visible to the requester...
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    // ...and to the bot itself.
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];

  // Staff can see it immediately, since the requester already submitted.
  if (staffRoleId) {
    overwrites.push({
      id: staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }
  if (staffUserId) {
    overwrites.push({
      id: staffUserId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  return guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: categoryId,
    permissionOverwrites: overwrites,
    ...(topic ? { topic } : {}),
  });
}

// Creates the private ticket channel for a bounty request. Called only when
// the requester presses Submit on the preview — so the bounty is already
// "submitted" by this point. The channel is created with staff already able
// to see it, the card posted inside, staff pinged, and Approve/Deny ready.
// Named "pending-{requester}-{title}" and the category gets re-alphabetized
// so it's easy to scan by name, not by whoever opened a ticket last.
// Returns the channel. Throws 'NO_CATEGORY' if that category was never set.
async function createTicket({ guild, member, botId, embed, title, staffRoleId, staffUserId, bountyId, categoryId }) {
  const channelName = toChannelName('pending', member.displayName, title);
  const channel = await createReviewChannel({ guild, member, botId, channelName, staffRoleId, staffUserId, categoryId });

  const mentions = staffMentions(staffRoleId, staffUserId);
  await channel.send({
    content: mentions.length
      ? `${mentions.join(' ')} — a new bounty from ${member} is ready for review.`
      : resolveText('TICKET.noRequestStaffConfigured'),
    embeds: [embed],
    components: [staffReviewButtons(bountyId)],
    allowedMentions: {
      roles: staffRoleId ? [staffRoleId] : [],
      users: staffUserId ? [staffUserId] : [],
    },
  });

  await alphabetizeCategory(channel.parent);
  return channel;
}

// Same idea, for a bounty CLAIM: opened right after the claimant submits the
// proof modal. `files` (Attachment objects from the modal's file-upload
// field) get re-posted as a follow-up message so staff see the proof inline.
// Named "claim-{title}-{claimant}" (title first, unlike the request ticket
// above — matches how these are meant to be browsed, by which bounty). The
// exact title also gets stored as the channel's topic (see byClaimTitleThenAge)
// so the category can be grouped by bounty, oldest attempt first within each
// group, without having to reverse-parse the channel name. Throws
// 'NO_CATEGORY' if that category was never set.
async function createClaimTicket({ guild, member, botId, embed, title, staffRoleId, staffUserId, bountyId, files, categoryId, groupType }) {
  const channelName = toChannelName('claim', title, member.displayName);
  const channel = await createReviewChannel({
    guild,
    member,
    botId,
    channelName,
    staffRoleId,
    staffUserId,
    categoryId,
    topic: title,
  });

  const mentions = staffMentions(staffRoleId, staffUserId);
  await channel.send({
    content: mentions.length
      ? `${mentions.join(' ')} — a bounty claim from ${member} needs review.`
      : resolveText('TICKET.noClaimStaffConfigured'),
    embeds: [embed],
    components: [claimReviewButtons(bountyId, groupType)],
    allowedMentions: {
      roles: staffRoleId ? [staffRoleId] : [],
      users: staffUserId ? [staffUserId] : [],
    },
  });

  if (files?.length) {
    await channel.send({ files: files.map((f) => ({ attachment: f.url, name: f.name })) });
  }

  await alphabetizeCategory(channel.parent, byClaimTitleThenAge);
  return channel;
}

// A third, entirely separate kind of ticket: general "talk to staff" support,
// opened from /help's "Talk to Staff" option. No bounty attached, no embed
// card — just a private channel where they type their question and staff
// close it with the one button once it's resolved.
// Throws 'NO_CATEGORY' if that category was never set.
async function createHelpTicket({ guild, member, botId, staffRoleId, staffUserId, categoryId, subject, body }) {
  const channelName = toChannelName(member.displayName, 'support');
  const channel = await createReviewChannel({ guild, member, botId, channelName, staffRoleId, staffUserId, categoryId });

  // Subject/details are both optional — only attach a card if they gave us
  // at least one of them, so a truly blank "just open a ticket" click stays
  // exactly as plain as before.
  const embeds = [];
  if (subject || body) {
    const embed = new EmbedBuilder().setColor(COLORS.brand).setImage(BANNER_URL);
    if (subject) embed.setTitle(subject);
    if (body) embed.setDescription(body);
    embeds.push(embed);
  }

  const mentions = staffMentions(staffRoleId, staffUserId);
  await channel.send({
    content: mentions.length
      ? `${mentions.join(' ')} — ${member} needs help.`
      : resolveText('TICKET.noHelpStaffConfigured'),
    embeds,
    components: [helpTicketButtons()],
    allowedMentions: {
      roles: staffRoleId ? [staffRoleId] : [],
      users: staffUserId ? [staffUserId] : [],
    },
  });

  return channel;
}

module.exports = {
  createTicket,
  createClaimTicket,
  createHelpTicket,
  toChannelName,
  alphabetizeCategory,
  previewButtons,
  staffReviewButtons,
  claimReviewButtons,
  addPremadeSelectRow,
  helpTicketCloseConfirm,
};
