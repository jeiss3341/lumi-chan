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
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  Options,
  OverwriteType,
} = require('discord.js');
const { buildPanel, buildClaimPanel, buildTicketPanel, buildQandAPanel } = require('./src/panel');
const { buildQandAMenu, buildQandAAnswer } = require('./src/qanda');
const { buildBountyModal, buildApproveModalStep1, buildApproveModalStep2, buildClaimProofModal, buildTicketDetailsModal } = require('./src/modal');
const { buildBountyEmbed, buildClaimEmbed, formatAmount } = require('./src/bountyCard');
const { buildBountiesWorkbook } = require('./src/bountyExport');
const {
  createTicket,
  createClaimTicket,
  createHelpTicket,
  toChannelName,
  alphabetizeCategory,
  previewButtons,
  helpTicketCloseConfirm,
} = require('./src/ticket');
const { startServer } = require('./src/styleGuide/server');
const { loadOverrides } = require('./src/styleGuide/overrides');
const { resolveText } = require('./src/styleGuide/liveText');
const TEXT = require('./src/text');
const { COLORS, BANNER_URL } = TEXT.VISUALS;

// We only need the Guilds intent. No Message Content intent required, so you
// don't have to flip any privileged-intent toggles in the Developer Portal.
//
// Deliberate trade-off: without MessageContent (a privileged intent — risky
// to turn on for a bot mid-event, since Discord rejects the whole
// connection if it's requested but not enabled in the Developer Portal),
// Discord blanks out message.content for anything a real user sent. The
// admin Tickets page's chat log (src/styleGuide/ticketRoutes.js) can
// therefore only show full content for the bot's OWN messages (embeds,
// prompts) — a real user's replies show up as an empty row (name/avatar/
// timestamp, no text). Accepted as-is rather than risk the bot going down.
//
// The message sweeper matters more than it looks: discord.js's DEFAULT
// sweeper config only ever sweeps threads, never messages — so every
// message stays cached for the life of the process. The admin Tickets page
// (src/styleGuide/ticketRoutes.js) fetches up to 100 messages each time an
// admin opens a ticket, and without this those would accumulate until the
// next deploy. 30min lifetime, swept every 10min; nothing here needs an
// old message to still be in cache (the page always re-fetches).
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 600, lifetime: 1800 },
  },
});

// Node terminates the process on an unhandled promise rejection, which for
// an always-on bot means a hard restart (and, on Railway, a crash loop if
// whatever failed is still failing). These two handlers turn "die silently"
// into "log it and keep serving" — a dropped Postgres query or a Discord
// hiccup shouldn't take the whole bot down with it.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection (kept running):', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (kept running):', err);
});

// Public style-guide + bounty admin pages — the bounty pages
// (src/styleGuide/bountyRoutes.js) fetch channels/messages through `client`
// to keep an approved bounty's board post in sync with admin edits, so
// `client` has to exist (not necessarily be logged in yet) before
// startServer() runs. Also has to wait on loadOverrides(), so the very
// first request after a cold start doesn't render defaults-only before any
// saved edits are in the cache.
//
// If loadOverrides() fails (Postgres briefly unreachable mid-deploy is the
// realistic case), still start the HTTP server — it'll serve text.js's
// defaults instead of saved edits, which beats not starting at all.
(async () => {
  try {
    await loadOverrides();
  } catch (err) {
    console.error('Failed to load content overrides — serving text.js defaults instead:', err);
  }
  startServer(client);
})();

const {
  initDb,
  setTicketCategory,
  getTicketCategory,
  getRequestArchiveCategory,
  setStaffRole,
  getStaffRole,
  setStaffUser,
  getStaffUser,
  clearSetting,
  setBoardChannel,
  getBoardChannel,
  setClaimTicketCategory,
  getClaimTicketCategory,
  setSubmissionsTicketCategory,
  getSubmissionsTicketCategory,
  setClaimStaffRole,
  getClaimStaffRole,
  setClaimStaffUser,
  getClaimStaffUser,
  setClaimBoardChannel,
  getClaimBoardChannel,
  setClaimArchiveCategory,
  getClaimArchiveCategory,
  setHelpTicketCategory,
  getHelpTicketCategory,
  getHelpArchiveCategory,
  setHelpArchiveCategory,
  setHelpStaffRole,
  getHelpStaffRole,
  setHelpStaffUser,
  getHelpStaffUser,
  createBounty,
  getBountyById,
  updateBounty,
  findTitleConflict,
  denyBounty,
  setBountyStatus,
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

// Short-lived holding area for form data between the modal submit and the
// requester pressing Submit on the ephemeral preview. Keyed by user ID.
// This only needs to live for the few seconds in between; if the bot restarts
// in that window, the ephemeral preview is already gone anyway.
//
// Entries are only deleted when the requester actually presses Submit or
// Close — anyone who opens the form and then walks away used to leave one
// behind permanently, so this grew without bound. The sweeper below drops
// abandoned entries. 15 minutes because that's how long Discord keeps an
// interaction token alive: past that the ephemeral preview's Submit button
// can't work anyway, so the data is already dead weight.
const PENDING_BOUNTY_TTL_MS = 15 * 60 * 1000;
const pendingBounties = new Map();

// Same idea, for the Approve flow's step 1 → step 2 handoff (see
// approve_modal_step1 / approve_modal_step2 below) — Discord's 5-component
// modal cap means the 6 approve fields (preferred name, name, description,
// reward, reward type, tier) can't fit in one modal, so step 1's values sit
// here until step 2 is submitted. Keyed by bounty id, not user id, since
// that's what's already threaded through every customId in this flow.
const pendingApprovals = new Map();

// unref() so this timer never by itself keeps the process alive.
setInterval(() => {
  const cutoff = Date.now() - PENDING_BOUNTY_TTL_MS;
  for (const [userId, data] of pendingBounties) {
    if (data.createdAt < cutoff) pendingBounties.delete(userId);
  }
  for (const [bountyId, data] of pendingApprovals) {
    if (data.createdAt < cutoff) pendingApprovals.delete(bountyId);
  }
}, 5 * 60 * 1000).unref();

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);

  // initDb() creates tables and warms the settings cache. If it throws
  // (Postgres unreachable), log it and stay connected rather than letting
  // an unhandled rejection kill the process — Discord-side reads that don't
  // need the DB keep working, and the next DB call retries on its own.
  try {
    await initDb();
    console.log('Database ready.');
  } catch (err) {
    console.error('Database init failed — the bot is up, but DB-backed features will error until it recovers:', err);
  }

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
// since every call site needs both together. The two reads are independent,
// so fetch them concurrently rather than one-then-the-other.
async function getRequestStaff() {
  const [staffRoleId, staffUserId] = await Promise.all([getStaffRole(), getStaffUser()]);
  return { staffRoleId, staffUserId };
}

