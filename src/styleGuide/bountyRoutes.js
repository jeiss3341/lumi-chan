// Route handlers for the bounty admin pages (list / new / edit / free
// status change) — split out of server.js because these, unlike everything
// else on the style-guide site, need the live Discord `client` to keep an
// approved bounty's board post in sync with edits made here, on top of the
// usual DB read/write. src/styleGuide/bounties.js does the HTML; this file
// does the async work and hands it data to render.
const {
  getBounties, getBountyById, createBounty, updateBounty, findTitleConflict,
  approveBounty, setBountyStatus, setBoardMessage, getBoardChannel,
} = require('../db');
const { buildBountyEmbed, buildLeaderboardEmbed } = require('../bountyCard');
const { buildBountiesListHtml, buildBountyNewHtml, buildBountyEditHtml, LIMITS, PRIZE_TYPES, TIERS, GROUP_TYPES, CLAIM_TYPES, CLAIM_FILTERS } = require('./bounties');
const { readBody, redirectTo } = require('./httpUtil');
const { resolveUserLabels } = require('./discordUsers');

const VALID_PRIZE_TYPES = PRIZE_TYPES.map((t) => t.value);
const VALID_TIERS = TIERS.map((t) => t.value);
const VALID_GROUP_TYPES = GROUP_TYPES.map((t) => t.value);
const VALID_CLAIM_TYPES = CLAIM_TYPES.map((t) => t.value);

const VALID_STATUSES = ['all', 'pending', 'approved', 'claimed', 'denied', 'cancelled'];
const VALID_GROUP_FILTERS = ['all', ...VALID_GROUP_TYPES];

// The admin edit page's free status-change control can move a bounty to any
// of these, from any of these, regardless of current value — 'claimed' is
// deliberately not included (see handleChangeBountyStatus below).
const ALLOWED_STATUS_TARGETS = ['pending', 'approved', 'denied', 'cancelled'];

function handleBountyError(res, err) {
  if (err.message === 'BODY_TOO_LARGE') {
    res.writeHead(413, { 'Content-Type': 'text/plain' });
    res.end('That submission was too large.');
    return;
  }
  console.error('Bounty admin action failed:', err);
  res.writeHead(500, { 'Content-Type': 'text/plain' });
  res.end('Something went wrong.');
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Bounty not found.');
}

// Resolves a batch of Discord user ids to { username, nickname } up front,
// so bounties.js's rendering stays synchronous/pure — a fetch failure (left
// the server, deleted account) just falls back to showing the raw id.
async function resolveUserTags(client, ids) {
  const guild = client.guilds.cache.first() ?? null;
  return resolveUserLabels(client, guild, ids);
}

async function buildApprovedEmbedFor(client, bounty) {
  const requester = await client.users.fetch(bounty.requester_id).catch(() => null);
  return buildBountyEmbed({
    name: bounty.name,
    description: bounty.description,
    amountRaw: bounty.reward,
    groupType: bounty.group_type,
    user: requester ?? { id: bounty.requester_id, displayAvatarURL: () => null },
    status: 'approved',
  });
}

// The live leaderboard card's embed, for whichever guild this bot is in
// (single-guild bot, same assumption resolveUserTags above already makes).
async function buildLeaderboardEmbedFor(client, bounty) {
  const guild = client.guilds.cache.first() ?? null;
  const leaderMember = bounty.leader_id && guild ? await guild.members.fetch(bounty.leader_id).catch(() => null) : null;
  return buildLeaderboardEmbed(bounty, { leaderAvatarURL: leaderMember?.displayAvatarURL() });
}

// If a submissions bounty already has a live #submissions leaderboard post
// (submissions_board_channel_id/message_id — set once, by promoteSubmissionLeader,
// the moment the first claim is approved; still null if nobody's claimed
// yet, in which case there's nothing here to keep in sync), edits it to
// match the bounty's current fields too — so a reward/description change
// made here doesn't go stale on the live card until the bounty closes.
// Best-effort, same as the rest of this file's Discord side effects.
async function syncSubmissionsBoardPost(client, bounty) {
  if (bounty.claim_type !== 'submissions' || !bounty.submissions_board_channel_id || !bounty.submissions_board_message_id) return;
  const channel = await client.channels.fetch(bounty.submissions_board_channel_id).catch(() => null);
  const msg = channel ? await channel.messages.fetch(bounty.submissions_board_message_id).catch(() => null) : null;
  if (msg) await msg.edit({ embeds: [await buildLeaderboardEmbedFor(client, bounty)] }).catch(() => null);
}

