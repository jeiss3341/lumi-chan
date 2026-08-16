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
const {
  buildBountyModal,
  buildApproveModalStep1,
  buildApproveModalStep2,
  buildSubmissionValueModal,
  buildClaimProofModal,
  buildTicketDetailsModal,
} = require('./src/modal');
const { buildBountyEmbed, buildClaimEmbed, buildLeaderboardEmbed, formatAmount } = require('./src/bountyCard');
const { buildBountiesWorkbook } = require('./src/bountyExport');
const {
  createTicket,
  createClaimTicket,
  createHelpTicket,
  toChannelName,
  alphabetizeCategory,
  previewButtons,
  addPremadeSelectRow,
  helpTicketCloseConfirm,
  claimReviewButtons,
} = require('./src/ticket');
const { startServer } = require('./src/styleGuide/server');
const { startCoastalClashTimers } = require('./src/coastalClash/timer');
const { loadOverrides } = require('./src/styleGuide/overrides');
const { resolveText, applyEmoji } = require('./src/styleGuide/liveText');
const TEXT = require('./src/text');
const { COLORS, BANNER_URL } = TEXT.VISUALS;

// Guilds + GuildMessages. Still no Message Content intent (privileged — risky
// to turn on for a bot mid-event, since Discord rejects the whole connection
// if it's requested but not enabled in the Developer Portal) — not needed:
// Discord exempts messages that @mention the bot from the content-sanitizing
// that intent normally guards against, which is exactly the only case the
// hello/beep/boop reply below needs to read. Everything else a real user
// sends is still blanked out. The admin Tickets page's chat log
// (src/styleGuide/ticketRoutes.js) can therefore only show full content for
// the bot's OWN messages (embeds, prompts) and any message that mentioned
// the bot — a real user's other replies show up as an empty row (name/
// avatar/timestamp, no text). Accepted as-is rather than risk the bot going
// down.
//
// The message sweeper matters more than it looks: discord.js's DEFAULT
// sweeper config only ever sweeps threads, never messages — so every
// message stays cached for the life of the process. The admin Tickets page
// (src/styleGuide/ticketRoutes.js) fetches up to 100 messages each time an
// admin opens a ticket, and without this those would accumulate until the
// next deploy. 30min lifetime, swept every 10min; nothing here needs an
// old message to still be in cache (the page always re-fetches).
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
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
  pool,
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
  setSubmissionsBoardChannel,
  getSubmissionsBoardChannel,
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
  setBountyPending,
  getBounties,
  getClaimableBounties,
  setBoardMessage,
  claimBounty,
  setSubmissionMetric,
  setBountyExpiry,
  getExpiredBounties,
  setBountyExpired,
  setLeader,
  getUnfinalizedSubmissionBounties,
  markSubmissionsFinalized,
  setSubmissionsBoardMessage,
  getLeaderboardChannel,
  setLeaderboardChannel,
  getLeaderboardMessageId,
  setLeaderboardMessageId,
  getLiveNowChannel,
  setLiveNowChannel,
  getLiveNowMessageId,
  setLiveNowMessageId,
  getLiveAnnounceChannel,
  setLiveAnnounceChannel,
} = require('./src/db');
const { buildLeaderboardEmbeds, postOrUpdateLeaderboard, buildLiveNowEmbed, postLiveAnnouncements } = require('./src/coastalClash/embed');
const { ETERNAL_RETURN_GAME_ID } = require('./src/coastalClash/twitchApi');
const { runDailyCull } = require('./src/coastalClash/cull');
const { dateForSimulatedDay, getEventDay, cullMomentForDay } = require('./src/coastalClash/schedule');
const db = require('./src/db');

// The ONLY guild /daychange is allowed to run in, regardless of which
// guilds the command itself ends up registered to. This is a real cull
// trigger (writes culled/indanger, same as the live 11:59 PM PDT timer) —
// it must never be runnable against the production 74 players.
const COASTAL_CLASH_TEST_GUILD_ID = '1535008850074276120';

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
// modal cap means the up-to-8 approve fields (preferred name, name,
// description, tier, claim type, reward, reward type, and — for a
// Submissions bounty — its leaderboard setup) can't fit in one modal, so
// step 1's values sit here until step 2 is submitted. Keyed by bounty id,
// not user id, since that's what's already threaded through every customId
// in this flow.
const pendingApprovals = new Map();

// Same idea again, for a numeric-metric submissions claim: Approve Claim
// opens a modal to collect the value, and that modal submit is a fresh
// interaction with no .message of its own — so which ticket/claimant it's
// for has to be stashed here first. Keyed by bounty id, same as above.
const pendingSubmissionValues = new Map();

// unref() so this timer never by itself keeps the process alive.
setInterval(() => {
  const cutoff = Date.now() - PENDING_BOUNTY_TTL_MS;
  for (const [userId, data] of pendingBounties) {
    if (data.createdAt < cutoff) pendingBounties.delete(userId);
  }
  for (const [bountyId, data] of pendingApprovals) {
    if (data.createdAt < cutoff) pendingApprovals.delete(bountyId);
  }
  for (const [bountyId, data] of pendingSubmissionValues) {
    if (data.createdAt < cutoff) pendingSubmissionValues.delete(bountyId);
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
    startCoastalClashTimers(c);
    startExpirySweep(c);
  } catch (err) {
    console.error('Database init failed — the bot is up, but DB-backed features will error until it recovers:', err);
  }

  c.user.setPresence({
    activities: [{ name: 'boop', type: 4 }],
  });
});

// Application emoji (Developer Portal → Emojis), not a guild emoji — usable
// in message content across every server the bot is in, no fetch/cache
// lookup or GuildEmojisAndStickers intent needed, just the raw tag.
const LUMI_HELLO_EMOJI = '<:LumiHello:1536577693208940594>';

// "any form of hello" — collapse repeated letters (heyyy/hiii/hellooo all
// collapse to hey/hi/helo) so casual and meme spellings match the same base
// word without listing every stretched-out variant by hand. Every one of
// these still falls under the one "Hello!" reply — they're spellings of the
// same greeting, not separate responses.
function stretchy(word) {
  return word
    .replace(/(.)\1+/g, '$1')
    .split('')
    .map((c) => `${c}+`)
    .join('');
}
const HELLO_WORDS = [
  'hello', 'hallo', 'hollo', 'hullo', 'henlo', 'hewwo', 'hola',
  'hi', 'hiya', 'hai', 'hey', 'heya', 'heyo', 'ello',
  'yo', 'yoohoo', 'sup', 'wassup', 'whatsup',
  'howdy', 'greetings', 'salutations', 'ahoy', 'oi',
];
const GREETING_RE = new RegExp(`\\b(?:${HELLO_WORDS.map(stretchy).join('|')})\\b`, 'i');
const BEEP_RE = new RegExp(`\\b${stretchy('beep')}\\b`, 'i');
const BOOP_RE = new RegExp(`\\b${stretchy('boop')}\\b`, 'i');

// "thank" alone (stretchy) covers "thank you"/"thank u", but not "thanks" —
// stretchy collapses repeats, it doesn't add an optional trailing letter, so
// "thanks" needs its own entry alongside the squished "thankyou" and slang.
const THANKS_WORDS = ['thank', 'thanks', 'thankyou', 'thx', 'thnx', 'ty', 'tysm'];
const THANKS_RE = new RegExp(`\\b(?:${THANKS_WORDS.map(stretchy).join('|')})\\b`, 'i');

function stretchyPhrase(words) {
  return words.map(stretchy).join('\\s+');
}
const GOOD_JOB_PHRASES = [
  ['good', 'job'], ['nice', 'job'], ['great', 'job'], ['awesome', 'job'], ['amazing', 'job'],
  ['good', 'work'], ['nice', 'work'], ['great', 'work'], ['well', 'done'],
];
const GOOD_JOB_RE = new RegExp(
  `\\b(?:${GOOD_JOB_PHRASES.map(stretchyPhrase).join('|')}|${stretchy('gj')})\\b`,
  'i',
);

// Manually deleting a Coastal Clash board message means "stop posting
// this here" — without this, the next refresh cycle would just see the
// stored message id fail to fetch and silently post a brand new one
// (postOrUpdateBracketMessage / postOrUpdateLiveNow's fallback), making
// the board impossible to actually get rid of. message.id is always
// present even on a partial (uncached) delete event, so no fetch needed.
client.on(Events.MessageDelete, async (message) => {
  const [proMessageId, casualMessageId, liveNowMessageId] = await Promise.all([
    getLeaderboardMessageId('pro'),
    getLeaderboardMessageId('casual'),
    getLiveNowMessageId(),
  ]);
  if (message.id === proMessageId) await db.clearLeaderboardDeployment('pro');
  else if (message.id === casualMessageId) await db.clearLeaderboardDeployment('casual');
  else if (message.id === liveNowMessageId) await db.clearLiveNowDeployment();
});

