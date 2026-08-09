// Route handlers for the bounty admin pages (list / new / edit / approve /
// deny / cancel) — split out of server.js because these, unlike everything
// else on the style-guide site, need the live Discord `client` to keep an
// approved bounty's board post in sync with edits made here, on top of the
// usual DB read/write. src/styleGuide/bounties.js does the HTML; this file
// does the async work and hands it data to render.
const {
  getBounties, getBountyById, createBounty, updateBounty, findTitleConflict,
  approveBounty, denyBounty, cancelBounty, setBoardMessage, getBoardChannel,
} = require('../db');
const { buildBountyEmbed } = require('../bountyCard');
const { buildBountiesListHtml, buildBountyNewHtml, buildBountyEditHtml, LIMITS } = require('./bounties');
const { readBody, redirectTo } = require('./httpUtil');

const VALID_STATUSES = ['all', 'pending', 'approved', 'claimed', 'denied', 'cancelled'];

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

// Resolves a batch of Discord user ids to display names up front, so
// bounties.js's rendering stays synchronous/pure — a fetch failure (left
// the server, deleted account) just falls back to showing the raw id.
async function resolveUserTags(client, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const entries = await Promise.all(unique.map(async (id) => {
    const user = await client.users.fetch(id).catch(() => null);
    return [id, user ? user.username : null];
  }));
  return Object.fromEntries(entries.filter(([, tag]) => tag));
}

async function buildApprovedEmbedFor(client, bounty) {
  const requester = await client.users.fetch(bounty.requester_id).catch(() => null);
  return buildBountyEmbed({
    name: bounty.name,
    description: bounty.description,
    amountRaw: bounty.reward,
    user: requester ?? { id: bounty.requester_id, displayAvatarURL: () => null },
    status: 'approved',
  });
}

// Edits the bounty's existing board post to match its current fields, or
// posts a fresh one (and records it) if it isn't tracked yet — e.g. it was
// just approved for the first time, or the old post was deleted out from
// under us. Never throws; failures come back as { ok: false, reason }, so a
// Discord hiccup doesn't block the DB save that triggered this.
async function syncApprovedBoardPost(client, bounty) {
  const embed = await buildApprovedEmbedFor(client, bounty);

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
// off the board, same as the normal claim-approval flow already does.
async function removeBoardPost(client, bounty) {
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

function validateFields({ name, description, reward }) {
  const errors = {};
  if (!name) errors.name = 'Cannot be blank.';
  else if (name.length > LIMITS.name) errors.name = `Too long — ${name.length} characters, max is ${LIMITS.name}.`;
  if (!description) errors.description = 'Cannot be blank.';
  else if (description.length > LIMITS.description) {
    errors.description = `Too long — ${description.length} characters, max is ${LIMITS.description}.`;
  }
  if (reward.length > LIMITS.reward) errors.reward = `Too long — ${reward.length} characters, max is ${LIMITS.reward}.`;
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
    const bounties = await getBounties(filterStatus);
    const tags = await resolveUserTags(client, bounties.flatMap((b) => [b.requester_id, b.claimer_id]));

    const msg = url.searchParams.get('msg');
    const message = msg ? { text: msg, warn: url.searchParams.get('warn') === '1' } : undefined;

    const html = buildBountiesListHtml({ bounties, tags, filterStatus, username: session.username, message });
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
  const initialStatus = params.get('initialStatus') === 'approved' ? 'approved' : 'pending';

  const errors = validateFields({ name, description, reward });
  if (Object.keys(errors).length) {
    handleNewBountyPage(res, session, { errors, values: { name, description, reward } });
    return;
  }

  if (initialStatus === 'approved') {
    const conflict = await findTitleConflict(name);
    if (conflict) {
      handleNewBountyPage(res, session, {
        errors: { name: `"${conflict.name}" is already approved or claimed — pick a different name.` },
        values: { name, description, reward },
      });
      return;
    }
  }

  try {
    // requester_id is NOT NULL and there's no real player behind an
    // admin-created bounty, so it's attributed to whichever admin made it.
    const id = await createBounty({ name, description, reward, requesterId: session.id });
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
    handleNewBountyPage(res, session, { errors: {}, values: { name, description, reward } });
  }
}

// GET /bounties/:id/edit
async function handleEditBountyPage(req, res, session, client, id, failure) {
  const bounty = await getBountyById(id);
  if (!bounty) {
    notFound(res);
    return;
  }

  const tags = await resolveUserTags(client, [bounty.requester_id, bounty.claimer_id]);
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
// through the dedicated approve/deny/cancel actions below, each with its
// own confirmation, rather than a freeform status field here.
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

  const errors = validateFields({ name, description, reward });
  if (Object.keys(errors).length) {
    await handleEditBountyPage(req, res, session, client, id, { errors, values: { name, description, reward } });
    return;
  }

  if (bounty.status === 'approved' || bounty.status === 'claimed') {
    const conflict = await findTitleConflict(name, id);
    if (conflict) {
      await handleEditBountyPage(req, res, session, client, id, {
        errors: { name: `"${conflict.name}" is already approved or claimed — pick a different name.` },
        values: { name, description, reward },
      });
      return;
    }
  }

  try {
    await updateBounty(id, { name, description, reward });
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
      values: { name, description, reward },
      message: { text: 'Something went wrong saving — try again.', warn: true },
    });
  }
}

