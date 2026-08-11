// Shared Discord identity resolution for the admin pages (bounties +
// tickets). Nickname comes from the live guild member (this bot only ever
// runs in one guild — see ticketRoutes.js resolveGuild); username always
// comes from the global user fetch, since a member lookup alone doesn't
// cover users who've left the server. A user who's left and deleted their
// account resolves to null and callers fall back to showing the raw id.
async function resolveUserLabels(client, guild, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const entries = await Promise.all(unique.map(async (id) => {
    const [user, member] = await Promise.all([
      client.users.fetch(id).catch(() => null),
      guild ? guild.members.fetch(id).catch(() => null) : Promise.resolve(null),
    ]);
    if (!user) return [id, null];
    return [id, { username: user.username, nickname: member?.nickname || null }];
  }));
  return Object.fromEntries(entries.filter(([, v]) => v));
}

// The shared "Username · Nickname" display text (nickname omitted if unset
// or identical to the username) — plain text only, callers esc() it since
// this module doesn't know if it's headed into HTML or elsewhere.
function labelText({ username, nickname }) {
  return nickname && nickname !== username ? `${username} · ${nickname}` : username;
}

module.exports = { resolveUserLabels, labelText };