// Lumi's two favorites — greeting and boop — always get the emoji. Everything
// else (beep, thank-yous, good-jobs) is just the plain word back, no emoji.
client.on(Events.MessageCreate, async (message) => {
  if (process.env.ACTIVE_GUILD_ID && message.guildId !== process.env.ACTIVE_GUILD_ID) return;
  if (!message.guildId) return;
  if (message.author.bot) return;
  if (!message.mentions.users.has(client.user.id)) return;

  const said = message.content.replace(/<@!?\d+>/g, '').trim();
  let reply = null;
  let withEmoji = false;
  if (GREETING_RE.test(said)) {
    reply = Math.random() < 0.5 ? 'Hi!' : 'Hello!';
    withEmoji = true;
  } else if (BOOP_RE.test(said)) {
    reply = 'Boop!';
    withEmoji = true;
  } else if (BEEP_RE.test(said)) {
    reply = 'Boop!';
  } else if (THANKS_RE.test(said)) {
    reply = "You're welcome!";
  } else if (GOOD_JOB_RE.test(said)) {
    reply = 'Thank you!';
  }
  if (!reply) return;

  // A plain @mention message, not a Discord "reply" (no reference banner
  // pointing back at the original message).
  await message.channel.send(`${reply} ${message.author}`).catch(() => {});

  // The emoji as its own follow-up message, not tacked onto the greeting.
  if (withEmoji) await message.channel.send(LUMI_HELLO_EMOJI).catch(() => {});
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
// `newName`, if given, replaces the default "closed-<old name>" — used by
// deny_claim below to build a clean "denied-claim-<bounty>" /
// "submission-lost-<bounty>" name from the bounty's own data instead of
// stacking onto the ticket's existing "claim-<bounty>-<claimant>" name.
// Returns true if the channel actually ended up archived (or, with no
// archive category configured, scheduled to close) — false if the move
// itself failed. Callers must check this and tell staff plainly when it's
// false, rather than claiming "archiving…" regardless — the previous
// silent .catch(console.error) meant a stale/misconfigured
// archiveCategoryId (e.g. one belonging to a different guild than this
// channel — Discord can't move a channel across guilds, and won't say why)
// failed with nobody finding out except a server log nobody's watching.
// The channel itself is never lost either way — a failed move just leaves
// it exactly where it was.
async function closeOrArchiveTicket(channel, archiveCategoryId, newName) {
  if (archiveCategoryId) {
    try {
      await channel.setParent(archiveCategoryId, { lockPermissions: true });
    } catch (err) {
      console.error('Failed to move ticket into its archive category:', err);
      return false;
    }
    await channel.setName(newName ?? toChannelName('closed', channel.name)).catch(console.error);
    await alphabetizeCategory(channel.parent).catch(console.error);
    return true;
  }
  closeChannelSoon(channel);
  return true;
}

// Shared tail of the approve flow, called once at the end of step 2 (both
// 'claim' and 'submissions' bounties reach it the same way — step 2 already
// collected everything, leaderboard setup included, see
// buildApproveModalStep2) — edits the request ticket to its final approved
// state (content + strips Approve/Deny), posts the approved card to
// `boardGetter`'s channel, and archives the ticket. 'submissions'-type
// bounties point this at the submissions board instead of the regular one.
async function finalizeApproval({ interaction, bountyId, approved, boardGetter, boardComponents, ticketChannelId, ticketMessageId, newTicketName }) {
  // Deferred immediately — everything below is several sequential Discord
  // API calls (comfortably past the 3-second ack window), and the final
  // message needs to report whether archiving actually succeeded, not just
  // promise that it will (see closeOrArchiveTicket).
  await interaction.deferReply();

  const ticketChannel = await interaction.guild.channels.fetch(ticketChannelId).catch(() => null);
  const ticketMessage = ticketChannel ? await ticketChannel.messages.fetch(ticketMessageId).catch(() => null) : null;
  if (ticketMessage) await ticketMessage.edit({ embeds: [approved], components: [] }).catch(() => null);

  let boardNote = '';
  const boardChannelId = await boardGetter();
  if (boardChannelId) {
    const board = await interaction.guild.channels.fetch(boardChannelId).catch(() => null);
    if (board) {
      const boardMsg = await board.send({ embeds: [approved], components: boardComponents ?? [] });
      await setBoardMessage(bountyId, board.id, boardMsg.id).catch(console.error);
      boardNote = ` and posted to ${board}`;
    }
  }

  const editApproveArchiveCategoryId = await getRequestArchiveCategory();
  const archived = await closeOrArchiveTicket(interaction.channel, editApproveArchiveCategoryId, newTicketName);
  const archiveNote = !editApproveArchiveCategoryId
    ? ' Closing this ticket in a few seconds…'
    : archived
      ? ' Archiving this ticket…'
      : ' ⚠️ Could not move this ticket into its archive category — check it\'s still configured correctly (`/deployrequestbounty`). Nothing was lost, it just stayed here.';

  await interaction.editReply({ content: `✅ **Approved** by ${interaction.user}${boardNote}.${archiveNote}` });
}

// Shared commit path for finishing an approval — extracted so both the
// common case (step 2 submitted with Bounty Expires = No, finalizes
// immediately) and the expiring case (step 2 = Yes, finalizes only after
// staff picks a day on buildExpiryDayPicker below) go through the exact
// same guards (bounty missing, title conflict, status race) and the same
// revert-to-pending safety net on failure — see the two call sites for how
// each path assembles its params.
async function commitBountyApproval({ interaction, bountyId, name, description, donatorName, prizeType, amountRaw, tier, claimType, ticketChannelId, ticketMessageId, submissionMetric, expiresAt }) {
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
  if (submissionMetric) await setSubmissionMetric(bountyId, submissionMetric);
  if (expiresAt) await setBountyExpiry(bountyId, expiresAt);

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

  // Everything past this point (posting to a board, archiving the
  // ticket) is real Discord API calls that can fail for reasons outside
  // our control (a missing permission, a deleted channel) — if any of it
  // throws, the bounty shouldn't be left stuck 'approved' with no board
  // post and no way to tell staff tried and failed. Revert to 'pending'
  // and say so plainly, rather than the old silent half-finished state.
  try {
    const requester = await client.users.fetch(bounty.requester_id).catch(() => null);
    const approved = buildBountyEmbed({
      name,
      description,
      amountRaw,
      groupType: bounty.group_type,
      user: requester ?? interaction.user,
      status: 'approved',
      expiresAt,
    });

    // Same request-board post for both claim types — no buttons, never
    // edited again. A submissions bounty's live #submissions leaderboard
    // card doesn't exist yet at approval time; it's created later, on
    // the first claim (see promoteSubmissionLeader).
    await finalizeApproval({
      interaction,
      bountyId,
      approved,
      boardGetter: getBoardChannel,
      ticketChannelId,
      ticketMessageId,
      newTicketName: toChannelName('closed-approved', name),
    });
  } catch (err) {
    console.error('Approval failed partway through — reverting to pending:', err);
    await setBountyPending(bountyId, interaction.user.id).catch(console.error);
    const revertReply = {
      content: "⚠️ Something went wrong finishing this approval — reverted back to **pending** so it isn't stuck. Press **Approve** again to retry.",
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.replied || interaction.deferred) await interaction.followUp(revertReply).catch(() => {});
    else await interaction.reply(revertReply).catch(() => {});
  }
  pendingApprovals.delete(bountyId);
}

// Button grid for the expiry day-picker, shown after step 2 when staff
// picks "Yes" on Bounty Expires. Only ever needs to cover the event's own
// window (today's event day through Day 17 — see schedule.js), which tops
// out at 15 buttons, comfortably under Discord's 25-per-message cap — so
// unlike a general-purpose calendar bot, this never needs month navigation
// or pagination.
function buildExpiryDayPicker(bountyId) {
  const todayDay = Math.max(getEventDay(new Date()), 1);
  const days = [];
  for (let day = todayDay; day <= 17; day++) days.push(day);

  const rows = [];
  for (let i = 0; i < days.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      days.slice(i, i + 5).map((day) => new ButtonBuilder()
        .setCustomId(`expiry_day_pick:${bountyId}:${day}`)
        .setLabel(dateForSimulatedDay(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }))
        .setStyle(ButtonStyle.Secondary)),
    ));
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Pick an expiry day')
    .setDescription('Bounty expires at 11:59:59 PM PST on the day you pick — same moment as daily culling.');

  return { embeds: [embed], components: rows };
}

// /endsubmissions' two-step confirmation — this is a bulk, public,
// can't-undo-from-here action across every pending submission bounty at
// once, so per staff it gets an extra step beyond a normal single "are you
// sure": this first "are you sure", then a second, more explicit "really
// sure" before anything actually posts.
function endSubmissionsConfirmRow1() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('endsubmissions_confirm1').setLabel('Yes, Continue').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('endsubmissions_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
}

