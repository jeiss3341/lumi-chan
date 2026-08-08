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
const { buildBountyModal } = require('./src/modal');
const { buildBountyEmbed, bannerAttachment } = require('./src/bountyCard');
const { createTicket, previewButtons } = require('./src/ticket');
const { COLORS } = require('./src/constants');

// We only need the Guilds intent. No Message Content intent required, so you
// don't have to flip any privileged-intent toggles in the Developer Portal.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const {
  initDb,
  setTicketCategory,
  setStaffRole,
  getStaffRole,
  setBoardChannel,
  getBoardChannel,
  createBounty,
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
});

// Is this member allowed to review bounties? True if they hold the configured
// staff role, or have Manage Server (covers owner/admins as a safety net).
function isStaff(member, staffRoleId) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (staffRoleId && member.roles?.cache?.has(staffRoleId)) return true;
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
    // /deploy  →  save category + staff role + board channel, then post the panel
    if (interaction.isChatInputCommand() && interaction.commandName === 'deploy') {
      const category = interaction.options.getChannel('category');
      const staffRole = interaction.options.getRole('staff');
      const board = interaction.options.getChannel('board');

      await setTicketCategory(category.id);
      await setStaffRole(staffRole.id);
      await setBoardChannel(board.id);

      await interaction.channel.send(buildPanel());

      await interaction.reply({
        content: `✅ Bounty panel deployed. Tickets open under **${category.name}**, reviewed by **${staffRole.name}**, approved bounties post to ${board}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // /allbounties  →  list bounties by status (staff only)
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
        const typeStr = b.type === 'solo' ? '🔒 Solo' : '♾️ Stackable';

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

        return `**${b.name}** — ${reward} · ${typeStr}\n${meta}`;
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

        // Record the bounty as 'pending' so it has a DB id for the buttons.
        const bountyId = await createBounty({
          name: data.name,
          description: data.description,
          type: data.type,
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
          bountyId,
        });

        pendingBounties.delete(interaction.user.id);

        await interaction.editReply({
          content: `✅ Your bounty ticket is ready: ${channel}`,
          embeds: [],
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

    // "Approve" inside a ticket  →  staff only. Turns the card green + logs it.
    if (interaction.isButton() && interaction.customId.startsWith('approve_bounty')) {
      const staffRoleId = await getStaffRole();
      if (!isStaff(interaction.member, staffRoleId)) {
        await interaction.reply({
          content: '⛔ Only staff can approve bounties.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const bountyId = interaction.customId.split(':')[1]; // may be undefined on old tickets

      const approved = EmbedBuilder.from(interaction.message.embeds[0]).setColor(COLORS.approved);
      await interaction.update({ embeds: [approved], components: [] });

      // Record the approval (approver + timestamp).
      if (bountyId) {
        await approveBounty(bountyId, interaction.user.id).catch(console.error);
      }

      // Post the approved card to the public board for players to browse.
      let boardNote = '';
      const boardChannelId = await getBoardChannel();
      if (boardChannelId) {
        const board = await interaction.guild.channels.fetch(boardChannelId).catch(() => null);
        if (board) {
          await board.send({ embeds: [approved], files: [bannerAttachment()] });
          boardNote = ` and posted to ${board}`;
        }
      }

      await interaction.followUp({
        content: `✅ **Approved** by ${interaction.user}${boardNote}.`,
      });
      return;
    }

    // "Deny" inside a ticket  →  staff only. Logs it, then closes the ticket.
    if (interaction.isButton() && interaction.customId.startsWith('deny_bounty')) {
      const staffRoleId = await getStaffRole();
      if (!isStaff(interaction.member, staffRoleId)) {
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
      const type = interaction.fields.getStringSelectValues('bounty_type')[0]; // returns an array
      const amountRaw = interaction.fields.getTextInputValue('bounty_amount');

      // Stash for the Submit button (that click won't have the form data).
      pendingBounties.set(interaction.user.id, { name, description, type, amountRaw });

      const embed = buildBountyEmbed({
        name,
        description,
        type,
        amountRaw,
        user: interaction.user,
        status: 'pending',
      });

      await interaction.reply({
        content:
          "Here's your bounty preview. Press **Submit** to open a private ticket and send it to staff — or **Close** to cancel. Nothing is created until you submit.",
        embeds: [embed],
        files: [bannerAttachment()],
        components: [previewButtons()],
        flags: MessageFlags.Ephemeral,
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