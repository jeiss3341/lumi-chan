// Path to Glory · "your session is coming up" pings.
//
// Every minute: finds booked sessions (requests with status 'accepted') starting
// within the coach's own ping time (coaches.ping_minutes on the site's mentor
// desk, default 20 minutes; 0 = off), and DMs that coach — mentor or assistant —
// a boop from Lumi. Nothing to set in Railway.
//
// The coach's Discord id comes from their linked site account, or, if they've
// never logged in, from the access list (access_list.coach_id).
//
// Each ping is written to ptg_pings (request id + the session's start) BEFORE the
// DM goes out, so a restart or a slow pass never pings twice. A session that's
// moved to a new time gets a fresh ping for the new time. If Lumi was down until
// after a session started, she skips it rather than pinging late.
//
// Optional: if a coach's DMs are closed and PTG_PING_CHANNEL_ID (Railway variable)
// is set, she @s them in that channel instead. Unset: she just logs it.
const { db } = require('./tracker');

const LUMI_HELLO_EMOJI = '<:LumiHello:1536577693208940594>';   // same application emoji as her hello/boop replies

async function due(pg) {
  const { rows } = await pg.query(
    `select r.id, r.kind, r.starts_at, r.ends_at, r.note, r.by_coach,
            -- the slot's name; blank on some slots (the site fills those in from its own files), so then their Discord name
            coalesce(nullif(c.name, ''), nullif(cp.display_name, ''), nullif(cp.username, ''), 'Coach') as coach_name,
            coalesce(nullif(cp.discord_id, ''),
                     (select a.discord_id from public.access_list a where a.coach_id = c.id limit 1)) as coach_discord,
            coalesce(nullif(p.display_name, ''), nullif(p.username, ''), 'a player') as player_name,
            (select t.name from public.teams t
               where (r.by_coach and t.coach_id = r.coach_id) or (not r.by_coach and r.requester_id = any (t.member_ids))
               order by t.sort limit 1) as team_name
       from public.requests r
       join public.coaches c on c.id = r.coach_id
       left join public.profiles cp on cp.id = c.profile_id
       left join public.profiles p on p.id = r.requester_id
      where r.status = 'accepted'
        and c.ping_minutes > 0
        and r.starts_at > now()
        and r.starts_at <= now() + make_interval(mins => c.ping_minutes)
        and not exists (select 1 from public.ptg_pings x where x.request_id = r.id and x.starts_at = r.starts_at)
      order by r.starts_at`,
  );
  return rows;
}

function message(s) {
  const t1 = Math.floor(new Date(s.starts_at).getTime() / 1000);
  const t2 = Math.floor(new Date(s.ends_at).getTime() / 1000);
  const who = s.kind === 'team'
    ? `a **team review** with **${s.team_name || s.player_name}**`
    : `an **individual session** with **${s.player_name}**${s.team_name ? ` (${s.team_name})` : ''}`;
  const note = (s.note || '').trim();
  return [
    `Boop! ${LUMI_HELLO_EMOJI} Hi ${s.coach_name}~ just a little nudge from Lumi!`,
    `You have ${who} starting <t:${t1}:R> (<t:${t1}:t> to <t:${t2}:t>).`,
    note ? `> ${note.slice(0, 300).replace(/\n+/g, ' ')}` : null,
  ].filter(Boolean).join('\n');
}

async function send(client, s) {
  if (!s.coach_discord) {
    console.error(`[ptg] no Discord id for ${s.coach_name} (not logged in, not on the access list); no session ping.`);
    return;
  }
  const text = message(s);
  try {
    const user = await client.users.fetch(s.coach_discord);
    await user.send(text);
    return;
  } catch (err) {
    console.error(`[ptg] couldn't DM ${s.coach_name} about their session (DMs closed?):`, err.message);
  }
  const channelId = process.env.PTG_PING_CHANNEL_ID;
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;
    await channel.send({ content: `<@${s.coach_discord}> ${text}`, allowedMentions: { users: [s.coach_discord] } });
  } catch (err) {
    console.error('[ptg] backup session ping in PTG_PING_CHANNEL_ID failed:', err.message);
  }
}

async function pass(client) {
  const pg = db();
  for (const s of await due(pg)) {
    // claim it first: if the row already exists, another pass got there
    const { rowCount } = await pg.query(
      `insert into public.ptg_pings (request_id, starts_at) values ($1, $2) on conflict do nothing`,
      [s.id, s.starts_at],
    );
    if (rowCount) await send(client, s);
  }
}

function startSessionPings(client) {
  if (!process.env.PTG_DATABASE_URL) {
    console.error('[ptg] PTG_DATABASE_URL is not set — session pings are off.');
    return;
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await pass(client); }
    catch (err) { console.error('[ptg] session ping pass failed (will retry next minute):', err.message); }
    finally { running = false; }
  };
  console.log('[ptg] session pings on (DMs to coaches), checked every minute.');
  run();
  setInterval(run, 60 * 1000);
}

module.exports = { startSessionPings, message };