function endSubmissionsConfirmRow2() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('endsubmissions_confirm2').setLabel('Yes, End Submissions').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('endsubmissions_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
}

// Extracts the raw Discord ids listed in an embed's Teammates field (added
// by Add Premade — see add_premade_select below), or [] if there isn't one.
// Field values store mentions as literal "<@id>, <@id>" text, so this is
// just pulling the digit runs back out. Shared by add_premade_select
// (accumulating across repeated presses) and promoteSubmissionLeader
// (reading it once, at promotion, to persist onto the bounty row).
function getTeammateIdsFromEmbed(embed) {
  const field = embed?.fields?.find((f) => f.name === resolveText('CARD.claim.fieldTeammates'));
  return field ? field.value.match(/\d+/g) ?? [] : [];
}

// approve_claim's submissions-type branch, shared by both paths that reach
// it: straight from the button for a text-metric bounty (nothing to
// collect), or from submission_value_modal_submit below for a numeric one
// (value collected first). Promotes `claimantId` to current leader —
// updates the DB, archives whoever it just displaced (if anyone) as
// 'submission-lost', archives THIS ticket as 'submission-won', and edits
// the live submissions-board post. `ticketChannelId`/`ticketMessageId`
// identify this claim ticket explicitly rather than relying on
// interaction.channel/.message, since the numeric path arrives here from a
// modal submit — a fresh interaction with neither.
async function promoteSubmissionLeader({ interaction, bounty, claimantId, value, ticketChannelId, ticketMessageId }) {
  // Fetched up front (before setLeader) so any Teammates field Add Premade
  // already put on this ticket's own embed can be read and persisted onto
  // the bounty row — that field only ever lived on this one Discord
  // message until now, so the live board post and the eventual closed card
  // (/endsubmissions) had no way to know about it otherwise. Reused below
  // instead of re-fetching.
  const ticketChannel = await interaction.guild.channels.fetch(ticketChannelId).catch(() => null);
  const ticketMessage = ticketChannel ? await ticketChannel.messages.fetch(ticketMessageId).catch(() => null) : null;
  const teammates = getTeammateIdsFromEmbed(ticketMessage?.embeds[0]);

  const updated = await setLeader(bounty.id, { leaderId: claimantId, value, ticketChannelId, ticketMessageId, teammates });

  if (!updated) {
    await interaction.reply({ content: resolveText('REPLIES.claimFinalizeFailed'), flags: MessageFlags.Ephemeral });
    return;
  }

  // Everything below is several sequential Discord API calls (archiving up
  // to two tickets, editing the board post) — comfortably past Discord's
  // 3-second ack window, so acknowledge now and fill in the real result
  // with editReply once it's done (same pattern claim_proof_modal already
  // uses for its own multi-step ticket creation).
  await interaction.deferReply();

  const notes = [];

  // Displaced the previous leader (if any, and if it's actually someone
  // else) — archived straight to 'submission-lost', not reopened for
  // another look. Reopening used to be the behavior here, but it was
  // fragile: several failure branches (a missing category, a failed
  // channel/message fetch, a thrown setParent) could leave that ticket
  // permanently stuck renamed 'submission-won' with nothing ever revisiting
  // it, since only the immediately-previous leader is tracked at all
  // (src/db.js setLeader only stores one leader_id at a time) — that's how
  // you'd end up with several stale 'submission-won-<bounty>' channels for
  // one bounty. Archiving immediately, the same way deny_claim already
  // does for a denied submission, means the fixed 'submission-won' name is
  // only ever applied once, to whoever's still leading when the bounty
  // actually closes.
  if (updated.previous_leader_id && updated.previous_leader_id !== claimantId && updated.previous_leader_ticket_channel_id) {
    const oldChannel = await interaction.guild.channels.fetch(updated.previous_leader_ticket_channel_id).catch(() => null);
    const oldMessage = oldChannel && updated.previous_leader_ticket_message_id
      ? await oldChannel.messages.fetch(updated.previous_leader_ticket_message_id).catch(() => null)
      : null;

    if (oldChannel) {
      const lostEmbed = oldMessage?.embeds[0] ? EmbedBuilder.from(oldMessage.embeds[0]).setColor(COLORS.denied) : null;
      if (oldMessage && lostEmbed) await oldMessage.edit({ embeds: [lostEmbed], components: [] }).catch(() => null);

      await oldChannel
        .send({ content: resolveText('TICKET.submissionSurpassedNote').replace('%s', `<@${claimantId}>`) })
        .catch(console.error);

      const lostArchiveCategoryId = await getClaimArchiveCategory();
      const lostArchived = await closeOrArchiveTicket(oldChannel, lostArchiveCategoryId, toChannelName('submission-lost', bounty.name));
      const lostNote = !lostArchiveCategoryId
        ? ' (closing soon, no archive category configured)'
        : lostArchived
          ? ' (archived)'
          : ' (⚠️ could not be archived — check the archive category is still configured correctly)';
      notes.push(`<@${updated.previous_leader_id}>'s submission is no longer leading${lostNote}`);
    }
  }

  // Archive this (now-leading) ticket — 'submission-won' since, as of right
  // now, this is the submission that's currently winning (same category
  // move approve_claim uses for a regular claim, just its own naming).
  // ticketChannel/ticketMessage were already fetched above, before setLeader.
  if (ticketMessage) {
    const approvedEmbed = EmbedBuilder.from(ticketMessage.embeds[0])
      .setColor(COLORS.approved)
      .setTitle(`${resolveText('CARD.claimedTitlePrefix')} ${bounty.name}`);
    await ticketMessage.edit({ embeds: [approvedEmbed], components: [] }).catch(() => null);
  }

  const archiveCategoryId = await getClaimArchiveCategory();
  if (ticketChannel && archiveCategoryId) {
    try {
      await ticketChannel.setParent(archiveCategoryId, { lockPermissions: true });
      await ticketChannel.setName(toChannelName('submission-won', bounty.name)).catch(console.error);
      await alphabetizeCategory(ticketChannel.parent).catch(console.error);
      notes.push('archived');
    } catch (err) {
      console.error('Failed to archive promoted submission ticket:', err);
      notes.push('⚠️ could not be archived — check the archive category is still configured correctly');
    }
  }

  // The live submissions-board post — created fresh on the first-ever
  // leader (nothing sits in the submissions channel for a bounty nobody's
  // submitted to yet, see finalizeApproval's call site), edited in place on
  // every leader change after that. !updated.previous_leader_id is the same
  // "is this the first promotion" signal already used above for the
  // displaced-leader check — leader_id starts null and setLeader's CTE
  // snapshots the pre-update value, so it's null exactly once, on the very
  // first promotion.
  const leaderMember = await interaction.guild.members.fetch(updated.leader_id).catch(() => null);
  const leaderboardEmbed = buildLeaderboardEmbed(updated, { leaderAvatarURL: leaderMember?.displayAvatarURL() });

  if (!updated.previous_leader_id) {
    const submissionsBoardChannelId = await getSubmissionsBoardChannel();
    const submissionsBoard = submissionsBoardChannelId
      ? await interaction.guild.channels.fetch(submissionsBoardChannelId).catch(() => null)
      : null;
    if (submissionsBoard) {
      // No Close Bounty button — /endsubmissions is now the only way to
      // close a submissions bounty, individually or in bulk.
      const boardMsg = await submissionsBoard.send({ embeds: [leaderboardEmbed] });
      await setSubmissionsBoardMessage(bounty.id, submissionsBoard.id, boardMsg.id);
      notes.push(`posted to ${submissionsBoard}`);
    } else {
      notes.push('⚠️ no submissions board channel configured — check `/deployclaimbounty`');
    }
  } else if (updated.submissions_board_channel_id && updated.submissions_board_message_id) {
    const boardChannel = await interaction.guild.channels.fetch(updated.submissions_board_channel_id).catch(() => null);
    const boardMsg = boardChannel ? await boardChannel.messages.fetch(updated.submissions_board_message_id).catch(() => null) : null;
    if (boardMsg) {
      await boardMsg.edit({ embeds: [leaderboardEmbed] }).catch(console.error);
      notes.push(`${boardChannel} updated`);
    }
  }

  const boardNote = notes.length ? ` (${notes.join(', ')})` : '';
  await interaction.editReply({ content: `🏆 **Now leading** by ${interaction.user}${boardNote}.` });
}

