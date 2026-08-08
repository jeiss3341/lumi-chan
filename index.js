require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Events,
  MessageFlags,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { buildPanel, buildClaimPanel } = require('./src/panel');
const { buildBountyModal, buildApproveEditModal, buildClaimProofModal } = require('./src/modal');
const { buildBountyEmbed, buildClaimEmbed, formatAmount } = require('./src/bountyCard');
const { createTicket, createClaimTicket, previewButtons } = require('./src/ticket');
const { COLORS, BANNER_URL } = require('./src/constants');

// We only need the Guilds intent. No Message Content intent required, so you
// don't have to flip any privileged-intent toggles in the Developer Portal.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const {
  initDb,
  setTicketCategory,
  getTicketCategory,
  setStaffRole,
  getStaffRole,
  setStaffUser,
  getStaffUser,
  clearSetting,
  setBoardChannel,
  getBoardChannel,
  setClaimTicketCategory,
  getClaimTicketCategory,
  setClaimStaffRole,
  getClaimStaffRole,
  setClaimStaffUser,
  getClaimStaffUser,
  setClaimBoardChannel,
  getClaimBoardChannel,
  setClaimArchiveCategory,
  getClaimArchiveCategory,
  createBounty,
  getBountyById,
  updateBounty,
  approveBounty,
  denyBounty,
  getBounties,
  getClaimableBounties,
  setBoardMessage,
  claimBounty,
} = require('./src/db');

// Pulls the Discord user ID out of an embed field's mention value, e.g. reads
// "<@123>" back out of a field named 'Claimant'. Used on Approve Claim, where
// the claimant's ID isn't otherwise threaded through the customId.
function extractMentionId(embed, fieldName) {
  const field = embed.fields.find((f) => f.name === fieldName);
  const match = field?.value.match(/<@!?(\d+)>/);
  return match ? match[1] : null;
}

// Pull the first number out of free-text like "$10" or "10 bucks" → 10.
function parseReward(raw) {
  const match = String(raw).replace(/,/g, '').match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

// Short-lived holding area for form data between the modal submit and the
// requester pressing Submit on the ephemeral preview. Keyed by user ID.
// This only needs to live for the few seconds in between; if the bot restarts
// in that window, the ephemeral preview is already gone anyway.
const pendingBounties = new Map();

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  await initDb();
  console.log('Database ready.');

  c.user.setPresence({
    activities: [{ name: 'boop', type: 4 }],
  });
});

// Is this member allowed to review bounties? True if they hold the configured
// staff role, are the configured staff person, or have Manage Server (covers
// owner/admins as a safety net).
function isStaff(member, staffRoleId, staffUserId) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (staffRoleId && member.roles?.cache?.has(staffRoleId)) return true;
  if (staffUserId && member.id === staffUserId) return true;
  return false;
}

// Fetches a pipeline's configured staff (role and/or person) as one pair,
// since every call site needs both together.
async function getRequestStaff() {
  return { staffRoleId: await getStaffRole(), staffUserId: await getStaffUser() };
}

async function getClaimStaff() {
  return { staffRoleId: await getClaimStaffRole(), staffUserId: await getClaimStaffUser() };
}

// Replies with an ephemeral "only staff" message and returns false if the
// invoking member doesn't qualify. Callers do:
// `if (!(await requireStaff(interaction, getRequestStaff, 'approve bounties'))) return;`
async function requireStaff(interaction, getStaffIds, action) {
  const { staffRoleId, staffUserId } = await getStaffIds();
  if (isStaff(interaction.member, staffRoleId, staffUserId)) return true;
  await interaction.reply({ content: `⛔ Only staff can ${action}.`, flags: MessageFlags.Ephemeral });
  return false;
}

// The bounty/claim id baked into a customId like "approve_bounty:42".
function customIdArg(interaction) {
  return interaction.customId.split(':')[1];
}

// Deny buttons just close the ticket a few seconds later, so staff's message
// is visible first.
function closeChannelSoon(channel, delayMs = 4000) {
  setTimeout(() => channel.delete().catch(() => {}), delayMs);
}

