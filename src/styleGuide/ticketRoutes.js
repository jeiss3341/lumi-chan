// Route handlers for the admin Tickets pages (list + detail + archive
// settings) — split out of server.js for the same reason bountyRoutes.js
// is: these need the live Discord `client` to do their job, unlike
// everything else on the style-guide site.
//
// There's no database table for tickets (see src/styleGuide/tickets.js's
// header comment) — every ticket shown here is a real Discord channel,
// enumerated fresh from the configured ticket/archive categories on every
// page load. Nothing is cached across requests.
const {
  getTicketCategory, getClaimTicketCategory, getHelpTicketCategory,
  getRequestArchiveCategory, getClaimArchiveCategory, getHelpArchiveCategory,
  setRequestArchiveCategory, setClaimArchiveCategory, setHelpArchiveCategory,
  clearSetting,
} = require('../db');
const { buildTicketsListHtml, buildTicketDetailHtml } = require('./tickets');
const { readBody, redirectTo } = require('./httpUtil');

const VALID_TYPES = ['all', 'request', 'claim', 'help'];
const VALID_STATUSES = ['all', 'active', 'archived'];

async function fetchCategories() {
  const [reqCat, claimCat, helpCat, reqArchive, claimArchive, helpArchive] = await Promise.all([
    getTicketCategory(), getClaimTicketCategory(), getHelpTicketCategory(),
    getRequestArchiveCategory(), getClaimArchiveCategory(), getHelpArchiveCategory(),
  ]);
  return { reqCat, claimCat, helpCat, reqArchive, claimArchive, helpArchive };
}

// Every category id we know about, tried in turn until one resolves to a
// real channel — there's no stored GUILD_ID (this bot only ever runs in
// one guild), so the guild is derived from whichever configured category
// actually exists. Falls back to "first guild the bot is in" if nothing's
// configured yet at all.
async function resolveGuild(client, cats) {
  for (const id of Object.values(cats)) {
    if (!id) continue;
    const channel = await client.channels.fetch(id).catch(() => null);
    if (channel?.guild) return channel.guild;
  }
  return client.guilds.cache.first() ?? null;
}

function classifyChannel(channel, cats) {
  if (channel.parentId === cats.reqCat) return { type: 'request', status: 'active' };
  if (channel.parentId === cats.claimCat) return { type: 'claim', status: 'active' };
  if (channel.parentId === cats.helpCat) return { type: 'help', status: 'active' };
  if (channel.parentId === cats.reqArchive) return { type: 'request', status: 'archived' };
  if (channel.parentId === cats.claimArchive) return { type: 'claim', status: 'archived' };
  if (channel.parentId === cats.helpArchive) return { type: 'help', status: 'archived' };
  return { type: 'unknown', status: 'active' };
}

async function listTicketChannels(client) {
  const cats = await fetchCategories();
  const guild = await resolveGuild(client, cats);
  if (!guild) return [];

  // Guaranteed-fresh channel list — the Guilds intent keeps the cache
  // reasonably in sync already, but this is only called when an admin
  // loads the page, so the extra round trip is cheap insurance.
  await guild.channels.fetch();

  const collect = (categoryId, type, status) => {
    if (!categoryId) return [];
    return [...guild.channels.cache.values()]
      .filter((c) => c.parentId === categoryId && typeof c.isTextBased === 'function' && c.isTextBased())
      .map((c) => ({ id: c.id, name: c.name, type, status, createdAt: c.createdTimestamp, topic: c.topic || null }));
  };

  return [
    ...collect(cats.reqCat, 'request', 'active'),
    ...collect(cats.claimCat, 'claim', 'active'),
    ...collect(cats.helpCat, 'help', 'active'),
    ...collect(cats.reqArchive, 'request', 'archived'),
    ...collect(cats.claimArchive, 'claim', 'archived'),
    ...collect(cats.helpArchive, 'help', 'archived'),
  ].sort((a, b) => b.createdAt - a.createdAt);
}