// Any OTHER still-open submission tickets for this bounty — every one that
// was never approved (which would've archived it 'submission-won'/
// 'submission-lost' already, see promoteSubmissionLeader) or denied. Found
// by channel topic, not a DB column — createClaimTicket sets a claim
// ticket's topic to the bounty's own name (same trick byClaimTitleThenAge
// uses, src/ticket.js), and nothing else tracks "every ticket ever opened
// for bounty X." Called when /endsubmissions finalizes a bounty, so
// nothing's left behind with live Approve/Deny buttons
// pointing at a bounty that's no longer 'approved' — pressing them would
// otherwise just silently fail (setLeader's own status guard) with a
// generic error instead of a clear "this bounty is already closed."
async function archiveDanglingSubmissionTickets(guild, bounty, exceptChannelId) {
  const submissionsCategoryId = await getSubmissionsTicketCategory();
  const category = submissionsCategoryId ? await guild.channels.fetch(submissionsCategoryId).catch(() => null) : null;
  if (!category) return [];

  const dangling = [...category.children.cache.values()].filter(
    (ch) => ch.topic === bounty.name && ch.id !== exceptChannelId,
  );

  const archiveCategoryId = await getClaimArchiveCategory();
  const results = [];
  for (const channel of dangling) {
    // The ticket card is always the first bot message in a fresh channel
    // (createClaimTicket) — a small recent-message search finds it without
    // assuming nothing else was ever posted after it.
    const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    const cardMessage = recent?.find((m) => m.author.id === client.user.id && m.embeds.length > 0);
    if (cardMessage?.embeds[0]) {
      const lostEmbed = EmbedBuilder.from(cardMessage.embeds[0]).setColor(COLORS.denied);
      await cardMessage.edit({ embeds: [lostEmbed], components: [] }).catch(() => null);
    }
    const archived = await closeOrArchiveTicket(channel, archiveCategoryId, toChannelName('submission-lost', bounty.name));
    results.push({ channel, archived });
  }
  return results;
}

// Called by /endsubmissions for each still-open bounty it processes:
// declares the current leader the winner in the DB and cleans up every
// ticket for this bounty (the winner's — already archived at promotion
// time — plus any other still-open submissions, see
// archiveDanglingSubmissionTickets). Deliberately does NOT touch the public
// board post or #claimed — that's the separate, explicit
// announceSubmissionBountyPublicly step below, kept apart so a bounty
// left half-finished by a previous failed /endsubmissions run
// (status='claimed' but submissions_finalized still false — see
// getUnfinalizedSubmissionBounties) doesn't get closed a second time on
// retry, just re-announced.
async function finalizeSubmissionBountyPrivately(guild, bounty) {
  const updated = await claimBounty(bounty.id, bounty.leader_id);
  if (!updated) return null;
  await archiveDanglingSubmissionTickets(guild, updated, updated.leader_ticket_channel_id);
  return updated;
}

// The public half — posts the closed leaderboard card to #claimed and
// removes the live post from #submissions (rather than editing it in place
// to say "closed"; per staff, a resolved bounty shouldn't linger visually
// on the ongoing-submissions channel once #claimed has the permanent
// record) — then marks submissions_finalized so /endsubmissions never
// re-announces it. Safe to call on a bounty finalized moments ago in the
// same /endsubmissions run, or one that's been sitting closed for days
// from a previous run — same either way.
async function announceSubmissionBountyPublicly(guild, bounty) {
  const leaderMember = await guild.members.fetch(bounty.leader_id).catch(() => null);
  const closedEmbed = buildLeaderboardEmbed(bounty, { closed: true, leaderAvatarURL: leaderMember?.displayAvatarURL() });

  // The live #submissions post, not the permanent #approved record —
  // board_channel_id/board_message_id is never touched here, same as it's
  // never touched for a claim-type bounty either.
  if (bounty.submissions_board_channel_id && bounty.submissions_board_message_id) {
    const boardChannel = await guild.channels.fetch(bounty.submissions_board_channel_id).catch(() => null);
    const boardMsg = boardChannel ? await boardChannel.messages.fetch(bounty.submissions_board_message_id).catch(() => null) : null;
    await boardMsg?.delete().catch(() => null);
  }

  let claimBoardChannel = null;
  const claimBoardChannelId = await getClaimBoardChannel();
  if (claimBoardChannelId) {
    claimBoardChannel = await guild.channels.fetch(claimBoardChannelId).catch(() => null);
    if (claimBoardChannel) await claimBoardChannel.send({ embeds: [closedEmbed] }).catch(() => null);
  }

  await markSubmissionsFinalized(bounty.id);
  return { claimBoardChannel };
}

// Pulls an expired bounty's board post(s) — same shape as the admin site's
// removeBoardPost (src/styleGuide/bountyRoutes.js), duplicated rather than
// imported since that module is scoped to the admin HTTP routes, not the
// bot's own runtime. Used only by sweepExpiredBounties below.
async function removeExpiredBoardPost(client, bounty) {
  if (bounty.claim_type === 'submissions' && bounty.submissions_board_channel_id && bounty.submissions_board_message_id) {
    const subChannel = await client.channels.fetch(bounty.submissions_board_channel_id).catch(() => null);
    const subMsg = subChannel ? await subChannel.messages.fetch(bounty.submissions_board_message_id).catch(() => null) : null;
    if (subMsg) await subMsg.delete().catch(() => null);
  }

  if (!bounty.board_channel_id || !bounty.board_message_id) return;
  const channel = await client.channels.fetch(bounty.board_channel_id).catch(() => null);
  const msg = channel ? await channel.messages.fetch(bounty.board_message_id).catch(() => null) : null;
  if (msg) await msg.delete().catch(() => null);
}

// Runs every EXPIRY_SWEEP_INTERVAL_MINUTES (see startExpirySweep below) —
// finds every 'approved' bounty whose expires_at has passed and resolves
// it:
// - A submissions bounty that already has a leader is finalized exactly
//   like /endsubmissions treats one (declares the current leader the
//   winner) — reuses the same two functions that command calls per-bounty,
//   so an auto-expired submissions bounty behaves identically to one a
//   staff member closes by hand.
// - Everything else (claim-type, or a submissions bounty nobody ever
//   submitted to — nothing to declare a winner over) is just marked
//   'expired' and pulled off the board, same as a denied/cancelled bounty.
// Single-guild bot, same assumption the rest of this file already makes
// (client.guilds.cache.first()).
async function sweepExpiredBounties(client) {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const expired = await getExpiredBounties().catch((err) => {
    console.error('Expiry sweep: failed to query expired bounties:', err);
    return [];
  });

  for (const bounty of expired) {
    try {
      if (bounty.claim_type === 'submissions' && bounty.leader_id) {
        const closed = await finalizeSubmissionBountyPrivately(guild, bounty);
        if (closed) await announceSubmissionBountyPublicly(guild, closed);
        continue;
      }

      // Guarded on 'approved' (see setBountyExpired) — if a claim snuck in
      // between the sweep's SELECT and this UPDATE, this returns null and
      // the bounty is left exactly as that claim just made it, untouched.
      const updated = await setBountyExpired(bounty.id);
      if (!updated) continue;
      await removeExpiredBoardPost(client, updated);
    } catch (err) {
      console.error(`Expiry sweep: failed to resolve bounty #${bounty.id}:`, err);
    }
  }
}

// 5 min — bounty expiry lands on a fixed moment (11:59:59 PM PDT, same as
// daily culling, see schedule.js), not something staff are watching in
// real time, so this just needs to reliably catch it within a few minutes
// of actually passing, not fire fast.
const EXPIRY_SWEEP_INTERVAL_MINUTES = 5;

