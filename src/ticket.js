const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const TEXT = require('./text');
const { COLORS, BANNER_URL } = TEXT.VISUALS;

// Turn "jeiss" + "Catching 6789!" into a Discord-safe channel name like
// "jeiss-catching-6789". Discord lowercases and hyphenates channel names anyway
// and strips most punctuation, so we do it up front to keep the result
// predictable. The pretty title (caps + punctuation) still lives in the embed.
function toChannelName(nickname, title) {
  const raw = `${nickname}-${title}`;
  let clean = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '') // drop anything Discord wouldn't keep
    .trim()
    .replace(/\s+/g, '-') // spaces → hyphens
    .replace(/-+/g, '-'); // collapse repeated hyphens

  if (!clean) {
    // Title was all emoji/symbols and stripped to nothing — fall back to nickname.
    clean = nickname.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'bounty';
  }

  return clean.slice(0, 90); // stay well under Discord's 100-char limit
}

// [Submit] [Close] shown on the EPHEMERAL preview, before any channel exists.
function previewButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_submit')
      .setLabel(TEXT.TICKET.submitButton)
      .setStyle(ButtonStyle.Success)
      .setEmoji(TEXT.TICKET.submitEmoji),
    new ButtonBuilder()
      .setCustomId('ticket_cancel')
      .setLabel(TEXT.TICKET.closeButton)
      .setStyle(ButtonStyle.Danger)
      .setEmoji(TEXT.TICKET.closeEmoji),
  );
}

// [Approve] [Deny] shown INSIDE the ticket. Only staff can use these (checked
// in the handler). The bounty's database id is baked into the customId so the
// right row gets updated on approve/deny — and this survives bot restarts.
function staffReviewButtons(bountyId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_bounty:${bountyId}`)
      .setLabel(TEXT.TICKET.approveBountyButton)
      .setStyle(ButtonStyle.Success)
      .setEmoji(TEXT.TICKET.approveBountyEmoji),
    new ButtonBuilder()
      .setCustomId(`deny_bounty:${bountyId}`)
      .setLabel(TEXT.TICKET.denyBountyButton)
      .setStyle(ButtonStyle.Danger)
      .setEmoji(TEXT.TICKET.denyBountyEmoji),
  );
}

// [Approve Claim] [Deny Claim] shown inside a claim ticket. Same idea as
// staffReviewButtons above, just a distinct customId prefix so the handler
// can tell "approve a request" and "approve a claim" apart.
function claimReviewButtons(bountyId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_claim:${bountyId}`)
      .setLabel(TEXT.TICKET.approveClaimButton)
      .setStyle(ButtonStyle.Success)
      .setEmoji(TEXT.TICKET.approveClaimEmoji),
    new ButtonBuilder()
      .setCustomId(`deny_claim:${bountyId}`)
      .setLabel(TEXT.TICKET.denyClaimButton)
      .setStyle(ButtonStyle.Danger)
      .setEmoji(TEXT.TICKET.denyClaimEmoji),
  );
}

// [Close Ticket] shown inside a general support ticket. No approve/deny here
// — there's nothing to decide, just a conversation that gets closed once
// it's resolved.
function helpTicketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('close_help_ticket')
      .setLabel(TEXT.TICKET.closeHelpButton)
      .setStyle(ButtonStyle.Danger)
      .setEmoji(TEXT.TICKET.closeHelpEmoji),
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
async function createReviewChannel({ guild, member, botId, channelName, staffRoleId, staffUserId, categoryId }) {
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
  });
}

// Creates the private ticket channel for a bounty request. Called only when
// the requester presses Submit on the preview — so the bounty is already
// "submitted" by this point. The channel is created with staff already able
// to see it, the card posted inside, staff pinged, and Approve/Deny ready.
// Returns the channel. Throws 'NO_CATEGORY' if that category was never set.
async function createTicket({ guild, member, botId, embed, title, staffRoleId, staffUserId, bountyId, categoryId }) {
  const channelName = toChannelName(member.displayName, title);
  const channel = await createReviewChannel({ guild, member, botId, channelName, staffRoleId, staffUserId, categoryId });

  const mentions = staffMentions(staffRoleId, staffUserId);
  await channel.send({
    content: mentions.length
      ? `${mentions.join(' ')} — a new bounty from ${member} is ready for review.`
      : TEXT.TICKET.noRequestStaffConfigured,
    embeds: [embed],
    components: [staffReviewButtons(bountyId)],
    allowedMentions: {
      roles: staffRoleId ? [staffRoleId] : [],
      users: staffUserId ? [staffUserId] : [],
    },
  });

  return channel;
}

// Same idea, for a bounty CLAIM: opened right after the claimant submits the
// proof modal. `files` (Attachment objects from the modal's file-upload
// field) get re-posted as a follow-up message so staff see the proof inline.
// Throws 'NO_CATEGORY' if that category was never set.
async function createClaimTicket({ guild, member, botId, embed, title, staffRoleId, staffUserId, bountyId, files, categoryId }) {
  const channelName = toChannelName(`claim-${member.displayName}`, title);
  const channel = await createReviewChannel({ guild, member, botId, channelName, staffRoleId, staffUserId, categoryId });

  const mentions = staffMentions(staffRoleId, staffUserId);
  await channel.send({
    content: mentions.length
      ? `${mentions.join(' ')} — a bounty claim from ${member} needs review.`
      : TEXT.TICKET.noClaimStaffConfigured,
    embeds: [embed],
    components: [claimReviewButtons(bountyId)],
    allowedMentions: {
      roles: staffRoleId ? [staffRoleId] : [],
      users: staffUserId ? [staffUserId] : [],
    },
  });

  if (files?.length) {
    await channel.send({ files: files.map((f) => ({ attachment: f.url, name: f.name })) });
  }

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
      : TEXT.TICKET.noHelpStaffConfigured,
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
  previewButtons,
  staffReviewButtons,
  claimReviewButtons,
};