// Shared by /deployrequestbounty and /deployclaimbounty's confirmation replies.
function describeReviewers(staffRole, staffUser) {
  return [staffRole?.name, staffUser ? `@${staffUser.username}` : null].filter(Boolean).join(' and ');
}

// Shared by ticket_submit and claim_proof_modal: both create a private
// channel and can fail the same two ways.
function ticketCreationError(err, deployCommand, kind) {
  if (err.message === 'NO_CATEGORY') {
    return `⚠️ Setup isn't finished yet — a staff member needs to run \`/${deployCommand}\` and pick a ticket category first.`;
  }
  console.error(err);
  return `❌ I couldn't create your ${kind} channel. This usually means I'm missing the **Manage Channels** permission. Please ping staff.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE global interaction handler. Everything routes off a static customId.
//
// Why not interaction collectors? Collectors live in memory and die when the
// process restarts. Railway restarts on every redeploy, so collector-based
// buttons silently stop working. Static customIds handled here keep working
// forever, no matter how many times the bot restarts.
// ─────────────────────────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // /deployrequestbounty  →  save category + staff (role and/or person) + board channel, then post the panel
    if (interaction.isChatInputCommand() && interaction.commandName === 'deployrequestbounty') {
      const category = interaction.options.getChannel('category');
      const board = interaction.options.getChannel('board');
      const staffRole = interaction.options.getRole('staff_role');
      const staffUser = interaction.options.getUser('staff_user');

      if (!staffRole && !staffUser) {
        await interaction.reply({
          content: '⚠️ Set at least a staff role or a staff person to review bounties.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await setTicketCategory(category.id);
      await setBoardChannel(board.id);
      if (staffRole) await setStaffRole(staffRole.id); else await clearSetting('staff_role');
      if (staffUser) await setStaffUser(staffUser.id); else await clearSetting('staff_user');

      await interaction.channel.send(buildPanel());

      const reviewers = describeReviewers(staffRole, staffUser);

      await interaction.reply({
        content: `✅ Bounty panel deployed. Tickets open under **${category.name}**, reviewed by **${reviewers}**, approved bounties post to ${board}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // /allbounties  →  list bounties by status. Gated entirely by Discord's
    // default member permissions (ManageGuild) on the command itself, so
    // members without that permission never even see it in the command list —
    // no in-code check needed here.
    if (interaction.isChatInputCommand() && interaction.commandName === 'allbounties') {
      const status = interaction.options.getString('status') ?? 'approved';
      const rows = await getBounties(status);

      const label = status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1);

      if (rows.length === 0) {
        await interaction.reply({
          content: `No ${status === 'all' ? '' : status + ' '}bounties yet.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const dateTag = (d) =>
        d ? `<t:${Math.floor(new Date(d).getTime() / 1000)}:D>` : '';

      const shown = rows.slice(0, 25); // keep the embed within limits
      const lines = shown.map((b) => {
        const reward = b.reward != null ? `$${b.reward}` : '—';

        let meta = `by <@${b.requester_id}>`;
        if (b.status === 'claimed' && b.claimer_id) {
          const when = dateTag(b.claimed_at);
          meta += ` · 🔒 claimed by <@${b.claimer_id}>${when ? ` · ${when}` : ''}`;
        } else if (b.status === 'approved' && b.approver_id) {
          const when = dateTag(b.approved_at);
          meta += ` · ✅ approved by <@${b.approver_id}>${when ? ` · ${when}` : ''}`;
        } else if (b.status === 'denied' && b.approver_id) {
          const when = dateTag(b.approved_at);
          meta += ` · ⛔ denied by <@${b.approver_id}>${when ? ` · ${when}` : ''}`;
        } else {
          meta += ` · ⏳ pending`;
        }

        return `**${b.name}** — ${reward}\n${meta}`;
      });

      let description = lines.join('\n\n');
      if (rows.length > 25) description += `\n\n…and ${rows.length - 25} more.`;

      const embed = new EmbedBuilder()
        .setTitle(`📋 ${label} Bounties`)
        .setColor(COLORS.approved)
        .setDescription(description)
        .setFooter({ text: `Coastal Clash • ${rows.length} ${status === 'all' ? 'total' : status}` });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
    // /deployclaimbounty  →  save the CLAIM pipeline's own category + staff
    // (entirely separate from the request pipeline's), then post the claim panel.
    if (interaction.isChatInputCommand() && interaction.commandName === 'deployclaimbounty') {
      const category = interaction.options.getChannel('category');
      const board = interaction.options.getChannel('board');
      const archiveCategory = interaction.options.getChannel('archive_category');
      const staffRole = interaction.options.getRole('staff_role');
      const staffUser = interaction.options.getUser('staff_user');

      if (!staffRole && !staffUser) {
        await interaction.reply({
          content: '⚠️ Set at least a staff role or a staff person to review claims.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await setClaimTicketCategory(category.id);
      await setClaimBoardChannel(board.id);
      await setClaimArchiveCategory(archiveCategory.id);
      if (staffRole) await setClaimStaffRole(staffRole.id); else await clearSetting('claim_staff_role');
      if (staffUser) await setClaimStaffUser(staffUser.id); else await clearSetting('claim_staff_user');

      await interaction.channel.send(buildClaimPanel());

      const reviewers = describeReviewers(staffRole, staffUser);

      await interaction.reply({
        content: `🏁 Claim board deployed. Claims open under **${category.name}**, reviewed by **${reviewers}**, finalized claims post to ${board}, and approved tickets move to **${archiveCategory.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

// /readme  →  how the system works (staff only)
    if (interaction.isChatInputCommand() && interaction.commandName === 'readme') {
      const embed = new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle('📖 How the Bounty System Works')
        .setDescription(
          [
            '**For players:**',
            '> 1. Press **Request Bounty** on the panel.',
            '> 2. Fill out the form (name, description, solo/stackable, reward).',
            '> 3. Review the preview → **Submit** to open a ticket, or **Close** to cancel.',
            '> 4. A private channel opens where staff review it with you.',
            '',
            '',
            '**Claiming a bounty:**',
            '> 1. Press **Claim Bounty** on the claim board.',
            '> 2. Pick which approved bounty you completed from the dropdown.',
            '> 3. Fill out proof (notes + a screenshot or clip) and submit.',
            '> 4. A private channel opens where staff verify your claim.',
            '',
            '**For staff:**',
            '> • Submitted bounties open a private ticket and ping the staff role.',
            '> • **Approve** → edit if needed, logs it, posts the card to the board channel.',
            '> • **Deny** → closes the ticket.',
            '> • **Approve Claim** → marks it claimed, updates the board card, archives the ticket.',
            '> • **Deny Claim** → closes the ticket; bounty stays claimable.',
            '> • `/allbounties status:` → list approved / pending / claimed / denied / all.',
            '> • `/deployrequestbounty` → set the category, staff, and board channel for requests (setup).',
            '> • `/deployclaimbounty` → set the category, staff, board, and archive category for claims (setup).',
          ].join('\n'),
        )
        .setImage(BANNER_URL)
        .setFooter({ text: 'Coastal Clash • Bounty System' });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }


    // "Request Bounty" button  →  pop the modal form
    // NOTE: showModal must be the FIRST response to the interaction.
    if (interaction.isButton() && interaction.customId === 'request_bounty') {
      await interaction.showModal(buildBountyModal());
      return;
    }

    // "Submit" on the ephemeral preview  →  NOW create the private ticket
    if (interaction.isButton() && interaction.customId === 'ticket_submit') {
      const data = pendingBounties.get(interaction.user.id);
      if (!data) {
        await interaction.update({
          content: '⚠️ This request expired. Please start again from **Request Bounty**.',
          embeds: [],
          components: [],
        });
        return;
      }

      // Acknowledge the button first; channel creation can take a beat.
      await interaction.deferUpdate();

      const embed = buildBountyEmbed({
        ...data,
        user: interaction.user,
        status: 'pending',
      });

      try {
        const { staffRoleId, staffUserId } = await getRequestStaff();
        const categoryId = await getTicketCategory();

        // Record the bounty as 'pending' so it has a DB id for the buttons.
        const bountyId = await createBounty({
          name: data.name,
          description: data.description,
          reward: parseReward(data.amountRaw),
          requesterId: interaction.user.id,
        });

        const channel = await createTicket({
          guild: interaction.guild,
          member: interaction.member,
          botId: client.user.id,
          embed,
          title: data.name,
          staffRoleId,
          staffUserId,
          bountyId,
          categoryId,
        });

        pendingBounties.delete(interaction.user.id);

        const readyBanner = new EmbedBuilder().setImage(BANNER_URL);

        await interaction.editReply({
          content: `✅ Your bounty ticket is ready: ${channel}`,
          embeds: [readyBanner],
          components: [],
        });
      } catch (err) {
        pendingBounties.delete(interaction.user.id);
        await interaction.editReply({
          content: ticketCreationError(err, 'deployrequestbounty', 'ticket'),
          embeds: [],
          components: [],
        });
      }
      return;
    }

    // "Close" on the ephemeral preview  →  just cancel, nothing was created
    if (interaction.isButton() && interaction.customId === 'ticket_cancel') {
      pendingBounties.delete(interaction.user.id);
      await interaction.update({
        content: '❌ Cancelled. No ticket was created.',
        embeds: [],
        components: [],
      });
      return;
    }

    // "Approve" inside a ticket  →  staff only. Opens an editable preview of the
    // bounty first; nothing is finalized/shipped to the board until that modal
    // is submitted (see approve_edit_modal below).
    if (interaction.isButton() && interaction.customId.startsWith('approve_bounty')) {
      if (!(await requireStaff(interaction, getRequestStaff, 'approve bounties'))) return;

      const bountyId = customIdArg(interaction); // may be undefined on old tickets
      const bounty = bountyId ? await getBountyById(bountyId) : null;

      if (!bounty) {
        // No DB record to edit (very old ticket) — fall back to approving as-is.
        const approved = EmbedBuilder.from(interaction.message.embeds[0]).setColor(COLORS.approved);
        await interaction.update({ embeds: [approved], components: [] });

        let boardNote = '';
        const boardChannelId = await getBoardChannel();
        if (boardChannelId) {
          const board = await interaction.guild.channels.fetch(boardChannelId).catch(() => null);
          if (board) {
            await board.send({ embeds: [approved] });
            boardNote = ` and posted to ${board}`;
          }
        }

        await interaction.followUp({
          content: `✅ **Approved** by ${interaction.user}${boardNote}. Closing this ticket in a few seconds…`,
        });
        closeChannelSoon(interaction.channel);
        return;
      }

      // showModal must be the FIRST response — nothing above this sends one.
      await interaction.showModal(buildApproveEditModal(bounty));
      return;
    }

    // "Deny" inside a ticket  →  staff only. Logs it, then closes the ticket.
    if (interaction.isButton() && interaction.customId.startsWith('deny_bounty')) {
      if (!(await requireStaff(interaction, getRequestStaff, 'deny bounties'))) return;

      const bountyId = customIdArg(interaction);
      if (bountyId) {
        await denyBounty(bountyId, interaction.user.id).catch(console.error);
      }

      await interaction.reply({
        content: `⛔ **Denied** by ${interaction.user}. Closing this ticket in a few seconds…`,
      });
      closeChannelSoon(interaction.channel);
      return;
    }

    // Modal submitted  →  show the EPHEMERAL preview (no channel yet)
    if (interaction.isModalSubmit() && interaction.customId === 'bounty_modal') {
      const name = interaction.fields.getTextInputValue('bounty_name');
      const description = interaction.fields.getTextInputValue('bounty_description');
      const amountRaw = interaction.fields.getTextInputValue('bounty_amount');

      // Stash for the Submit button (that click won't have the form data).
      pendingBounties.set(interaction.user.id, { name, description, amountRaw });

      const embed = buildBountyEmbed({
        name,
        description,
        amountRaw,
        user: interaction.user,
        status: 'pending',
      });

      await interaction.reply({
        content:
          "Here's your bounty preview. Press **Submit** to open a private ticket and send it to staff — or **Close** to cancel. Nothing is created until you submit.",
        embeds: [embed],
        components: [previewButtons()],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Approve/edit modal submitted  →  save whatever staff edited, THEN
    // finalize approval, ship it to the board, and close the ticket. This is
    // what "Approve" actually commits — the button click above only opens
    // this modal.
    if (interaction.isModalSubmit() && interaction.customId.startsWith('approve_edit_modal')) {
      const bountyId = customIdArg(interaction);

      const name = interaction.fields.getTextInputValue('bounty_name');
      const description = interaction.fields.getTextInputValue('bounty_description');
      const amountRaw = interaction.fields.getTextInputValue('bounty_amount');
      const reward = parseReward(amountRaw);

      const bounty = await getBountyById(bountyId);
      if (!bounty) {
        await interaction.reply({
          content: '⚠️ This bounty no longer exists in the database.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await updateBounty(bountyId, { name, description, reward });
      await approveBounty(bountyId, interaction.user.id);

      const requester = await client.users.fetch(bounty.requester_id).catch(() => null);
      const approved = buildBountyEmbed({
        name,
        description,
        amountRaw,
        user: requester ?? interaction.user,
        status: 'approved',
      });

      // This modal was opened from the ticket message's Approve button, so
      // update() edits that same message (turns it green, drops the buttons).
      await interaction.update({ embeds: [approved], components: [] });

      // Post the (possibly edited) approved card to the public board, and
      // remember where it landed so a later claim can find and edit it.
      let boardNote = '';
      const boardChannelId = await getBoardChannel();
      if (boardChannelId) {
        const board = await interaction.guild.channels.fetch(boardChannelId).catch(() => null);
        if (board) {
          const boardMsg = await board.send({ embeds: [approved] });
          await setBoardMessage(bountyId, board.id, boardMsg.id).catch(console.error);
          boardNote = ` and posted to ${board}`;
        }
      }

      await interaction.followUp({
        content: `✅ **Approved** by ${interaction.user}${boardNote}. Closing this ticket in a few seconds…`,
      });
      closeChannelSoon(interaction.channel);
      return;
    }

    // "Claim Bounty" button on the claim board  →  show a dropdown of
    // currently approved (and not yet claimed) bounties to pick from.
    if (interaction.isButton() && interaction.customId === 'claim_bounty') {
      const claimable = await getClaimableBounties();

      if (claimable.length === 0) {
        await interaction.reply({
          content: '📭 No approved bounties are available to claim right now.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('claim_select')
          .setPlaceholder('Choose a bounty to claim')
          .addOptions(
            claimable.map((b) => ({
              label: b.name.slice(0, 100),
              description: formatAmount(b.reward).slice(0, 100),
              value: String(b.id),
            })),
          ),
      );

      await interaction.reply({
        content: 'Which bounty are you claiming?',
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Bounty picked from the claim dropdown  →  pop the proof modal.
    // NOTE: showModal must be the FIRST response to the interaction.
    if (interaction.isStringSelectMenu() && interaction.customId === 'claim_select') {
      const bounty = await getBountyById(interaction.values[0]);

      if (!bounty || bounty.status !== 'approved') {
        await interaction.update({
          content: '⚠️ That bounty is no longer available to claim.',
          components: [],
        });
        return;
      }

      await interaction.showModal(buildClaimProofModal(bounty));
      return;
    }

    // Proof modal submitted  →  create the private claim ticket immediately.
    // Unlike bounty requests there's no separate preview/submit step here —
    // the proof itself (notes + files) IS the submission.
    if (interaction.isModalSubmit() && interaction.customId.startsWith('claim_proof_modal')) {
      const bountyId = customIdArg(interaction);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const bounty = await getBountyById(bountyId);
      if (!bounty || bounty.status !== 'approved') {
        await interaction.editReply({
          content: '⚠️ This bounty is no longer available to claim (it may have already been claimed).',
        });
        return;
      }

      const notes = interaction.fields.getTextInputValue('claim_notes');
      const uploaded = interaction.fields.getUploadedFiles('claim_files', false);
      const files = uploaded ? [...uploaded.values()] : [];

      const embed = buildClaimEmbed({ bounty, claimant: interaction.user, notes, status: 'pending' });

      try {
        const { staffRoleId, staffUserId } = await getClaimStaff();
        const categoryId = await getClaimTicketCategory();

        const channel = await createClaimTicket({
          guild: interaction.guild,
          member: interaction.member,
          botId: client.user.id,
          embed,
          title: bounty.name,
          staffRoleId,
          staffUserId,
          bountyId: bounty.id,
          files,
          categoryId,
        });

        await interaction.editReply({ content: `🏁 Your claim is in: ${channel}` });
      } catch (err) {
        await interaction.editReply({ content: ticketCreationError(err, 'deployclaimbounty', 'claim') });
      }
      return;
    }

    // "Approve Claim" inside a claim ticket  →  staff only. Finalizes the
    // claim (guarded against a bounty already claimed elsewhere), marks the
    // original request-board post claimed, and logs it to the claim board.
    if (interaction.isButton() && interaction.customId.startsWith('approve_claim')) {
      if (!(await requireStaff(interaction, getClaimStaff, 'approve claims'))) return;

      const bountyId = customIdArg(interaction);
      const claimantId = interaction.message.embeds[0]
        ? extractMentionId(interaction.message.embeds[0], 'Claimant')
        : null;
      const updated = bountyId && claimantId ? await claimBounty(bountyId, claimantId) : null;

      if (!updated) {
        await interaction.reply({
          content: '⚠️ Could not finalize this claim — the bounty may have already been claimed elsewhere, or its record is missing.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(COLORS.approved);
      await interaction.update({ embeds: [approvedEmbed], components: [] });

      const notes = [];

      if (updated.board_channel_id && updated.board_message_id) {
        const boardChannel = await interaction.guild.channels.fetch(updated.board_channel_id).catch(() => null);
        const boardMsg = boardChannel
          ? await boardChannel.messages.fetch(updated.board_message_id).catch(() => null)
          : null;
        if (boardMsg?.embeds[0]) {
          const claimedEmbed = EmbedBuilder.from(boardMsg.embeds[0])
            .setColor(COLORS.claimed)
            .setTitle(`🏁 CLAIMED — ${updated.name}`);
          await boardMsg.edit({ embeds: [claimedEmbed] }).catch(console.error);
          notes.push('marked claimed on the board');
        }
      }

      const claimBoardChannelId = await getClaimBoardChannel();
      if (claimBoardChannelId) {
        const claimBoard = await interaction.guild.channels.fetch(claimBoardChannelId).catch(() => null);
        if (claimBoard) {
          await claimBoard.send({ embeds: [approvedEmbed] }).catch(console.error);
          notes.push(`posted to ${claimBoard}`);
        }
      }

      // Move the resolved ticket out of general view instead of deleting it —
      // lockPermissions adopts the archive category's own overwrites, so it
      // drops out of everyone's sight except whoever that category is scoped to.
      const archiveCategoryId = await getClaimArchiveCategory();
      if (archiveCategoryId) {
        await interaction.channel.setParent(archiveCategoryId, { lockPermissions: true }).catch(console.error);
        notes.push('archived');
      }

      const boardNote = notes.length ? ` and ${notes.join(' and ')}` : '';

      await interaction.followUp({
        content: `🏁 **Claim approved** by ${interaction.user}${boardNote}.`,
      });
      return;
    }

    // "Deny Claim" inside a claim ticket  →  staff only. Just closes the
    // ticket; the bounty stays 'approved' so it's still claimable by anyone.
    if (interaction.isButton() && interaction.customId.startsWith('deny_claim')) {
      if (!(await requireStaff(interaction, getClaimStaff, 'deny claims'))) return;

      await interaction.reply({
        content: `⛔ **Claim denied** by ${interaction.user}. Closing this ticket in a few seconds…`,
      });
      closeChannelSoon(interaction.channel);
      return;
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: 'Something went wrong. Please ping staff.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);