// Edits the bounty's existing board post to match its current fields, or
// posts a fresh one (and records it) if it isn't tracked yet — e.g. it was
// just approved for the first time, or the old post was deleted out from
// under us. Never throws; failures come back as { ok: false, reason }, so a
// Discord hiccup doesn't block the DB save that triggered this. Also syncs
// the live #submissions leaderboard post, if one exists (see
// syncSubmissionsBoardPost) — this function's return value describes only
// the #approved record either way, same as before this existed.
async function syncApprovedBoardPost(client, bounty) {
  const embed = await buildApprovedEmbedFor(client, bounty);
  await syncSubmissionsBoardPost(client, bounty);

  if (bounty.board_channel_id && bounty.board_message_id) {
    const channel = await client.channels.fetch(bounty.board_channel_id).catch(() => null);
    const msg = channel ? await channel.messages.fetch(bounty.board_message_id).catch(() => null) : null;
    if (msg) {
      await msg.edit({ embeds: [embed] }).catch(() => null);
      return { ok: true, posted: false };
    }
    // Tracked ids exist but the message (or channel) is gone — fall through
    // and repost below rather than leaving it silently missing from the board.
  }

  const boardChannelId = await getBoardChannel();
  if (!boardChannelId) return { ok: false, reason: 'No board channel is configured — run /deployrequestbounty.' };
  const channel = await client.channels.fetch(boardChannelId).catch(() => null);
  if (!channel) return { ok: false, reason: "The configured board channel couldn't be reached." };
  const msg = await channel.send({ embeds: [embed] });
  await setBoardMessage(bounty.id, channel.id, msg.id);
  return { ok: true, posted: true };
}

// Used when a bounty leaves 'approved' (denied/cancelled) — pulls its post
// off the board, same as the normal claim-approval flow already does. Also
// pulls down the live #submissions leaderboard post, if one exists — an
// in-progress submissions bounty getting denied/cancelled from the admin
// site shouldn't leave a stale card with a working Close Bounty button
// behind.
async function removeBoardPost(client, bounty) {
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

async function boardMessageLink(client, bounty) {
  if (!bounty.board_channel_id || !bounty.board_message_id) return null;
  const channel = await client.channels.fetch(bounty.board_channel_id).catch(() => null);
  if (!channel?.guild) return null;
  return `https://discord.com/channels/${channel.guild.id}/${bounty.board_channel_id}/${bounty.board_message_id}`;
}

function validateFields({ name, description, reward, donatorName, prizeType, tier, groupType, claimType }) {
  const errors = {};
  if (!name) errors.name = 'Cannot be blank.';
  else if (name.length > LIMITS.name) errors.name = `Too long — ${name.length} characters, max is ${LIMITS.name}.`;
  if (!description) errors.description = 'Cannot be blank.';
  else if (description.length > LIMITS.description) {
    errors.description = `Too long — ${description.length} characters, max is ${LIMITS.description}.`;
  }
  if (reward.length > LIMITS.reward) errors.reward = `Too long — ${reward.length} characters, max is ${LIMITS.reward}.`;
  if (donatorName.length > LIMITS.donator) errors.donator_name = `Too long — ${donatorName.length} characters, max is ${LIMITS.donator}.`;
  if (prizeType && !VALID_PRIZE_TYPES.includes(prizeType)) errors.prize_type = 'Not a valid reward type.';
  if (tier && !VALID_TIERS.includes(tier)) errors.tier = 'Not a valid tier.';
  if (groupType && !VALID_GROUP_TYPES.includes(groupType)) errors.group_type = 'Not a valid group type.';
  if (claimType && !VALID_CLAIM_TYPES.includes(claimType)) errors.claim_type = 'Not a valid claim type.';
  return errors;
}

function bountyEditRedirect(id, text, warn) {
  return `/bounties/${id}/edit?msg=${encodeURIComponent(text)}${warn ? '&warn=1' : ''}`;
}

// GET /bounties
async function handleBountiesList(req, res, session, client) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const requested = url.searchParams.get('status') || 'all';
    const filterStatus = VALID_STATUSES.includes(requested) ? requested : 'all';
    const requestedGroup = url.searchParams.get('group') || 'all';
    const filterGroup = VALID_GROUP_FILTERS.includes(requestedGroup) ? requestedGroup : 'all';
    const requestedClaim = url.searchParams.get('claim') || 'all';
    const filterClaim = CLAIM_FILTERS.includes(requestedClaim) ? requestedClaim : 'all';

    const allBounties = await getBounties(filterStatus);
    const bounties = allBounties
      .filter((b) => filterGroup === 'all' || b.group_type === filterGroup)
      // Unset claim_type means the pre-submissions-feature default, 'claim'
      // (see CLAIM_TYPES' hint text) — matched the same way here.
      .filter((b) => filterClaim === 'all' || (b.claim_type || 'claim') === filterClaim);
    const tags = await resolveUserTags(client, bounties.flatMap((b) => [b.requester_id, b.claimer_id, b.leader_id]));

    const msg = url.searchParams.get('msg');
    const message = msg ? { text: msg, warn: url.searchParams.get('warn') === '1' } : undefined;

    const html = buildBountiesListHtml({ bounties, tags, filterStatus, filterGroup, filterClaim, username: session.username, message });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    console.error('Failed to render bounties list:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Something went wrong loading bounties.');
  }
}