async function getClaimStaff() {
  const [staffRoleId, staffUserId] = await Promise.all([getClaimStaffRole(), getClaimStaffUser()]);
  return { staffRoleId, staffUserId };
}

async function getHelpStaff() {
  const [staffRoleId, staffUserId] = await Promise.all([getHelpStaffRole(), getHelpStaffUser()]);
  return { staffRoleId, staffUserId };
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

// Sorts a list of bounty rows for /allbounties per the `order` option:
// 'alphabetical' (by name), 'oldest'/'newest' (by approved_at, falling back
// to created_at for ones never approved). Returns a new array.
function sortBounties(rows, order) {
  const sorted = [...rows];
  if (order === 'alphabetical') {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }
  sorted.sort((a, b) => {
    const aTime = new Date(a.approved_at ?? a.created_at).getTime();
    const bTime = new Date(b.approved_at ?? b.created_at).getTime();
    return order === 'oldest' ? aTime - bTime : bTime - aTime;
  });
  return sorted;
}

// Flattens rows into their final /allbounties order. `order` is the within-
// group sort (see sortBounties); `groupByStatus` adds status as the PRIMARY
// key, concatenating the groups in TEXT.ALL_BOUNTIES' order (Approved →
// Pending → Claimed → Denied) so, e.g., "alphabetical + by status" reads as
// each status block sorted A–Z. Used by the export; the on-screen list builds
// the same grouping itself so it can add section headers.
function orderBounties(rows, order, groupByStatus) {
  if (!groupByStatus) return sortBounties(rows, order);
  const ordered = [];
  const known = new Set();
  for (const groupStatus of Object.keys(TEXT.ALL_BOUNTIES)) {
    known.add(groupStatus);
    ordered.push(...sortBounties(rows.filter((b) => b.status === groupStatus), order));
  }
  // Anything with a status not listed in ALL_BOUNTIES still gets included.
  ordered.push(...sortBounties(rows.filter((b) => !known.has(b.status)), order));
  return ordered;
}

// Discord's select menu caps at 25 options, so the claim dropdown is
// paginated in pages of this size (alphabetical, see getClaimableBounties).
const CLAIM_PAGE_SIZE = 25;

// Builds the { content, components } payload for the claim dropdown at a
// given page — shared by the "Claim Bounty" button (page 0) and the
// claim_page Prev/Next buttons (any later page), so both render identically.
function buildClaimPickerPayload(rows, total, offset) {
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('claim_select')
      .setPlaceholder(resolveText('REPLIES.claimSelectPlaceholder'))
      .addOptions(
        rows.map((b) => ({
          label: b.name.slice(0, 100),
          description: formatAmount(b.reward).slice(0, 100),
          value: String(b.id),
        })),
      ),
  );

  const components = [row];
  let content = resolveText('REPLIES.claimPickPrompt');

  if (total > CLAIM_PAGE_SIZE) {
    const page = Math.floor(offset / CLAIM_PAGE_SIZE);
    const totalPages = Math.ceil(total / CLAIM_PAGE_SIZE);
    const prevOffset = Math.max(0, offset - CLAIM_PAGE_SIZE);
    const nextOffset = offset + CLAIM_PAGE_SIZE;

    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`claim_page:${prevOffset}`)
          .setLabel(resolveText('REPLIES.claimPrevButton'))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(offset === 0),
        new ButtonBuilder()
          .setCustomId(`claim_page:${nextOffset}`)
          .setLabel(resolveText('REPLIES.claimNextButton'))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(nextOffset >= total),
      ),
    );
    content += ` (Page ${page + 1}/${totalPages})`;
  }

  return { content, components };
}

// Deny buttons just close the ticket a few seconds later, so staff's message
// is visible first.
function closeChannelSoon(channel, delayMs = 4000) {
  setTimeout(() => channel.delete().catch(() => {}), delayMs);
}

// Moves a resolved ticket out of general view instead of deleting it, same
// idea as the claim-approval archiving further down this file — but falls
// back to the original delayed-delete (closeChannelSoon) if no archive
// category is configured, so nothing changes for anyone who hasn't set one
// up. Archived channels keep their full message history; that's what makes
// the admin Tickets page's closed-ticket view (src/styleGuide/
// ticketRoutes.js) possible at all — deleted ones leave nothing to show.
// No delay needed here (unlike closeChannelSoon) since archiving doesn't
// erase the closing message — it's still readable in the archived channel.
async function closeOrArchiveTicket(channel, archiveCategoryId) {
  if (archiveCategoryId) {
    await channel.setParent(archiveCategoryId, { lockPermissions: true }).catch(console.error);
    await channel.setName(toChannelName('closed', channel.name)).catch(console.error);
    await alphabetizeCategory(channel.parent).catch(console.error);
    return;
  }
  closeChannelSoon(channel);
}