function startExpirySweep(client) {
  setInterval(() => {
    sweepExpiredBounties(client).catch((err) => console.error('Expiry sweep failed:', err));
  }, EXPIRY_SWEEP_INTERVAL_MINUTES * 60 * 1000);
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
async function sendBountyExport(interaction, status, order, groupByStatus, claimTypeFilter) {
  const filtered = (await getBounties(status)).filter((b) => !claimTypeFilter || (b.claim_type || 'claim') === claimTypeFilter);
  const rows = orderBounties(filtered, order, groupByStatus);
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

  const formatDate = (d) =>
    d ? new Date(d).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'America/New_York' }) : '';

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
  // Scopes this process to a single guild when ACTIVE_GUILD_ID is set. This
  // bot's token can end up connected more than once at a time (this Railway
  // deployment, plus a local dev run against a test server) — without this,
  // both instances receive and act on every interaction in every guild the
  // bot is in, doubling every panel post/ticket/reply. Unset (the default)
  // means no filtering, same as before this existed.
  if (process.env.ACTIVE_GUILD_ID && interaction.guildId !== process.env.ACTIVE_GUILD_ID) return;

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
      const claimTypeFilter = interaction.options.getString('claim_type'); // null | 'claim' | 'submissions'

      // Including `export` skips the on-screen list and just hands back the
      // themed .xlsx directly — the same file the results' button produces.
      if (interaction.options.getString('export') === 'yes') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await sendBountyExport(interaction, status, order, groupByStatus, claimTypeFilter);
        return;
      }

      // Unset claim_type on a row means the pre-submissions-feature default,
      // 'claim' (see /allbounties' claim_type option description) — matched
      // the same way the admin site's own claim_type filter does.
      const rows = (await getBounties(status)).filter(
        (b) => !claimTypeFilter || (b.claim_type || 'claim') === claimTypeFilter,
      );

      const claimTypeLabel = claimTypeFilter === 'submissions' ? 'Submissions ' : claimTypeFilter === 'claim' ? 'Claim ' : '';
      const label = (status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1));

      if (rows.length === 0) {
        await interaction.reply({
          content: `No ${status === 'all' ? '' : status + ' '}${claimTypeLabel.toLowerCase()}bounties yet.`,
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
        const title = chunks.length > 1
          ? `📋 ${label} ${claimTypeLabel}Bounties (${idx + 1}/${chunks.length})`
          : `📋 ${label} ${claimTypeLabel}Bounties`;
        return new EmbedBuilder()
          .setTitle(title)
          .setColor(COLORS.approved)
          .setDescription(description)
          .setFooter({ text: `Coastal Clash • ${rows.length} ${status === 'all' ? 'total' : status}${claimTypeFilter ? ` (${claimTypeFilter})` : ''}` });
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
    // panel. Two active categories (Claim / Submissions) share one archive
    // category — which category a given bounty's claim opens in is decided
    // per-bounty by staff at approval time (Claim Type field). `board` and
    // `submissions_board` are separate: `board` logs finalized one-shot
    // claims, `submissions_board` stays live and gets edited in place to
    // show a submissions bounty's current leader.
    if (interaction.isChatInputCommand() && interaction.commandName === 'deployclaimbounty') {
      const claimCategory = interaction.options.getChannel('claim_category');
      const submissionsCategory = interaction.options.getChannel('submissions_category');
      const board = interaction.options.getChannel('board');
      const submissionsBoard = interaction.options.getChannel('submissions_board');
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
      await setSubmissionsBoardChannel(submissionsBoard.id);
      await setClaimArchiveCategory(archiveCategory.id);
      if (staffRole) await setClaimStaffRole(staffRole.id); else await clearSetting('claim_staff_role');
      if (staffUser) await setClaimStaffUser(staffUser.id); else await clearSetting('claim_staff_user');

      await interaction.channel.send(buildClaimPanel());

      const reviewers = describeReviewers(staffRole, staffUser);

      await interaction.reply({
        content: `🏁 Claim board deployed. Claims open under **${claimCategory.name}** or **${submissionsCategory.name}** (set per-bounty by staff at approval), reviewed by **${reviewers}**, finalized claims post to ${board}, submissions bounties stay live on ${submissionsBoard}, and approved tickets move to **${archiveCategory.name}**.`,
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

    // /deployproleaderboard and /deploycasualleaderboard  →  posts ONE
    // bracket's live leaderboard and remembers where it landed
    // (channel+message id, keyed by bracket), so the 30-min refresh timer
    // and daily cull (src/coastalClash/timer.js) can edit this SAME
    // message in place afterward. Fully independent commands — Pro and
    // Casual can be deployed to different channels, at different times.
    // Re-running either re-deploys that bracket to wherever it's run.
    if (interaction.isChatInputCommand() && (interaction.commandName === 'deployproleaderboard' || interaction.commandName === 'deploycasualleaderboard')) {
      const bracket = interaction.commandName === 'deployproleaderboard' ? 'pro' : 'casual';
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { pro, casual } = await buildLeaderboardEmbeds(pool);
      const embed = bracket === 'pro' ? pro : casual;

      // If this bracket's already deployed to THIS SAME channel, edit that
      // existing message instead of posting a duplicate. Deploying to a
      // DIFFERENT channel (or for the first time) still posts fresh there
      // and starts tracking the new location, same as before.
      const existingChannelId = await getLeaderboardChannel(bracket);
      const existingMessageId = existingChannelId === interaction.channel.id ? await getLeaderboardMessageId(bracket) : null;

      let edited = false;
      if (existingMessageId) {
        try {
          const existingMessage = await interaction.channel.messages.fetch(existingMessageId);
          await existingMessage.edit({ embeds: [embed] });
          edited = true;
        } catch (err) {
          console.warn(`Coastal Clash: could not edit existing ${bracket} leaderboard message on redeploy, posting a new one:`, err.message);
        }
      }

      if (!edited) {
        const message = await interaction.channel.send({ embeds: [embed] });
        await setLeaderboardChannel(bracket, interaction.channel.id);
        await setLeaderboardMessageId(bracket, message.id);
      }

      await interaction.editReply({ content: `🏆 Coastal Clash ${bracket === 'pro' ? 'Pro' : 'Casual'} leaderboard ${edited ? 'updated' : 'deployed'} in this channel.` });
      return;
    }

    // /deployislive  →  posts (or edits, on redeploy to the same channel)
    // the "Live Now" message — one message, not per-bracket, listing
    // everyone currently streaming with a clickable link and their
    // current stream title. Kept up to date by the same refresh cycle
    // that writes twitchlive/twitch_title (src/coastalClash/cull.js
    // refreshTwitchLiveStatus).
    if (interaction.isChatInputCommand() && interaction.commandName === 'deployislive') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const embed = await buildLiveNowEmbed(pool);

      const existingChannelId = await getLiveNowChannel();
      const existingMessageId = existingChannelId === interaction.channel.id ? await getLiveNowMessageId() : null;

      let edited = false;
      if (existingMessageId) {
        try {
          const existingMessage = await interaction.channel.messages.fetch(existingMessageId);
          await existingMessage.edit({ embeds: [embed] });
          edited = true;
        } catch (err) {
          console.warn('Coastal Clash: could not edit existing Live Now message on redeploy, posting a new one:', err.message);
        }
      }

      if (!edited) {
        const message = await interaction.channel.send({ embeds: [embed] });
        await setLiveNowChannel(interaction.channel.id);
        await setLiveNowMessageId(message.id);
      }

      await interaction.editReply({ content: `🔴 Coastal Clash Live Now board ${edited ? 'updated' : 'deployed'} in this channel.` });
      return;
    }

    // /deployliveupdate  →  sets the channel for the "Live Update"
    // announcement feed, THEN immediately posts for anyone already
    // streaming Eternal Return right now — otherwise someone who started
    // streaming before this command was ever run would never get
    // announced (the refresh timer only fires on a fresh SWITCH into ER,
    // not on "already was ER last check too"). twitch_status.last_game
    // reflects the most recent refresh cycle (within the last ~10 min),
    // so this reads current state without needing its own extra Twitch
    // API call.
    if (interaction.isChatInputCommand() && interaction.commandName === 'deployliveupdate') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await setLiveAnnounceChannel(interaction.channel.id);

      const { rows: alreadyLive } = await pool.query(
        `SELECT p.name, p.twitch, s.title
         FROM players p
         JOIN twitch_status s ON s.name = p.name
         WHERE p.twitchlive = true AND s.last_game = $1`,
        [ETERNAL_RETURN_GAME_ID],
      );
      const toAnnounce = alreadyLive.map((p) => ({ name: p.name, twitch: p.twitch, title: p.title, gameName: 'Eternal Return' }));
      const { posted } = await postLiveAnnouncements(interaction.client, db, toAnnounce);

      await interaction.editReply({
        content: `🔴 Coastal Clash Live Update announcements will post in this channel from now on.${posted ? ` Posted ${posted} already-live streamer${posted === 1 ? '' : 's'} now.` : ''}`,
      });
      return;
    }

    // Posts (first time) or edits-in-place (every time after) the shared
    // /daychange + /dayprevious status message. Unlike an interaction
    // reply, this is a REGULAR channel message — that's required for a
    // LATER, separate interaction to be able to edit it at all (an
    // ephemeral reply can only ever be edited by the same interaction
    // that created it). Visible to the whole channel as a tradeoff.
    async function postOrUpdateDayChangeStatus(client, channel, content) {
      const stored = await db.getDayChangeStatusMessage();
      const [storedChannelId, storedMessageId] = stored ? stored.split(':') : [null, null];

      if (storedChannelId === channel.id && storedMessageId) {
        try {
          const message = await channel.messages.fetch(storedMessageId);
          await message.edit({ content });
          return;
        } catch (err) {
          console.warn('Coastal Clash: could not edit existing daychange status message, posting a new one:', err.message);
        }
      }

      const message = await channel.send({ content });
      await db.setDayChangeStatusMessage(channel.id, message.id);
    }

    // /daychange  →  TEST ONLY. Advances the same 'coastal_clash_sim_day'
    // counter scripts/simulateNextDay.js uses, runs a REAL cull for that
    // simulated day, then immediately pushes the result to whichever live
    // leaderboard message(s) are deployed — so a day-change is actually
    // visible in Discord instead of waiting on the real 11:59 PM PDT timer.
    // Hard-refuses outside the designated test guild — this is a real cull
    // trigger, not a read-only preview.
    if (interaction.isChatInputCommand() && interaction.commandName === 'daychange') {
      if (interaction.guildId !== COASTAL_CLASH_TEST_GUILD_ID) {
        await interaction.reply({ content: '🚨 This command only works in the Coastal Clash test server.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const SIM_DAY_KEY = 'coastal_clash_sim_day';
      const current = parseInt((await db.getSetting(SIM_DAY_KEY)) ?? '0', 10);
      const nextDay = current + 1;
      const simulatedNow = dateForSimulatedDay(nextDay);

      const result = await runDailyCull(simulatedNow, false);
      await db.setSetting(SIM_DAY_KEY, String(nextDay));
      await postOrUpdateLeaderboard(interaction.client, db, simulatedNow);

      const cullLine = result.skipped
        ? `${result.reason}.`
        : `Pro culled: ${result.proCulled.join(', ') || '(none)'}\nCasual culled: ${result.casualCulled.join(', ') || '(none)'}`;
      await postOrUpdateDayChangeStatus(
        interaction.client,
        interaction.channel,
        `📅 Advanced to Day ${result.day}.\n${cullLine}\nPro indanger next: ${result.proIndanger.join(', ') || '(none)'}\nCasual indanger next: ${result.casualIndanger.join(', ') || '(none)'}\nLive leaderboard refreshed.`,
      );
      await interaction.deleteReply();
      return;
    }

    // /dayprevious  →  TEST ONLY. Goes back one simulated day by resetting
    // everyone (culled/indanger/mmr) and replaying runDailyCull for every
    // day from 1 up to the new target — same verified logic /daychange
    // uses, just run in a loop, rather than trying to reconstruct an
    // "undo" from a boolean column that doesn't record which day someone
    // was culled on. Same test-guild-only hard guard as /daychange.
    if (interaction.isChatInputCommand() && interaction.commandName === 'dayprevious') {
      if (interaction.guildId !== COASTAL_CLASH_TEST_GUILD_ID) {
        await interaction.reply({ content: '🚨 This command only works in the Coastal Clash test server.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const SIM_DAY_KEY = 'coastal_clash_sim_day';
      const current = parseInt((await db.getSetting(SIM_DAY_KEY)) ?? '0', 10);
      const target = Math.max(1, current - 1);

      await pool.query('UPDATE players SET culled = false, indanger = false, mmr = 0');

      let result = null;
      for (let day = 1; day <= target; day++) {
        result = await runDailyCull(dateForSimulatedDay(day), false);
      }
      await db.setSetting(SIM_DAY_KEY, String(target));
      await postOrUpdateLeaderboard(interaction.client, db, dateForSimulatedDay(target));

      const cullLine = result.skipped
        ? `${result.reason}.`
        : `Pro culled: ${result.proCulled.join(', ') || '(none)'}\nCasual culled: ${result.casualCulled.join(', ') || '(none)'}`;
      await postOrUpdateDayChangeStatus(
        interaction.client,
        interaction.channel,
        `⏮️ Rewound to Day ${result.day} (replayed from Day 1).\n${cullLine}\nPro indanger next: ${result.proIndanger.join(', ') || '(none)'}\nCasual indanger next: ${result.casualIndanger.join(', ') || '(none)'}\nLive leaderboard refreshed.`,
      );
      await interaction.deleteReply();
      return;
    }

// /readme  →  how the system works (staff only), 3 pages navigated with
// Previous/Next buttons. buildReadmePage/buildReadmeRow are also used by
// the readme_page_ button handler below to redraw the same message on a
// different page — kept as named functions (not inlined) so both places
// build the embed/row identically.
    function buildReadmePage(pageIndex) {
      const page = TEXT.README.pages[pageIndex];
      return new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(page.title)
        .setDescription(page.description.join('\n'))
        .setImage(BANNER_URL)
        .setFooter({ text: TEXT.FOOTER });
    }

    function buildReadmeRow(pageIndex) {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`readme_page_${pageIndex - 1}`)
          .setLabel('◀ Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageIndex === 0),
        new ButtonBuilder()
          .setCustomId(`readme_page_${pageIndex + 1}`)
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageIndex === TEXT.README.pages.length - 1),
      );
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'readme') {
      await interaction.reply({
        embeds: [buildReadmePage(0)],
        components: [buildReadmeRow(0)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('readme_page_')) {
      const pageIndex = parseInt(interaction.customId.replace('readme_page_', ''), 10);
      await interaction.update({
        embeds: [buildReadmePage(pageIndex)],
        components: [buildReadmeRow(pageIndex)],
      });
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

      // Deferred (not .update()) so the archive result is known before the
      // message gets its final content — same reasoning as finalizeApproval.
      await interaction.deferUpdate();

      const helpArchiveCategoryId = await getHelpArchiveCategory();
      const archived = await closeOrArchiveTicket(interaction.channel, helpArchiveCategoryId);
      const archiveNote = !helpArchiveCategoryId
        ? 'Closing this channel in a few seconds…'
        : archived
          ? 'Archiving this channel…'
          : '⚠️ Could not move this channel into its archive category — check it\'s still configured correctly (`/deployticket`). Nothing was lost, it just stayed here.';

      await interaction.editReply({
        content: `🔒 **Ticket closed** by ${interaction.user}. ${archiveNote}`,
        components: [],
      });
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
        const archived = await closeOrArchiveTicket(interaction.channel, oldTicketArchiveCategoryId);
        const archiveNote = !oldTicketArchiveCategoryId
          ? 'Closing this ticket in a few seconds…'
          : archived
            ? 'Archiving this ticket…'
            : '⚠️ Could not move this ticket into its archive category — check it\'s still configured correctly (`/deployrequestbounty`). Nothing was lost, it just stayed here.';
        await interaction.followUp({
          content: `✅ **Approved** by ${interaction.user}${boardNote}. ${archiveNote}`,
        });
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
      let deniedBounty = null;
      if (bountyId) {
        deniedBounty = await denyBounty(bountyId, interaction.user.id).catch(console.error);
      }

      // Deferred so the archive result is known before the message goes out
      // — same reasoning as finalizeApproval.
      await interaction.deferReply();
      const deniedName = deniedBounty ? toChannelName('closed-denied', deniedBounty.name) : undefined;
      const archived = await closeOrArchiveTicket(interaction.channel, denyArchiveCategoryId, deniedName);
      const archiveNote = !denyArchiveCategoryId
        ? 'Closing this ticket in a few seconds…'
        : archived
          ? 'Archiving this ticket…'
          : '⚠️ Could not move this ticket into its archive category — check it\'s still configured correctly (`/deployrequestbounty`). Nothing was lost, it just stayed here.';
      await interaction.editReply({ content: `⛔ **Denied** by ${interaction.user}. ${archiveNote}` });
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
      const [tier] = interaction.fields.getStringSelectValues('bounty_tier');
      const [claimType] = interaction.fields.getStringSelectValues('bounty_claim_type');

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
        tier,
        claimType,
        ticketChannelId: interaction.channelId,
        ticketMessageId: interaction.message.id,
        createdAt: Date.now(),
      });

      await interaction.reply({
        content: 'Saved. Press **Continue** to set the reward'
          + (claimType === 'submissions' ? ' and this bounty\'s leaderboard.' : '.'),
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

      const step1 = pendingApprovals.get(bountyId);
      if (!step1) {
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
      // claimType (from step 1) decides whether step 2 also asks for the
      // leaderboard setup, so the whole flow stays 2 pages either way.
      await interaction.showModal(buildApproveModalStep2(bounty, step1.claimType));
      return;
    }

    // Step 2 submitted  →  this is what "Approve" actually commits: save
    // everything from both steps (including the leaderboard setup, if this
    // is a Submissions bounty — step 2's fields vary based on step 1's
    // Claim Type, see buildApproveModalStep2), finalize approval, ship it
    // to the right board, and close the ticket. Always one shot — no more
    // step 3, so there's no window where a bounty can end up approved in
    // the DB but not yet posted/archived.
    if (interaction.isModalSubmit() && interaction.customId.startsWith('approve_modal_step2_submit')) {
      const bountyId = customIdArg(interaction);

      const [prizeType] = interaction.fields.getStringSelectValues('bounty_reward_type');
      const amountRaw = interaction.fields.getTextInputValue('bounty_amount');
      const [isExpiring] = interaction.fields.getStringSelectValues('bounty_is_expiring');

      const step1 = pendingApprovals.get(bountyId);
      if (!step1) {
        await interaction.reply({
          content: '⚠️ This approval session expired — press **Approve** again to restart.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const { name, description, donatorName, tier, claimType, ticketChannelId, ticketMessageId } = step1;

      // Only present when step 1's Claim Type was Submissions — step 2 was
      // built without these fields at all otherwise (buildApproveModalStep2).
      let submissionMetric = null;
      if (claimType === 'submissions') {
        const [kind] = interaction.fields.getStringSelectValues('submission_metric_kind');
        const label = interaction.fields.getTextInputValue('submission_metric_label').trim();
        submissionMetric = { kind, label };
      }

      const collected = { name, description, donatorName, prizeType, amountRaw, tier, claimType, ticketChannelId, ticketMessageId, submissionMetric };

      // "No" (the common case) finalizes right here, same as before this
      // field existed. "Yes" can't collect a date in this same modal
      // (Discord modals can't reveal a field conditionally, and this one's
      // already at its 5-component cap for submissions bounties) — instead,
      // re-save everything collected so far under pendingApprovals and
      // follow up with a day-picker button grid (expiry_day_pick below),
      // which is what actually finalizes the approval for an expiring
      // bounty.
      if (isExpiring !== 'yes') {
        await commitBountyApproval({ interaction, bountyId, ...collected, expiresAt: null });
        return;
      }

      pendingApprovals.set(bountyId, { ...collected, createdAt: Date.now() });
      await interaction.reply({ ...buildExpiryDayPicker(bountyId), flags: MessageFlags.Ephemeral });
      return;
    }

    // Staff picked a day on the expiry grid (buildExpiryDayPicker, shown
    // above when step 2's Bounty Expires was "Yes") — this is what actually
    // finalizes the approval for an expiring bounty; the non-expiring path
    // finalizes directly from the step 2 handler instead.
    if (interaction.isButton() && interaction.customId.startsWith('expiry_day_pick:')) {
      const [, bountyId, dayRaw] = interaction.customId.split(':');

      const collected = pendingApprovals.get(bountyId);
      if (!collected) {
        await interaction.reply({
          content: '⚠️ This approval session expired — press **Approve** again to restart.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await commitBountyApproval({ interaction, bountyId, ...collected, expiresAt: cullMomentForDay(Number(dayRaw)) });
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
          groupType: bounty.group_type,
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

      // Archived tickets shouldn't still be actionable — the button stays on
      // the message forever (nothing removes it), so a stale click here used
      // to reach the permission-grant call below for no reason. Short-circuit
      // before that, and before the embed-parsing/lookup work above it too.
      if (isAlreadyArchived(interaction.channel, await getClaimArchiveCategory())) {
        await interaction.reply({ content: '⚠️ This ticket is already archived.', flags: MessageFlags.Ephemeral });
        return;
      }

      const requesterId = interaction.message.embeds[0]
        ? extractMentionId(interaction.message.embeds[0], resolveText('CARD.claim.fieldOriginalRequester'))
        : null;

      if (!requesterId) {
        await interaction.reply({ content: resolveText('REPLIES.includeRequesterFailed'), flags: MessageFlags.Ephemeral });
        return;
      }

      try {
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
      } catch (err) {
        // Discord rejects the grant (code 10009 "Unknown Overwrite" is the
        // common case — the id isn't a real member of this guild, e.g. bad
        // test data or someone who's since left) — surface that plainly
        // instead of falling through to the generic top-level error handler.
        console.error('Failed to include requester:', err);
        await interaction.reply({
          content: `⚠️ Couldn't add <@${requesterId}> — Discord rejected it (they may not be a member of this server).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        content: `👥 <@${requesterId}> has been added to this ticket by ${interaction.user}.`,
      });
      return;
    }

    // "Add Premade" inside a premade-type claim ticket  →  staff only. Only
    // ever shown on premade bounties (see src/ticket.js claimReviewButtons).
    // Opens a native Discord user-search picker; granting access happens
    // once it's submitted (add_premade_select below), not here.
    if (interaction.isButton() && interaction.customId.startsWith('add_premade:')) {
      if (!(await requireStaff(interaction, getClaimStaff, 'add premade teammates'))) return;

      if (isAlreadyArchived(interaction.channel, await getClaimArchiveCategory())) {
        await interaction.reply({ content: '⚠️ This ticket is already archived.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({
        content: 'Search for the teammates to add:',
        components: [addPremadeSelectRow(customIdArg(interaction), interaction.message.id)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Teammate picker submitted  →  grant each selected person the same
    // access Include Requester gives, one overwrite per person. A failure on
    // one (e.g. someone who's left the server since the picker loaded)
    // doesn't block the rest. Result is posted to the channel (not just the
    // ephemeral picker) so the claimant and other staff can see who was added
    // — and added to the ticket's own claim card as a Teammates field, so
    // they're visible on the card itself (and carry through to the finalized
    // claim board post once approved, since approve_claim rebuilds from
    // whatever this message's embed looks like at that point).
    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('add_premade_select')) {
      await interaction.deferUpdate();

      if (isAlreadyArchived(interaction.channel, await getClaimArchiveCategory())) {
        await interaction.editReply({ content: '⚠️ This ticket is already archived.', components: [] });
        return;
      }

      const added = [];
      const failed = [];
      for (const [userId] of interaction.users) {
        try {
          await interaction.channel.permissionOverwrites.create(
            userId,
            { ViewChannel: true, SendMessages: true, ReadMessageHistory: true },
            { type: OverwriteType.Member },
          );
          added.push(userId);
        } catch (err) {
          console.error('Failed to add premade teammate:', err);
          failed.push(userId);
        }
      }

      const failedNote = failed.length ? ` Couldn't add ${failed.map((id) => `<@${id}>`).join(', ')} — Discord rejected it.` : '';
      await interaction.editReply({ content: added.length ? 'Done.' : `⚠️ Nothing added.${failedNote}`, components: [] });

      if (added.length) {
        await interaction.channel.send({
          content: `👥 Added ${added.map((id) => `<@${id}>`).join(', ')} to this ticket by ${interaction.user}.${failedNote}`,
        });

        const ticketMessageId = interaction.customId.split(':')[2];
        const ticketMessage = ticketMessageId ? await interaction.channel.messages.fetch(ticketMessageId).catch(() => null) : null;
        if (ticketMessage?.embeds[0]) {
          const teammatesFieldName = resolveText('CARD.claim.fieldTeammates');
          const updatedEmbed = EmbedBuilder.from(ticketMessage.embeds[0]);
          const fields = updatedEmbed.data.fields ?? [];
          const existing = fields.find((f) => f.name === teammatesFieldName);
          const allIds = [...new Set([...getTeammateIdsFromEmbed(ticketMessage.embeds[0]), ...added])];
          const teammatesField = { name: teammatesFieldName, value: allIds.map((id) => `<@${id}>`).join(', '), inline: true };
          updatedEmbed.setFields(existing ? fields.map((f) => (f === existing ? teammatesField : f)) : [...fields, teammatesField]);
          await ticketMessage.edit({ embeds: [updatedEmbed] }).catch(console.error);
        }
      }
      return;
    }

    // "Approve Claim" inside a claim ticket  →  staff only. Finalizes the
    // claim (guarded against a bounty already claimed elsewhere), marks the
    // original request-board post claimed, and logs it to the claim board.
    if (interaction.isButton() && interaction.customId.startsWith('approve_claim')) {
      if (!(await requireStaff(interaction, getClaimStaff, 'approve claims'))) return;

      // Guards against approving a ticket that was already denied — denying a
      // CLAIM doesn't change the bounty's own status (it stays 'approved' so
      // others can still claim it), so claimBounty's own status check below
      // can't catch this the way bounty approve/deny already does.
      if (isAlreadyArchived(interaction.channel, await getClaimArchiveCategory())) {
        await interaction.reply({ content: '⚠️ This ticket is already archived.', flags: MessageFlags.Ephemeral });
        return;
      }

      const bountyId = customIdArg(interaction);
      const claimantId = interaction.message.embeds[0]
        ? extractMentionId(interaction.message.embeds[0], 'Claimant')
        : null;

      if (!bountyId || !claimantId) {
        await interaction.reply({ content: resolveText('REPLIES.claimFinalizeFailed'), flags: MessageFlags.Ephemeral });
        return;
      }

      // Submissions bounties don't finalize on the first approved claim —
      // they promote the claimant to current leader and stay open (see
      // promoteSubmissionLeader above). Everything below this branch is the
      // original one-shot 'claim' behavior, untouched.
      const bountyForClaim = await getBountyById(bountyId);
      if (bountyForClaim?.claim_type === 'submissions') {
        const ticketChannelId = interaction.channelId;
        const ticketMessageId = interaction.message.id;

        if (bountyForClaim.submission_metric_kind === 'numeric') {
          pendingSubmissionValues.set(bountyId, { claimantId, ticketChannelId, ticketMessageId, createdAt: Date.now() });
          // showModal must be the FIRST response — nothing above this sends one.
          await interaction.showModal(buildSubmissionValueModal(bountyForClaim));
          return;
        }

        await promoteSubmissionLeader({
          interaction,
          bounty: bountyForClaim,
          claimantId,
          value: null,
          ticketChannelId,
          ticketMessageId,
        });
        return;
      }

      const updated = await claimBounty(bountyId, claimantId);

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
      // re-alphabetized so it stays easy to scan by name. Always
      // 'declared-claim' here — a submissions-type claim never reaches this
      // point at all (see the early branch above that hands it off to
      // promoteSubmissionLeader instead), so there's no "submission" case
      // to name for.
      const archiveCategoryId = await getClaimArchiveCategory();
      if (archiveCategoryId) {
        const approvedPrefix = 'declared-claim';
        try {
          await interaction.channel.setParent(archiveCategoryId, { lockPermissions: true });
          await interaction.channel.setName(toChannelName(approvedPrefix, updated.name)).catch(console.error);
          await alphabetizeCategory(interaction.channel.parent);
          notes.push('archived');
        } catch (err) {
          console.error('Failed to archive approved claim ticket:', err);
          notes.push('⚠️ could not be archived — check the archive category is still configured correctly');
        }
      }

      const boardNote = notes.length ? ` and ${notes.join(' and ')}` : '';

      await interaction.followUp({
        content: `🏁 **Claim approved** by ${interaction.user}${boardNote}.`,
      });
      return;
    }

    // Numeric-metric value submitted (see approve_claim's submissions branch
    // above) → promotes the stashed claimant to leader now that their value
    // is known. No separate staff check — only reachable from a button
    // already gated by requireStaff.
    if (interaction.isModalSubmit() && interaction.customId.startsWith('submission_value_modal_submit')) {
      const bountyId = customIdArg(interaction);
      const value = interaction.fields.getTextInputValue('submission_value').trim();

      const pending = pendingSubmissionValues.get(bountyId);
      if (!pending) {
        await interaction.reply({
          content: '⚠️ This session expired — press **Approve Claim** again to restart.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      pendingSubmissionValues.delete(bountyId);

      const bounty = await getBountyById(bountyId);
      if (!bounty) {
        await interaction.reply({ content: resolveText('REPLIES.bountyMissing'), flags: MessageFlags.Ephemeral });
        return;
      }

      await promoteSubmissionLeader({
        interaction,
        bounty,
        claimantId: pending.claimantId,
        value,
        ticketChannelId: pending.ticketChannelId,
        ticketMessageId: pending.ticketMessageId,
      });
      return;
    }

    // /endsubmissions  →  staff only (setDefaultMemberPermissions,
    // deploy-commands.js). Step 1 of 2: counts everything pending (still
    // open, or closed but not yet announced from a previous partial run —
    // see getUnfinalizedSubmissionBounties) and asks to continue. Re-counted
    // fresh at each step rather than trusted from here, since staff could
    // take a while clicking through and the real list only matters at the
    // moment it's actually acted on.
    if (interaction.isChatInputCommand() && interaction.commandName === 'endsubmissions') {
      if (!(await requireStaff(interaction, getClaimStaff, 'end submissions'))) return;

      const pending = await getUnfinalizedSubmissionBounties();
      if (pending.length === 0) {
        await interaction.reply({ content: 'Nothing to end — no submission bounties are pending.', flags: MessageFlags.Ephemeral });
        return;
      }

      const names = pending.slice(0, 10).map((b) => `**${b.name}**`).join(', ') + (pending.length > 10 ? `, and ${pending.length - 10} more` : '');
      await interaction.reply({
        content: `This will finalize and publicly announce results for **${pending.length}** submission bounty${pending.length === 1 ? '' : 'ies'}: ${names}. Continue?`,
        components: [endSubmissionsConfirmRow1()],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Removed 2026-08-15 — this command's own comment said "remove once
    // the IP theory is settled," and it now is (confirmed: Railway's
    // outbound IP gets 403 from the ER API while the same key works fine
    // from elsewhere — see er_api_findings memory). It also stopped doing
    // what it claimed to do: erApi.js now routes every call through one
    // shared request queue + circuit breaker, so "zero spacing between
    // calls" is no longer true, and running this could trip the shared
    // circuit and block the real refresh timer for 30 minutes while
    // reporting misleadingly. Still registered as a slash command until
    // `node deploy-commands.js` is run to actually remove it from Discord
    // — see deploy-commands.js.
    if (interaction.isChatInputCommand() && interaction.commandName === 'apiburst') {
      await interaction.reply({
        content: '⚠️ `/apiburst` has been removed — it stopped being a true unthrottled test once a shared circuit breaker was added, and running it risks tripping that circuit for 30 minutes. See `er_api_findings.md`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Step 2 of 2 — the "really sure" (see endSubmissionsConfirmRow1's own
    // comment for why this gets a second confirm step: it's bulk AND
    // public, across every pending bounty at once).
    if (interaction.isButton() && interaction.customId === 'endsubmissions_confirm1') {
      const pending = await getUnfinalizedSubmissionBounties();
      if (pending.length === 0) {
        await interaction.update({ content: 'Nothing left to end — looks like this already happened.', components: [] });
        return;
      }
      await interaction.update({
        content: `Really end submissions? This posts publicly to #claimed and removes each bounty's live board post for **${pending.length}** submission bounty${pending.length === 1 ? '' : 'ies'} — can't be undone from here.`,
        components: [endSubmissionsConfirmRow2()],
      });
      return;
    }

    // Actually does it — for every pending bounty, closes it first if it's
    // still open (finalizeSubmissionBountyPrivately), then announces it
    // publicly (announceSubmissionBountyPublicly). A
    // failure on one bounty doesn't stop the rest. Several sequential
    // Discord API calls per bounty, so deferred immediately.
    if (interaction.isButton() && interaction.customId === 'endsubmissions_confirm2') {
      await interaction.deferUpdate();

      const pending = await getUnfinalizedSubmissionBounties();
      let succeeded = 0;
      const failed = [];
      const skipped = [];
      for (const bounty of pending) {
        // A bounty can sit 'approved' with zero submissions, and there's no
        // winner to declare or announce for it. Left exactly as-is (still
        // pending, still shows on the next /endsubmissions run) rather than
        // force-closing it with no leader.
        if (!bounty.leader_id) {
          skipped.push(bounty.name);
          continue;
        }
        try {
          const closed = bounty.status === 'approved' ? await finalizeSubmissionBountyPrivately(interaction.guild, bounty) : bounty;
          if (!closed) {
            failed.push(bounty.name);
            continue;
          }
          await announceSubmissionBountyPublicly(interaction.guild, closed);
          succeeded++;
        } catch (err) {
          console.error(`Failed to finalize submission bounty ${bounty.id} (${bounty.name}) during /endsubmissions:`, err);
          failed.push(bounty.name);
        }
      }

      const failedNote = failed.length ? ` ⚠️ Failed: ${failed.join(', ')} — check logs and re-run \`/endsubmissions\` for those.` : '';
      const skippedNote = skipped.length ? ` Skipped (no submissions yet, still open): ${skipped.join(', ')}.` : '';
      await interaction.editReply({
        content: `🏆 **Submissions ended** by ${interaction.user} — announced ${succeeded} bounty${succeeded === 1 ? '' : 'ies'}.${skippedNote}${failedNote}`,
        components: [],
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'endsubmissions_cancel') {
      await interaction.update({ content: 'Cancelled — nothing was ended.', components: [] });
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

      // Built fresh from the bounty's own name/claim_type (like approve_claim
      // does), not stacked onto the ticket's existing "claim-<bounty>-
      // <claimant>" name — gives "denied-claim-<bounty>" / "submission-lost-
      // <bounty>" instead of doubling up "claim-claim-...". A denied
      // submission (fresh, or a reopened one staff decided not to reinstate)
      // reads as 'submission-lost' rather than 'denied-submission' — this is
      // the didn't-win outcome, same idea as promoteSubmissionLeader's own
      // 'submission-won' for the opposite case.
      const bounty = await getBountyById(customIdArg(interaction));
      const deniedPrefix = bounty?.claim_type === 'submissions' ? 'submission-lost' : 'denied-claim';
      const deniedName = bounty ? toChannelName(deniedPrefix, bounty.name) : undefined;

      // Recolor and strip the buttons from the original ticket message —
      // approve_claim already does this on success; deny_claim didn't, which
      // is why Approve Claim (and Include Requester / Add Premade) stayed
      // clickable on an already-denied ticket. update() edits that same
      // message since this button lives on it; the actual "denied" text goes
      // out as a followUp right after, same as approve_claim's flow.
      const deniedEmbed = interaction.message.embeds[0]
        ? EmbedBuilder.from(interaction.message.embeds[0]).setColor(COLORS.denied)
        : null;
      await interaction.update({ embeds: deniedEmbed ? [deniedEmbed] : [], components: [] });

      const archived = await closeOrArchiveTicket(interaction.channel, claimDenyArchiveCategoryId, deniedName);
      const archiveNote = !claimDenyArchiveCategoryId
        ? 'Closing this ticket in a few seconds…'
        : archived
          ? 'Archiving this ticket…'
          : '⚠️ Could not move this ticket into its archive category — check it\'s still configured correctly (`/deployclaimbounty`). Nothing was lost, it just stayed here.';

      await interaction.followUp({
        content: `⛔ **Claim denied** by ${interaction.user}. ${archiveNote}`,
      });
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