// GET /bounties/new
function handleNewBountyPage(res, session, failure) {
  const html = buildBountyNewHtml({
    username: session.username,
    errors: failure?.errors ?? {},
    values: failure?.values ?? {},
  });
  res.writeHead(failure ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// POST /bounties/new
async function handleCreateBounty(req, res, session, client) {
  let params;
  try {
    params = new URLSearchParams(await readBody(req));
  } catch (err) {
    handleBountyError(res, err);
    return;
  }

  const name = (params.get('name') || '').trim();
  const description = (params.get('description') || '').trim();
  const reward = (params.get('reward') || '').trim();
  // Mirrors the Discord request modal's "leave blank to use your Discord
  // nickname" behavior — closest equivalent here is the admin's own OAuth
  // username, since there's no live guild member to read a nickname from.
  const donatorName = (params.get('donator_name') || '').trim() || session.username;
  const prizeTypeRaw = params.get('prize_type') || '';
  const prizeType = VALID_PRIZE_TYPES.includes(prizeTypeRaw) ? prizeTypeRaw : '';
  const tierRaw = params.get('tier') || '';
  const tier = VALID_TIERS.includes(tierRaw) ? tierRaw : '';
  const groupTypeRaw = params.get('group_type') || '';
  const groupType = VALID_GROUP_TYPES.includes(groupTypeRaw) ? groupTypeRaw : '';
  const claimTypeRaw = params.get('claim_type') || '';
  const claimType = VALID_CLAIM_TYPES.includes(claimTypeRaw) ? claimTypeRaw : '';
  const initialStatus = params.get('initialStatus') === 'approved' ? 'approved' : 'pending';

  const errors = validateFields({ name, description, reward, donatorName, prizeType, tier, groupType, claimType });
  if (Object.keys(errors).length) {
    handleNewBountyPage(res, session, { errors, values: { name, description, reward, donator_name: donatorName, prize_type: prizeType, tier, group_type: groupType, claim_type: claimType } });
    return;
  }

  if (initialStatus === 'approved') {
    const conflict = await findTitleConflict(name);
    if (conflict) {
      handleNewBountyPage(res, session, {
        errors: { name: `"${conflict.name}" is already approved or claimed — pick a different name.` },
        values: { name, description, reward, donator_name: donatorName, prize_type: prizeType, tier, group_type: groupType, claim_type: claimType },
      });
      return;
    }
  }

  try {
    // requester_id is NOT NULL and there's no real player behind an
    // admin-created bounty, so it's attributed to whichever admin made it.
    const id = await createBounty({ name, description, reward, requesterId: session.id, donatorName, groupType });
    if (prizeType || tier || claimType) await updateBounty(id, { name, description, reward, donatorName, prizeType, tier, groupType, claimType });
    let warnText = '';
    if (initialStatus === 'approved') {
      await approveBounty(id, session.id);
      const bounty = await getBountyById(id);
      const result = await syncApprovedBoardPost(client, bounty);
      if (!result.ok) warnText = ` Couldn't post to the board: ${result.reason}`;
    }
    const msg = `Bounty created${initialStatus === 'approved' ? ' and posted to the board.' : ' as pending.'}${warnText}`;
    redirectTo(res, bountyEditRedirect(id, msg, Boolean(warnText)), 303);
  } catch (err) {
    console.error('Failed to create bounty:', err);
    handleNewBountyPage(res, session, { errors: {}, values: { name, description, reward, donator_name: donatorName, prize_type: prizeType, tier, group_type: groupType, claim_type: claimType } });
  }
}

// GET /bounties/:id/edit
async function handleEditBountyPage(req, res, session, client, id, failure) {
  const bounty = await getBountyById(id);
  if (!bounty) {
    notFound(res);
    return;
  }

  const tags = await resolveUserTags(client, [bounty.requester_id, bounty.claimer_id, bounty.leader_id]);
  const boardLink = await boardMessageLink(client, bounty);

  const url = new URL(req.url, 'http://localhost');
  const qMsg = url.searchParams.get('msg');
  const message = failure?.message ?? (qMsg ? { text: qMsg, warn: url.searchParams.get('warn') === '1' } : undefined);

  const html = buildBountyEditHtml({
    bounty,
    tags,
    boardLink,
    username: session.username,
    errors: failure?.errors ?? {},
    values: failure?.values,
    message,
  });
  res.writeHead(failure ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// POST /bounties/:id/edit — name/description/reward only. Status changes go
// through handleChangeBountyStatus below (its own confirmation), not a
// status field on this form.
async function handleEditBounty(req, res, session, client, id) {
  const bounty = await getBountyById(id);
  if (!bounty) {
    notFound(res);
    return;
  }

  let params;
  try {
    params = new URLSearchParams(await readBody(req));
  } catch (err) {
    handleBountyError(res, err);
    return;
  }

  const name = (params.get('name') || '').trim();
  const description = (params.get('description') || '').trim();
  const reward = (params.get('reward') || '').trim();
  const donatorName = (params.get('donator_name') || '').trim();
  const prizeTypeRaw = params.get('prize_type') || '';
  const prizeType = VALID_PRIZE_TYPES.includes(prizeTypeRaw) ? prizeTypeRaw : '';
  const tierRaw = params.get('tier') || '';
  const tier = VALID_TIERS.includes(tierRaw) ? tierRaw : '';
  const groupTypeRaw = params.get('group_type') || '';
  const groupType = VALID_GROUP_TYPES.includes(groupTypeRaw) ? groupTypeRaw : '';
  const claimTypeRaw = params.get('claim_type') || '';
  const claimType = VALID_CLAIM_TYPES.includes(claimTypeRaw) ? claimTypeRaw : '';

  const errors = validateFields({ name, description, reward, donatorName, prizeType, tier, groupType, claimType });
  if (Object.keys(errors).length) {
    await handleEditBountyPage(req, res, session, client, id, { errors, values: { name, description, reward, donator_name: donatorName, prize_type: prizeType, tier, group_type: groupType, claim_type: claimType } });
    return;
  }

  if (bounty.status === 'approved' || bounty.status === 'claimed') {
    const conflict = await findTitleConflict(name, id);
    if (conflict) {
      await handleEditBountyPage(req, res, session, client, id, {
        errors: { name: `"${conflict.name}" is already approved or claimed — pick a different name.` },
        values: { name, description, reward, donator_name: donatorName, prize_type: prizeType, tier, group_type: groupType, claim_type: claimType },
      });
      return;
    }
  }

  try {
    await updateBounty(id, { name, description, reward, donatorName: donatorName || null, prizeType: prizeType || null, tier: tier || null, groupType: groupType || null, claimType: claimType || null });
    let warnText = '';
    if (bounty.status === 'approved') {
      const updated = await getBountyById(id);
      const result = await syncApprovedBoardPost(client, updated);
      if (!result.ok) warnText = ` Board post wasn't updated: ${result.reason}`;
    }
    redirectTo(res, bountyEditRedirect(id, `Saved.${warnText}`, Boolean(warnText)), 303);
  } catch (err) {
    console.error('Failed to save bounty edit:', err);
    await handleEditBountyPage(req, res, session, client, id, {
      errors: {},
      values: { name, description, reward, donator_name: donatorName, prize_type: prizeType, tier, group_type: groupType, claim_type: claimType },
      message: { text: 'Something went wrong saving — try again.', warn: true },
    });
  }
}

// POST /bounties/:id/status — free status change among pending/approved/
// denied/cancelled, any to any, from ANY current status including claimed
// (matches src/styleGuide/bounties.js's "Change Status" control, revealed
// via the same inline confirm the user asked for instead of a browser
// confirm() popup). 'claimed' is deliberately not a valid TARGET: claimer_id
// is only ever set by the real Discord claim flow (src/db.js claimBounty),
// and this route has no field to collect one, so setting a bounty to
// "claimed" here would leave that column blank while the status said
// otherwise. Moving a currently-claimed bounty AWAY (e.g. to undo a
// wrongly-processed claim) is fine — claimer_id/claimed_at are just left as
// historical leftovers, not cleared.
async function handleChangeBountyStatus(req, res, session, client, id) {
  const bounty = await getBountyById(id);
  if (!bounty) {
    notFound(res);
    return;
  }

  let params;
  try {
    params = new URLSearchParams(await readBody(req));
  } catch (err) {
    handleBountyError(res, err);
    return;
  }

  const newStatus = params.get('status');
  if (!ALLOWED_STATUS_TARGETS.includes(newStatus)) {
    redirectTo(res, bountyEditRedirect(id, 'Not a valid status to change to.', true), 303);
    return;
  }
  if (newStatus === bounty.status) {
    redirectTo(res, bountyEditRedirect(id, `Already ${newStatus}.`, true), 303);
    return;
  }
  if (newStatus === 'approved') {
    const conflict = await findTitleConflict(bounty.name, id);
    if (conflict) {
      redirectTo(res, bountyEditRedirect(id, `Can't move to Approved — "${conflict.name}" already uses this name.`, true), 303);
      return;
    }
  }

  try {
    // Commit the status change FIRST, guarded on the status we read at the
    // top — if staff approved/denied this same bounty from a Discord ticket
    // in the meantime, the guard fails and we bail out having touched
    // nothing. Doing the DB write before the Discord side effects also means
    // a failed write can't leave us having already pulled the board post.
    const updated = await setBountyStatus(id, newStatus, session.id, bounty.status);
    if (!updated) {
      redirectTo(
        res,
        bountyEditRedirect(id, `Someone else changed this bounty while you were looking at it — it's no longer ${bounty.status}. Nothing was changed; check the current status and try again.`, true),
        303,
      );
      return;
    }

    // Only now touch Discord. Leaving 'approved' pulls the old post off the
    // board — using `bounty` (the pre-change row), since that's the one that
    // still has board_channel_id/board_message_id to look up.
    let warnText = '';
    if (bounty.status === 'approved' && newStatus !== 'approved') {
      await removeBoardPost(client, bounty);
    }
    if (newStatus === 'approved') {
      const result = await syncApprovedBoardPost(client, updated);
      if (!result.ok) warnText = ` Couldn't post to the board: ${result.reason}`;
    }

    redirectTo(res, bountyEditRedirect(id, `Status changed to ${newStatus}.${warnText}`, Boolean(warnText)), 303);
  } catch (err) {
    console.error('Failed to change bounty status:', err);
    redirectTo(res, bountyEditRedirect(id, 'Something went wrong changing the status.', true), 303);
  }
}

module.exports = {
  handleBountiesList,
  handleNewBountyPage,
  handleCreateBounty,
  handleEditBountyPage,
  handleEditBounty,
  handleChangeBountyStatus,
};