// True if this channel is already sitting in the given archive category —
// guards deny_bounty/deny_claim below, whose buttons (unlike Close Ticket's,
// see confirm_close_help_ticket above) never get removed after being
// pressed. Without this, a second press just re-archives an already-archived
// ticket, stacking another "closed-" onto its name each time.
function isAlreadyArchived(channel, archiveCategoryId) {
  return Boolean(archiveCategoryId) && channel.parentId === archiveCategoryId;
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

// Shared by the "Talk to Staff" details modal's submit handler — builds the
// ticket and the reply payload; the caller applies it via reply()/update().
// subject/body are both optional.
async function createHelpTicketReply(interaction, { subject, body } = {}) {
  try {
    const { staffRoleId, staffUserId } = await getHelpStaff();
    const categoryId = await getHelpTicketCategory();

    const channel = await createHelpTicket({
      guild: interaction.guild,
      member: interaction.member,
      botId: client.user.id,
      staffRoleId,
      staffUserId,
      categoryId,
      subject,
      body,
    });

    const readyBanner = new EmbedBuilder().setImage(BANNER_URL);
    return { content: `💬 Your ticket is open: ${channel}`, embeds: [readyBanner], components: [] };
  } catch (err) {
    return { content: ticketCreationError(err, 'deployticket', 'support'), embeds: [], components: [] };
  }
}

// Builds the themed .xlsx for `status`/`order` and sends it as the reply, for
// /allbounties' `export:Yes` option. `groupByStatus` mirrors the command's
// `filter:By Status` option — when true, rows are blocked by status then
// ordered within. The interaction MUST already be deferred (ephemeral)
// before calling this — the workbook + user lookups take a moment.
async function sendBountyExport(interaction, status, order, groupByStatus) {
  const rows = orderBounties(await getBounties(status), order, groupByStatus);
  const label = status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1);

  if (rows.length === 0) {
    await interaction.editReply({ content: `No ${status === 'all' ? '' : status + ' '}bounties to export yet.` });
    return;
  }

  // Resolve every requester/approver/claimant id to a username once.
  const userIds = new Set();
  for (const b of rows) {
    if (b.requester_id) userIds.add(b.requester_id);
    if (b.approver_id) userIds.add(b.approver_id);
    if (b.claimer_id) userIds.add(b.claimer_id);
  }
  const names = new Map();
  await Promise.all(
    [...userIds].map(async (id) => {
      const user = await client.users.fetch(id).catch(() => null);
      names.set(id, user ? user.username : 'Unknown User');
    }),
  );

  const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { dateStyle: 'medium' }) : '');

  const entries = rows.map((b) => ({
    name: b.name,
    status: b.status.charAt(0).toUpperCase() + b.status.slice(1),
    reward: formatAmount(b.reward),
    requester: b.requester_id ? names.get(b.requester_id) : '',
    approver: b.approver_id ? names.get(b.approver_id) : '',
    approvedDate: formatDate(b.approved_at),
    claimant: b.claimer_id ? names.get(b.claimer_id) : '',
    claimedDate: formatDate(b.claimed_at),
    description: b.description,
  }));

  const buffer = await buildBountiesWorkbook({
    entries,
    label,
    order,
    generatedBy: interaction.user.username,
  });

  const dateStamp = new Date().toISOString().slice(0, 10);
  const file = new AttachmentBuilder(Buffer.from(buffer), {
    name: `coastal-clash-${status}-bounties-${dateStamp}.xlsx`,
  });

  await interaction.editReply({
    content: resolveText('REPLIES.exportReady').replace('%s', String(entries.length)),
    files: [file],
  });
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
          content: resolveText('REPLIES.missingRequestStaff'),
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
      const status = interaction.options.getString('status'); // required, always set
      const order = interaction.options.getString('order') ?? 'newest';
      // `filter` (whether to group by status) defaults to on for status:all
      // — how "all" has always behaved — and off otherwise. Since it's a
      // single-choice option (no explicit "off" value, same idea as
      // `export`), including it always forces it on.
      const groupByStatus = interaction.options.getString('filter') === 'by_status' || status === 'all';

      // Including `export` skips the on-screen list and just hands back the
      // themed .xlsx directly — the same file the results' button produces.
      if (interaction.options.getString('export') === 'yes') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await sendBountyExport(interaction, status, order, groupByStatus);
        return;
      }

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

      const lineFor = (b) => {
        const reward = b.reward || '—';

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
      };

      // With filter:By Status, group by status (in TEXT.ALL_BOUNTIES' key
      // order) with a header per group, then sort within each group by
      // `order` — so results read as distinct categories. Otherwise it's one
      // flat list ordered by `order` alone.
      const sections = [];
      if (groupByStatus) {
        for (const [groupStatus, header] of Object.entries(TEXT.ALL_BOUNTIES)) {
          const group = sortBounties(rows.filter((b) => b.status === groupStatus), order);
          if (group.length > 0) sections.push({ header, lines: group.map(lineFor) });
        }
      } else {
        sections.push({ header: null, lines: sortBounties(rows, order).map(lineFor) });
      }

      // Every bounty gets shown — nothing is truncated. Each section's lines
      // are chunked into pages of 25 (keeps well under an embed's 4096-char
      // description limit); a section that spills past one page repeats its
      // header on the next chunk, marked "(cont.)" so it still reads as one
      // group. Chunks are then packed into embeds (max 25 entries each so
      // pages stay easy to scan), and embeds are batched 10 per message
      // (Discord's per-message embed cap) — extra batches go out as follow-ups.
      const PAGE_SIZE = 25;
      const chunks = [];
      for (const section of sections) {
        for (let i = 0; i < section.lines.length; i += PAGE_SIZE) {
          const lines = section.lines.slice(i, i + PAGE_SIZE);
          const header = section.header ? (i === 0 ? section.header : `${section.header} (cont.)`) : null;
          chunks.push({ header, lines });
        }
      }

      const embeds = chunks.map((chunk, idx) => {
        const description = chunk.header ? `**${chunk.header}**\n${chunk.lines.join('\n\n')}` : chunk.lines.join('\n\n');
        const title = chunks.length > 1 ? `📋 ${label} Bounties (${idx + 1}/${chunks.length})` : `📋 ${label} Bounties`;
        return new EmbedBuilder()
          .setTitle(title)
          .setColor(COLORS.approved)
          .setDescription(description)
          .setFooter({ text: `Coastal Clash • ${rows.length} ${status === 'all' ? 'total' : status}` });
      });

      // Discord caps a message at 10 embeds AND 6000 total characters summed
      // across every embed's title+description+footer — 10 near-full embeds
      // blows past that second cap well before the first. Batch on whichever
      // limit hits first.
      const MAX_EMBEDS_PER_MESSAGE = 10;
      const MAX_CHARS_PER_MESSAGE = 5900; // small safety margin under Discord's 6000
      const embedCharCount = (embed) => {
        const data = embed.toJSON();
        return (data.title?.length ?? 0) + (data.description?.length ?? 0) + (data.footer?.text?.length ?? 0);
      };

      const batches = [];
      let batch = [];
      let batchChars = 0;
      for (const embed of embeds) {
        const size = embedCharCount(embed);
        if (batch.length > 0 && (batch.length >= MAX_EMBEDS_PER_MESSAGE || batchChars + size > MAX_CHARS_PER_MESSAGE)) {
          batches.push(batch);
          batch = [];
          batchChars = 0;
        }
        batch.push(embed);
        batchChars += size;
      }
      if (batch.length > 0) batches.push(batch);

      for (let i = 0; i < batches.length; i++) {
        const payload = { embeds: batches[i], flags: MessageFlags.Ephemeral };
        if (i === 0) {
          await interaction.reply(payload);
        } else {
          await interaction.followUp(payload);
        }
      }
      return;
    }

    // /deployclaimbounty  →  save the CLAIM pipeline's own categories + staff
    // (entirely separate from the request pipeline's), then post the claim
    // panel. Two active categories (Claim / Submissions) share one board and
    // one archive category — which category a given bounty's claim opens in
    // is decided per-bounty by staff at approval time (Claim Type field).
    if (interaction.isChatInputCommand() && interaction.commandName === 'deployclaimbounty') {
      const claimCategory = interaction.options.getChannel('claim_category');
      const submissionsCategory = interaction.options.getChannel('submissions_category');
      const board = interaction.options.getChannel('board');
      const archiveCategory = interaction.options.getChannel('archive_category');
      const staffRole = interaction.options.getRole('staff_role');
      const staffUser = interaction.options.getUser('staff_user');

      if (!staffRole && !staffUser) {
        await interaction.reply({
          content: resolveText('REPLIES.missingClaimStaff'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await setClaimTicketCategory(claimCategory.id);
      await setSubmissionsTicketCategory(submissionsCategory.id);
      await setClaimBoardChannel(board.id);
      await setClaimArchiveCategory(archiveCategory.id);
      if (staffRole) await setClaimStaffRole(staffRole.id); else await clearSetting('claim_staff_role');
      if (staffUser) await setClaimStaffUser(staffUser.id); else await clearSetting('claim_staff_user');

      await interaction.channel.send(buildClaimPanel());

      const reviewers = describeReviewers(staffRole, staffUser);

      await interaction.reply({
        content: `🏁 Claim board deployed. Claims open under **${claimCategory.name}** or **${submissionsCategory.name}** (set per-bounty by staff at approval), reviewed by **${reviewers}**, finalized claims post to ${board}, and approved tickets move to **${archiveCategory.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // /deployticket  →  save the general "talk to staff" pipeline's own
    // category + staff — entirely separate from requests and claims. No
    // board here; these aren't bounties. archive_category is optional
    // (unlike deployclaimbounty's required one) — unset just falls back to
    // deleting a closed ticket, same as the original behavior.
    if (interaction.isChatInputCommand() && interaction.commandName === 'deployticket') {
      const category = interaction.options.getChannel('category');
      const archiveCategory = interaction.options.getChannel('archive_category');
      const staffRole = interaction.options.getRole('staff_role');
      const staffUser = interaction.options.getUser('staff_user');

      if (!staffRole && !staffUser) {
        await interaction.reply({
          content: resolveText('REPLIES.missingTicketStaff'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await setHelpTicketCategory(category.id);
      if (archiveCategory) await setHelpArchiveCategory(archiveCategory.id); else await clearSetting('help_archive_category');
      if (staffRole) await setHelpStaffRole(staffRole.id); else await clearSetting('help_staff_role');
      if (staffUser) await setHelpStaffUser(staffUser.id); else await clearSetting('help_staff_user');

      await interaction.channel.send(buildTicketPanel());

      const reviewers = describeReviewers(staffRole, staffUser);
      const archiveNote = archiveCategory ? `, and closed tickets move to **${archiveCategory.name}**` : '';

      await interaction.reply({
        content: `💬 Support board deployed. Tickets open under **${category.name}**, handled by **${reviewers}**${archiveNote}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // /deployqanda  →  just posts the Q&A board. No settings to save — Q&A
    // is pure static content, never touches staff or creates a ticket.
    if (interaction.isChatInputCommand() && interaction.commandName === 'deployqanda') {
      await interaction.channel.send(buildQandAPanel());
      await interaction.reply({
        content: '❓ Q&A board deployed in this channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

// /readme  →  how the system works (staff only)
    if (interaction.isChatInputCommand() && interaction.commandName === 'readme') {
      const embed = new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(TEXT.README.title)
        .setDescription(TEXT.README.description.join('\n'))
        .setImage(BANNER_URL)
        .setFooter({ text: TEXT.FOOTER });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    // "Ask a Question" button on the Q&A board  →  replies with the topic
    // dropdown. Entirely separate system from support tickets below — this
    // never creates a ticket or pings staff.
    if (interaction.isButton() && interaction.customId === 'open_qanda') {
      await interaction.reply({ ...buildQandAMenu(), flags: MessageFlags.Ephemeral });
      return;
    }

    // Topic picked from the dropdown (the one from the button above, or the
    // one attached to a previous answer) — both live on a message only this
    // person can see, so it's always safe to update it in place.
    if (interaction.isStringSelectMenu() && interaction.customId === 'qanda_select') {
      const answer = buildQandAAnswer(interaction.values[0]);
      if (!answer) {
        await interaction.update({ content: resolveText('REPLIES.genericError'), embeds: [], components: [] });
        return;
      }
      await interaction.update(answer);
      return;
    }

    // "Talk to Staff" button on the support board  →  pop a modal for the
    // optional Subject/Details (like an email's subject + body), then open
    // the ticket on submit. Entirely separate from Q&A above — this is the
    // only way to reach a support ticket right now.
    // NOTE: this button lives on the PERMANENT public panel message, so its
    // modal's submit handler below must reply(), never update() — updating
    // would overwrite that public panel with a private ticket confirmation.
    if (interaction.isButton() && interaction.customId === 'open_help_ticket') {
      await interaction.showModal(buildTicketDetailsModal('panel'));
      return;
    }

    // Subject/Details modal submitted  →  create the ticket. `source` (from
    // the customId) is kept around for whichever entry point triggered this,
    // even though only the panel button uses it today — reply() vs update()
    // would differ if another entry point gets added later.
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_details_modal')) {
      const source = customIdArg(interaction);
      const subject = interaction.fields.getTextInputValue('ticket_subject');
      const body = interaction.fields.getTextInputValue('ticket_body');

      if (source === 'switch') {
        await interaction.deferUpdate();
      } else {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      }
      await interaction.editReply(await createHelpTicketReply(interaction, { subject, body }));
      return;
    }

    // "Close Ticket" inside a general support ticket  →  staff only. Doesn't
    // close anything yet — shows an ephemeral (staff-only) "are you sure?"
    // first (confirm_close_help_ticket / cancel_close_help_ticket below).
    // The original button used to stay clickable after closing, so a second
    // press on an already-closed ticket would silently re-archive it,
    // stacking "closed-closed-..." onto the channel name — the confirm step
    // also drops that button for good once actually closed, fixing that.
    if (interaction.isButton() && interaction.customId === 'close_help_ticket') {
      if (!(await requireStaff(interaction, getHelpStaff, 'close tickets'))) return;

      await interaction.reply({
        content: 'Close this ticket? This archives (or deletes, if no archive category is set) the channel.',
        components: [helpTicketCloseConfirm(interaction.message.id)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // "Yes, Close It"  →  staff only. This is what actually commits the
    // close — recolors the original ticket message and drops its button (so
    // it can never be pressed again), then archives/closes the channel.
    if (interaction.isButton() && interaction.customId.startsWith('confirm_close_help_ticket')) {
      if (!(await requireStaff(interaction, getHelpStaff, 'close tickets'))) return;

      const originalMessageId = customIdArg(interaction);
      const originalMessage = originalMessageId
        ? await interaction.channel.messages.fetch(originalMessageId).catch(() => null)
        : null;
      if (originalMessage) {
        const embeds = originalMessage.embeds.length
          ? [EmbedBuilder.from(originalMessage.embeds[0]).setColor(COLORS.navy)]
          : [];
        await originalMessage.edit({ embeds, components: [] }).catch(console.error);
      }

      const helpArchiveCategoryId = await getHelpArchiveCategory();
      await interaction.update({
        content: helpArchiveCategoryId
          ? `🔒 **Ticket closed** by ${interaction.user}. Archiving this channel…`
          : `🔒 **Ticket closed** by ${interaction.user}. Closing this channel in a few seconds…`,
        components: [],
      });
      await closeOrArchiveTicket(interaction.channel, helpArchiveCategoryId);
      return;
    }

    // "Cancel"  →  just dismisses the confirmation. Nothing else happens.
    if (interaction.isButton() && interaction.customId === 'cancel_close_help_ticket') {
      await interaction.update({ content: 'Cancelled — the ticket stays open.', components: [] });
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
          content: resolveText('REPLIES.requestExpired'),
          embeds: [],
          components: [],
        });
        return;
      }

      // Acknowledge the button first; channel creation can take a beat.
      await interaction.deferUpdate();

      const conflict = await findTitleConflict(data.name);
      if (conflict) {
        pendingBounties.delete(interaction.user.id);
        await interaction.editReply({
          content: resolveText('REPLIES.requestTitleTaken').replace('%s', conflict.name),
          embeds: [],
          components: [],
        });
        return;
      }

      const embed = buildBountyEmbed({
        ...data,
        user: interaction.user,
        status: 'pending',
      });

      try {
        const { staffRoleId, staffUserId } = await getRequestStaff();
        const categoryId = await getTicketCategory();

        // Record the bounty as 'pending' so it has a DB id for the buttons.
        // Preferred Name is optional — falls back to the requester's current
        // server nickname if they left it blank.
        const donatorName = data.donatorRaw?.trim() || interaction.member.displayName;
        const bountyId = await createBounty({
          name: data.name,
          description: data.description,
          reward: data.amountRaw,
          requesterId: interaction.user.id,
          donatorName,
          groupType: data.groupType,
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
        content: resolveText('REPLIES.requestCancelled'),
        embeds: [],
        components: [],
      });
      return;
    }

    // "Approve" inside a ticket  →  staff only. Opens step 1 of the editable
    // preview; nothing is finalized/shipped to the board until step 2 is
    // submitted (see approve_modal_step1 / approve_modal_step2 below).
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

        const oldTicketArchiveCategoryId = await getRequestArchiveCategory();
        await interaction.followUp({
          content: oldTicketArchiveCategoryId
            ? `✅ **Approved** by ${interaction.user}${boardNote}. Archiving this ticket…`
            : `✅ **Approved** by ${interaction.user}${boardNote}. Closing this ticket in a few seconds…`,
        });
        await closeOrArchiveTicket(interaction.channel, oldTicketArchiveCategoryId);
        return;
      }

      // showModal must be the FIRST response — nothing above this sends one.
      await interaction.showModal(buildApproveModalStep1(bounty));
      return;
    }

    // "Deny" inside a ticket  →  staff only. Logs it, then closes the ticket.
    if (interaction.isButton() && interaction.customId.startsWith('deny_bounty')) {
      if (!(await requireStaff(interaction, getRequestStaff, 'deny bounties'))) return;

      const denyArchiveCategoryId = await getRequestArchiveCategory();
      if (isAlreadyArchived(interaction.channel, denyArchiveCategoryId)) {
        await interaction.reply({ content: '⚠️ This ticket is already archived.', flags: MessageFlags.Ephemeral });
        return;
      }

      const bountyId = customIdArg(interaction);
      if (bountyId) {
        await denyBounty(bountyId, interaction.user.id).catch(console.error);
      }

      await interaction.reply({
        content: denyArchiveCategoryId
          ? `⛔ **Denied** by ${interaction.user}. Archiving this ticket…`
          : `⛔ **Denied** by ${interaction.user}. Closing this ticket in a few seconds…`,
      });
      await closeOrArchiveTicket(interaction.channel, denyArchiveCategoryId);
      return;
    }

    // Modal submitted  →  show the EPHEMERAL preview (no channel yet)
    if (interaction.isModalSubmit() && interaction.customId === 'bounty_modal') {
      const name = interaction.fields.getTextInputValue('bounty_name');
      const description = interaction.fields.getTextInputValue('bounty_description');
      const amountRaw = interaction.fields.getTextInputValue('bounty_amount');
      const donatorRaw = interaction.fields.getTextInputValue('bounty_donator');
      const [groupType] = interaction.fields.getStringSelectValues('bounty_group_type');

      // Stash for the Submit button (that click won't have the form data).
      // createdAt is what the sweeper above uses to drop abandoned previews.
      pendingBounties.set(interaction.user.id, { name, description, amountRaw, donatorRaw, groupType, createdAt: Date.now() });

      const embed = buildBountyEmbed({
        name,
        description,
        amountRaw,
        groupType,
        user: interaction.user,
        status: 'pending',
      });

      await interaction.reply({
        content: resolveText('REPLIES.requestPreview'),
        embeds: [embed],
        components: [previewButtons()],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Step 1 of the approve/edit modal submitted  →  stash the values and
    // hand off to a "Continue" button, since a modal submission can't open
    // another modal directly. Nothing is saved to the DB yet.
    if (interaction.isModalSubmit() && interaction.customId.startsWith('approve_modal_step1')) {
      const bountyId = customIdArg(interaction);

      const donatorRaw = interaction.fields.getTextInputValue('bounty_donator').trim();
      const name = interaction.fields.getTextInputValue('bounty_name');
      const description = interaction.fields.getTextInputValue('bounty_description');

      const bounty = await getBountyById(bountyId);
      if (!bounty) {
        await interaction.reply({
          content: resolveText('REPLIES.bountyMissing'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Left blank — fall back to the requester's current server nickname,
      // same rule as the player-facing request form. Falls further back to
      // whatever was already stored if they've since left the server.
      let donatorName = donatorRaw;
      if (!donatorName) {
        const requesterMember = await interaction.guild.members.fetch(bounty.requester_id).catch(() => null);
        donatorName = requesterMember?.displayName ?? bounty.donator_name ?? null;
      }

      // interaction.message is the ticket message the Approve button lives
      // on — step 2's modal submit won't have that context anymore (it opens
      // from the Continue button below, on a new ephemeral message), so it's
      // captured here and carried through pendingApprovals.
      pendingApprovals.set(bountyId, {
        name,
        description,
        donatorName,
        ticketChannelId: interaction.channelId,
        ticketMessageId: interaction.message.id,
        createdAt: Date.now(),
      });

      await interaction.reply({
        content: 'Name and description saved. Press **Continue** to set the tier, reward type, and reward.',
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`approve_modal_step2:${bountyId}`)
              .setLabel('Continue')
              .setStyle(ButtonStyle.Primary),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // "Continue" button  →  opens step 2. Only reachable from step 1's own
    // ephemeral reply, so no separate staff check — Discord already scopes
    // that message's buttons to the staff member who received it.
    if (interaction.isButton() && interaction.customId.startsWith('approve_modal_step2:')) {
      const bountyId = customIdArg(interaction);

      if (!pendingApprovals.has(bountyId)) {
        await interaction.reply({
          content: '⚠️ This approval session expired — press **Approve** again to restart.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const bounty = await getBountyById(bountyId);
      if (!bounty) {
        pendingApprovals.delete(bountyId);
        await interaction.reply({
          content: resolveText('REPLIES.bountyMissing'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // showModal must be the FIRST response — nothing above this sends one.
      await interaction.showModal(buildApproveModalStep2(bounty));
      return;
    }

    // Step 2 submitted  →  this is what "Approve" actually commits: save
    // everything from both steps, finalize approval, ship it to the board,
    // and close the ticket.
    if (interaction.isModalSubmit() && interaction.customId.startsWith('approve_modal_step2_submit')) {
      const bountyId = customIdArg(interaction);

      const [tier] = interaction.fields.getStringSelectValues('bounty_tier');
      const [prizeType] = interaction.fields.getStringSelectValues('bounty_reward_type');
      const [claimType] = interaction.fields.getStringSelectValues('bounty_claim_type');
      const amountRaw = interaction.fields.getTextInputValue('bounty_amount');

      const step1 = pendingApprovals.get(bountyId);
      if (!step1) {
        await interaction.reply({
          content: '⚠️ This approval session expired — press **Approve** again to restart.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const { name, description, donatorName, ticketChannelId, ticketMessageId } = step1;

      const bounty = await getBountyById(bountyId);
      if (!bounty) {
        pendingApprovals.delete(bountyId);
        await interaction.reply({
          content: resolveText('REPLIES.bountyMissing'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Block approval if this title already belongs to another approved/claimed
      // bounty — staff has to press Approve again from the start with a
      // different name (step 1 collected the name, not this step).
      const conflict = await findTitleConflict(name, bountyId);
      if (conflict) {
        pendingApprovals.delete(bountyId);
        await interaction.reply({
          content: resolveText('REPLIES.approveTitleTaken').replace('%s', conflict.name),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // groupType is re-supplied unchanged — staff don't set that here, it's
      // fixed by the requester at request time.
      await updateBounty(bountyId, { name, description, reward: amountRaw, donatorName, prizeType, tier, groupType: bounty.group_type, claimType });

      // Guarded on 'pending' — the admin site can change a bounty's status
      // too (src/styleGuide/bountyRoutes.js), so if it was denied/cancelled
      // there between this ticket opening and Approve being pressed, don't
      // silently re-approve it over that decision.
      const approvedRow = await setBountyStatus(bountyId, 'approved', interaction.user.id, 'pending');
      if (!approvedRow) {
        pendingApprovals.delete(bountyId);
        const current = await getBountyById(bountyId);
        await interaction.reply({
          content: `⚠️ This bounty is no longer pending — it's **${current?.status ?? 'gone'}** now (changed from the admin site, or by someone else). Nothing was approved.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const requester = await client.users.fetch(bounty.requester_id).catch(() => null);
      const approved = buildBountyEmbed({
        name,
        description,
        amountRaw,
        groupType: bounty.group_type,
        user: requester ?? interaction.user,
        status: 'approved',
      });

      // This modal was opened from the "Continue" button's own ephemeral
      // message, not the ticket message — so unlike the old single-step
      // flow, interaction.update() would edit the wrong message. Fetch and
      // edit the actual ticket message using the id step 1 stashed instead.
      const ticketChannel = await interaction.guild.channels.fetch(ticketChannelId).catch(() => null);
      const ticketMessage = ticketChannel ? await ticketChannel.messages.fetch(ticketMessageId).catch(() => null) : null;
      if (ticketMessage) await ticketMessage.edit({ embeds: [approved], components: [] }).catch(() => null);

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

      pendingApprovals.delete(bountyId);

      const editApproveArchiveCategoryId = await getRequestArchiveCategory();
      await interaction.reply({
        content: editApproveArchiveCategoryId
          ? `✅ **Approved** by ${interaction.user}${boardNote}. Archiving this ticket…`
          : `✅ **Approved** by ${interaction.user}${boardNote}. Closing this ticket in a few seconds…`,
      });
      await closeOrArchiveTicket(interaction.channel, editApproveArchiveCategoryId);
      return;
    }

    // "Claim Bounty" button on the claim board  →  show a dropdown of
    // currently approved bounties to pick from. Discord's select menu already
    // has a built-in type-to-search box once it's open, so this one dropdown
    // is both the list AND the search — no separate typing step needed. Past
    // 25 approved bounties (Discord's hard cap on select menu options),
    // Prev/Next buttons page through the rest (see claim_page below).
    if (interaction.isButton() && interaction.customId === 'claim_bounty') {
      const { rows, total } = await getClaimableBounties(0);

      if (rows.length === 0) {
        await interaction.reply({
          content: resolveText('REPLIES.noClaimableBounties'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        ...buildClaimPickerPayload(rows, total, 0),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Prev/Next on the claim dropdown  →  re-fetch that page and swap the
    // dropdown in place (same ephemeral message, not a new one).
    if (interaction.isButton() && interaction.customId.startsWith('claim_page:')) {
      const offset = parseInt(customIdArg(interaction), 10) || 0;
      const { rows, total } = await getClaimableBounties(offset);

      if (rows.length === 0) {
        await interaction.update({ content: resolveText('REPLIES.noClaimableBounties'), components: [] });
        return;
      }

      await interaction.update(buildClaimPickerPayload(rows, total, offset));
      return;
    }

    // Bounty picked from the claim dropdown  →  pop the proof modal.
    // NOTE: showModal must be the FIRST response to the interaction.
    if (interaction.isStringSelectMenu() && interaction.customId === 'claim_select') {
      const bounty = await getBountyById(interaction.values[0]);

      if (!bounty || bounty.status !== 'approved') {
        await interaction.update({
          content: resolveText('REPLIES.claimBountyUnavailable'),
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
          content: resolveText('REPLIES.claimNoLongerAvailable'),
        });
        return;
      }

      const notes = interaction.fields.getTextInputValue('claim_notes');
      const uploaded = interaction.fields.getUploadedFiles('claim_files', false);
      const files = uploaded ? [...uploaded.values()] : [];

      const embed = buildClaimEmbed({ bounty, claimant: interaction.user, notes, status: 'pending' });

      try {
        const { staffRoleId, staffUserId } = await getClaimStaff();
        // Which of the two active categories this opens in — set by staff on
        // the bounty at approval time (see approve_modal_step2_submit above);
        // defaults to the Claim category for bounties approved before this
        // existed, or if it was somehow left unset.
        const categoryId = bounty.claim_type === 'submissions'
          ? await getSubmissionsTicketCategory()
          : await getClaimTicketCategory();

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

        const readyBanner = new EmbedBuilder().setImage(BANNER_URL);
        await interaction.editReply({ content: `🏁 Your claim is in: ${channel}`, embeds: [readyBanner] });
      } catch (err) {
        await interaction.editReply({ content: ticketCreationError(err, 'deployclaimbounty', 'claim') });
      }
      return;
    }

    // "Include Requester" inside a claim ticket  →  staff only. Grants the
    // original bounty requester access to this private channel too, in case
    // they want to weigh in before it's approved. Safe to click more than
    // once — re-applying the same overwrite is a no-op.
    if (interaction.isButton() && interaction.customId.startsWith('include_requester')) {
      if (!(await requireStaff(interaction, getClaimStaff, 'include the requester'))) return;

      const requesterId = interaction.message.embeds[0]
        ? extractMentionId(interaction.message.embeds[0], resolveText('CARD.claim.fieldOriginalRequester'))
        : null;

      if (!requesterId) {
        await interaction.reply({ content: resolveText('REPLIES.includeRequesterFailed'), flags: MessageFlags.Ephemeral });
        return;
      }

      // Explicit `type: Member` bypasses discord.js's automatic user/role
      // resolution, which requires the target to already be in the client's
      // user cache (the bot only requests the Guilds intent, so a requester
      // who hasn't been fetched recently isn't cached) — without it, this
      // throws DiscordjsTypeError[InvalidType] for any uncached requester.
      await interaction.channel.permissionOverwrites.create(
        requesterId,
        { ViewChannel: true, SendMessages: true, ReadMessageHistory: true },
        { type: OverwriteType.Member },
      );

      await interaction.reply({
        content: `👥 <@${requesterId}> has been added to this ticket by ${interaction.user}.`,
      });
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
          content: resolveText('REPLIES.claimFinalizeFailed'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(COLORS.approved)
        .setTitle(`${resolveText('CARD.claimedTitlePrefix')} ${updated.name}`);
      await interaction.update({ embeds: [approvedEmbed], components: [] });

      const notes = [];

      // The request board only shows bounties still available to claim — once
      // one's claimed, its post there is removed entirely (the claim board
      // below is the log of what's been claimed, not this one).
      if (updated.board_channel_id && updated.board_message_id) {
        const boardChannel = await interaction.guild.channels.fetch(updated.board_channel_id).catch(() => null);
        const boardMsg = boardChannel
          ? await boardChannel.messages.fetch(updated.board_message_id).catch(() => null)
          : null;
        if (boardMsg) {
          await boardMsg.delete().catch(console.error);
          notes.push('removed from the board');
        }
      }

      const claimBoardChannelId = await getClaimBoardChannel();
      if (claimBoardChannelId) {
        const claimBoard = await interaction.guild.channels.fetch(claimBoardChannelId).catch(() => null);
        if (claimBoard) {
          // Same card, minus "Original Requester" — the archived ticket (staff
          // only) keeps it for context, but the claim board is public.
          const publicEmbed = EmbedBuilder.from(approvedEmbed).setFields(
            approvedEmbed.data.fields.filter((f) => f.name !== resolveText('CARD.claim.fieldOriginalRequester')),
          );
          await claimBoard.send({ embeds: [publicEmbed] }).catch(console.error);
          notes.push(`posted to ${claimBoard}`);
        }
      }

      // Move the resolved ticket out of general view instead of deleting it —
      // lockPermissions adopts the archive category's own overwrites, so it
      // drops out of everyone's sight except whoever that category is scoped
      // to. Renamed to reflect it's done, then that category gets
      // re-alphabetized so it stays easy to scan by name.
      const archiveCategoryId = await getClaimArchiveCategory();
      if (archiveCategoryId) {
        await interaction.channel.setParent(archiveCategoryId, { lockPermissions: true }).catch(console.error);
        await interaction.channel.setName(toChannelName('declared', updated.name)).catch(console.error);
        await alphabetizeCategory(interaction.channel.parent);
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

      const claimDenyArchiveCategoryId = await getClaimArchiveCategory();
      if (isAlreadyArchived(interaction.channel, claimDenyArchiveCategoryId)) {
        await interaction.reply({ content: '⚠️ This ticket is already archived.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({
        content: claimDenyArchiveCategoryId
          ? `⛔ **Claim denied** by ${interaction.user}. Archiving this ticket…`
          : `⛔ **Claim denied** by ${interaction.user}. Closing this ticket in a few seconds…`,
      });
      await closeOrArchiveTicket(interaction.channel, claimDenyArchiveCategoryId);
      return;
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: resolveText('REPLIES.genericError'), flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
});

// A bad/missing token rejects here. Without a catch that's an unhandled
// rejection (i.e. process death with a stack trace and no explanation), so
// say plainly what's wrong instead — the admin site stays up either way.
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('Discord login failed — check DISCORD_TOKEN. The bot will not respond until this is fixed:', err.message);
});