// A short text stand-in for a rich embed (the bounty card, buttons, etc.) —
// full embed rendering is out of scope here, this just tells the admin
// something was there and roughly what it said.
function summarizeEmbed(embed) {
  const parts = [];
  if (embed.title) parts.push(embed.title);
  if (embed.description) parts.push(embed.description.slice(0, 200));
  return parts.length ? `📋 ${parts.join(' — ')}` : '📋 (embed)';
}

async function fetchTicketDetail(client, channelId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) return null;

  const cats = await fetchCategories();
  const { type, status } = classifyChannel(channel, cats);

  const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const sorted = fetched ? [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp) : [];

  return {
    ticket: {
      id: channel.id,
      name: channel.name,
      type,
      status,
      discordLink: `https://discord.com/channels/${channel.guild.id}/${channel.id}`,
    },
    messages: sorted.map((m) => ({
      author: m.member?.displayName || m.author?.username || 'Unknown',
      avatarUrl: m.author?.displayAvatarURL?.() ?? null,
      content: m.content || '',
      createdAt: m.createdTimestamp,
      embedSummary: m.embeds?.[0] ? summarizeEmbed(m.embeds[0]) : null,
      attachments: [...m.attachments.values()].map((a) => ({ url: a.url, name: a.name, contentType: a.contentType })),
    })),
  };
}

// GET /tickets
async function handleTicketsList(req, res, session, client) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const requestedType = url.searchParams.get('type') || 'all';
    const requestedStatus = url.searchParams.get('status') || 'all';
    const type = VALID_TYPES.includes(requestedType) ? requestedType : 'all';
    const status = VALID_STATUSES.includes(requestedStatus) ? requestedStatus : 'all';

    const all = await listTicketChannels(client);
    const groups = all.filter((t) => (type === 'all' || t.type === type) && (status === 'all' || t.status === status));

    const cats = await fetchCategories();
    const archiveSettings = { request: cats.reqArchive, claim: cats.claimArchive, help: cats.helpArchive };

    const msg = url.searchParams.get('msg');
    const message = msg ? { text: msg, warn: url.searchParams.get('warn') === '1' } : undefined;

    const html = buildTicketsListHtml({ groups, type, status, archiveSettings, username: session.username, message });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    console.error('Failed to render tickets list:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Something went wrong loading tickets.');
  }
}

// GET /tickets/:channelId
async function handleTicketDetail(req, res, session, client, channelId) {
  try {
    const detail = await fetchTicketDetail(client, channelId);
    if (!detail) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Ticket not found — it may have been deleted, or the bot can no longer see it.');
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    const msg = url.searchParams.get('msg');
    const message = msg ? { text: msg, warn: url.searchParams.get('warn') === '1' } : undefined;

    const html = buildTicketDetailHtml({ ...detail, username: session.username, message });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    console.error('Failed to render ticket detail:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Something went wrong loading this ticket.');
  }
}

// POST /tickets/archive-settings — a blank field clears that category
// (falls back to delete-on-close for that ticket type, same as unset).
async function handleSaveArchiveSettings(req, res) {
  let params;
  try {
    params = new URLSearchParams(await readBody(req));
  } catch (err) {
    console.error('Failed to save archive settings:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Something went wrong.');
    return;
  }

  const entries = [
    ['request_archive_category', params.get('request_archive_category'), setRequestArchiveCategory],
    ['claim_archive_category', params.get('claim_archive_category'), setClaimArchiveCategory],
    ['help_archive_category', params.get('help_archive_category'), setHelpArchiveCategory],
  ];

  try {
    for (const [key, value, setter] of entries) {
      const trimmed = (value || '').trim();
      if (trimmed) await setter(trimmed);
      else await clearSetting(key);
    }
    redirectTo(res, `/tickets?msg=${encodeURIComponent('Archive settings saved.')}`, 303);
  } catch (err) {
    console.error('Failed to save archive settings:', err);
    redirectTo(res, `/tickets?msg=${encodeURIComponent('Something went wrong saving those settings.')}&warn=1`, 303);
  }
}

module.exports = { handleTicketsList, handleTicketDetail, handleSaveArchiveSettings };
