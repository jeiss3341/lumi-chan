const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { getTicketCategory } = require('./db');
const { bannerAttachment } = require('./bountyCard');

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
      .setLabel('Submit')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId('ticket_cancel')
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️'),
  );
}

// [Approve] [Deny] shown INSIDE the ticket. Only staff can use these (checked
// in the handler). The bounty's database id is baked into the customId so the
// right row gets updated on approve/deny — and this survives bot restarts.
function staffReviewButtons(bountyId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_bounty:${bountyId}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId(`deny_bounty:${bountyId}`)
      .setLabel('Deny')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⛔'),
  );
}

// Creates the private ticket channel. Called only when the requester presses
// Submit on the preview — so the bounty is already "submitted" by this point.
// The channel is created with staff already able to see it, the card posted
// inside, staff pinged, and Approve/Deny ready. Returns the channel.
//
// Throws 'NO_CATEGORY' if /deploy was never run.
async function createTicket({ guild, member, botId, embed, title, staffRoleId, bountyId }) {
  const categoryId = await getTicketCategory();
  if (!categoryId) throw new Error('NO_CATEGORY');

  const channelName = toChannelName(member.displayName, title);

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

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: categoryId,
    permissionOverwrites: overwrites,
  });

  // Ping staff + post the card with Approve/Deny, all in one clean message.
  await channel.send({
    content: staffRoleId
      ? `<@&${staffRoleId}> — a new bounty from ${member} is ready for review.`
      : "⚠️ No staff role is configured — a staff member should run `/deploy` to set one.",
    embeds: [embed],
    files: [bannerAttachment()],
    components: [staffReviewButtons(bountyId)],
    allowedMentions: staffRoleId ? { roles: [staffRoleId] } : {},
  });

  return channel;
}

module.exports = { createTicket, toChannelName, previewButtons, staffReviewButtons };