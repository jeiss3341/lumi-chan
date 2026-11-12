// Path to Glory · "your session is coming up" pings.
//
// Every minute: finds booked sessions (requests with status 'accepted') starting
// within the coach's own ping time (coaches.ping_minutes on the site's mentor
// desk, default 20 minutes; 0 = off), and @s that coach with a boop from Lumi in
// the channel set by PTG_PING_CHANNEL_ID (Railway variable). Unset = pings off.
//
// Each ping is written to ptg_pings (request id + the session's start) BEFORE the
// message goes out, so a restart or a slow pass never pings twice. A session
// that's moved to a new time gets a fresh ping for the new time. If Lumi was down
// until after a session started, she skips it rather than pinging late.
const { db } = require('./tracker');

const LUMI_HELLO_EMOJI = '<:LumiHello:1536577693208940594>';   // same application emoji as her hello/boop replies

async function due(pg) {
  const { rows } = await pg.query(
    `select r.id, r.kind, r.starts_at, r.ends_at, r.note, r.by_coach,
            coalesce(nullif(c.name, ''), 'Coach') as coach_name, cp.discord_id as coach_discord,
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

// one message in the ping channel: @coach, then the boop (only the coach is pinged, never @everyone or roles)
async function send(channel, s) {
  const at = s.coach_discord ? `<@${s.coach_discord}> ` : '';
  if (!at) console.error(`[ptg] ${s.coach_name} isn't linked to a Discord account; posting their session ping without an @.`);
  try {
    await channel.send({
      content: at + message(s),
      allowedMentions: { users: s.coach_discord ? [s.coach_discord] : [] },
    });
  } catch (err) {
    console.error(`[ptg] session ping for ${s.coach_name} failed:`, err.message);
  }
}

async function pass(client) {
  const channel = await client.channels.fetch(process.env.PTG_PING_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) throw new Error('PTG_PING_CHANNEL_ID is not a text channel Lumi can see.');
  const pg = db();
  for (const s of await due(pg)) {
    // claim it first: if the row already exists, another pass got there
    const { rowCount } = await pg.query(
      `insert into public.ptg_pings (request_id, starts_at) values ($1, $2) on conflict do nothing`,
      [s.id, s.starts_at],
    );
    if (rowCount) await send(channel, s);
  }
}

function startSessionPings(client) {
  if (!process.env.PTG_DATABASE_URL) {
    console.error('[ptg] PTG_DATABASE_URL is not set — session pings are off.');
    return;
  }
  if (!process.env.PTG_PING_CHANNEL_ID) {
    console.error('[ptg] PTG_PING_CHANNEL_ID is not set — session pings are off.');
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
  console.log('[ptg] session pings on, checked every minute.');
  run();
  setInterval(run, 60 * 1000);
}

// A test: when PTG_PING_TEST_USER_ID (Railway variable) is set, Lumi DMs that person a sample session ping each
// time she starts, so you can see what coaches get. Made-up session, no database needed. Remove the variable after.
async function sendTestPing(client) {
  const id = (process.env.PTG_PING_TEST_USER_ID || '').trim();
  if (!/^\d{15,22}$/.test(id)) return;
  const sample = {
    kind: 'individual', note: 'This is only a test. Real pings go in the ping channel.',
    starts_at: new Date(Date.now() + 20 * 60 * 1000), ends_at: new Date(Date.now() + 80 * 60 * 1000),
    coach_name: 'Coach', player_name: 'a player', team_name: 'Test Team',
  };
  try {
    const user = await client.users.fetch(id);
    await user.send(`<@${id}> ${message(sample)}`);
    console.log('[ptg] test session ping sent to PTG_PING_TEST_USER_ID.');
  } catch (err) {
    console.error('[ptg] test session ping failed (are your DMs open to server members?):', err.message);
  }
}

module.exports = { startSessionPings, sendTestPing, message };