// POST /bounties/:id/approve
async function handleApproveBounty(req, res, session, client, id) {
  const bounty = await getBountyById(id);
  if (!bounty) {
    notFound(res);
    return;
  }
  if (bounty.status !== 'pending') {
    redirectTo(res, bountyEditRedirect(id, 'Only a pending bounty can be approved.', true), 303);
    return;
  }
  const conflict = await findTitleConflict(bounty.name, id);
  if (conflict) {
    redirectTo(res, bountyEditRedirect(id, `Can't approve — "${conflict.name}" already uses this name.`, true), 303);
    return;
  }
  try {
    await approveBounty(id, session.id);
    const updated = await getBountyById(id);
    const result = await syncApprovedBoardPost(client, updated);
    const msg = result.ok ? 'Approved and posted to the board.' : `Approved, but couldn't post to the board: ${result.reason}`;
    redirectTo(res, bountyEditRedirect(id, msg, !result.ok), 303);
  } catch (err) {
    console.error('Failed to approve bounty:', err);
    redirectTo(res, bountyEditRedirect(id, 'Something went wrong approving this bounty.', true), 303);
  }
}

// POST /bounties/:id/deny
async function handleDenyBounty(req, res, session, client, id) {
  const bounty = await getBountyById(id);
  if (!bounty) {
    notFound(res);
    return;
  }
  if (bounty.status !== 'pending') {
    redirectTo(res, bountyEditRedirect(id, 'Only a pending bounty can be denied.', true), 303);
    return;
  }
  try {
    await denyBounty(id, session.id);
    redirectTo(res, bountyEditRedirect(id, 'Denied.', false), 303);
  } catch (err) {
    console.error('Failed to deny bounty:', err);
    redirectTo(res, bountyEditRedirect(id, 'Something went wrong denying this bounty.', true), 303);
  }
}

// POST /bounties/:id/cancel — soft-delete (src/db.js cancelBounty), pulling
// it off the board first if it was posted.
async function handleCancelBounty(req, res, session, client, id) {
  const bounty = await getBountyById(id);
  if (!bounty) {
    notFound(res);
    return;
  }
  if (bounty.status === 'cancelled' || bounty.status === 'claimed') {
    redirectTo(res, bountyEditRedirect(id, 'This bounty cannot be cancelled from here.', true), 303);
    return;
  }
  try {
    if (bounty.status === 'approved') await removeBoardPost(client, bounty);
    await cancelBounty(id, session.id);
    redirectTo(res, `/bounties?status=all&msg=${encodeURIComponent(`"${bounty.name}" was cancelled.`)}`, 303);
  } catch (err) {
    console.error('Failed to cancel bounty:', err);
    redirectTo(res, bountyEditRedirect(id, 'Something went wrong cancelling this bounty.', true), 303);
  }
}

module.exports = {
  handleBountiesList,
  handleNewBountyPage,
  handleCreateBounty,
  handleEditBountyPage,
  handleEditBounty,
  handleApproveBounty,
  handleDenyBounty,
  handleCancelBounty,
};
