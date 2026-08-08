require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Events,
  MessageFlags,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { buildPanel } = require('./src/panel');
const { buildBountyModal, buildApproveEditModal } = require('./src/modal');
const { buildBountyEmbed } = require('./src/bountyCard');
const { createTicket, previewButtons } = require('./src/ticket');
const { COLORS, BANNER_URL } = require('./src/constants');

// We only need the Guilds intent. No Message Content intent required, so you
// don't have to flip any privileged-intent toggles in the Developer Portal.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const {
  initDb,
  setTicketCategory,
  setStaffRole,
  getStaffRole,
  setStaffUser,
  getStaffUser,
  clearSetting,
  setBoardChannel,
  getBoardChannel,
  createBounty,
  getBountyById,
  updateBounty,
  approveBounty,
  denyBounty,
  getBounties,
} = require('./src/db');

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
    // /deploy  →  save category + staff (role and/or person) + board channel, then post the panel
    if (interaction.isChatInputCommand() && interaction.commandName === 'deploy') {
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

      const reviewers = [staffRole?.name, staffUser ? `@${staffUser.username}` : null]
        .filter(Boolean)
        .join(' and ');

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
        if (b.status === 'approved' && b.approver_id) {
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
            '**For staff:**',
            '> • Submitted bounties open a private ticket and ping the staff role.',
            '> • **Approve** → logs it, posts the card to the board channel.',
            '> • **Deny** → closes the ticket.',
            '> • `/allbounties status:` → list approved / pending / denied / all.',
            '> • `/deploy` → set the category, staff role, and board channel (setup).',
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
        const staffRoleId = await getStaffRole();
        const staffUserId = await getStaffUser();

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
        if (err.message === 'NO_CATEGORY') {
          await interaction.editReply({
            content:
              "⚠️ Setup isn't finished yet — a staff member needs to run `/deploy` and pick a ticket category first.",
            embeds: [],
            components: [],
          });
        } else {
          console.error(err);
          await interaction.editReply({
            content:
              "❌ I couldn't create your ticket channel. This usually means I'm missing the **Manage Channels** permission. Please ping staff.",
            embeds: [],
            components: [],
          });
        }
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
      const staffRoleId = await getStaffRole();
      const staffUserId = await getStaffUser();
      if (!isStaff(interaction.member, staffRoleId, staffUserId)) {
        await interaction.reply({
          content: '⛔ Only staff can approve bounties.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const bountyId = interaction.customId.split(':')[1]; // may be undefined on old tickets
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
          content: `✅ **Approved** by ${interaction.user}${boardNote}.`,
        });
        return;
      }

      // showModal must be the FIRST response — nothing above this sends one.
      await interaction.showModal(buildApproveEditModal(bounty));
      return;
    }

    // "Deny" inside a ticket  →  staff only. Logs it, then closes the ticket.
    if (interaction.isButton() && interaction.customId.startsWith('deny_bounty')) {
      const staffRoleId = await getStaffRole();
      const staffUserId = await getStaffUser();
      if (!isStaff(interaction.member, staffRoleId, staffUserId)) {
        await interaction.reply({
          content: '⛔ Only staff can deny bounties.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const bountyId = interaction.customId.split(':')[1];
      if (bountyId) {
        await denyBounty(bountyId, interaction.user.id).catch(console.error);
      }

      await interaction.reply({
        content: `⛔ **Denied** by ${interaction.user}. Closing this ticket in a few seconds…`,
      });
      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 4000);
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
    // finalize approval and ship it to the board. This is what "Approve"
    // actually commits — the button click above only opens this modal.
    if (interaction.isModalSubmit() && interaction.customId.startsWith('approve_edit_modal')) {
      const bountyId = interaction.customId.split(':')[1];

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

      // Post the (possibly edited) approved card to the public board.
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
        content: `✅ **Approved** by ${interaction.user}${boardNote}.`,
      });
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