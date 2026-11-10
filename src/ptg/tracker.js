// Path to Glory · [PTG] stream tracker.
//
// Every 3 minutes: looks up the Twitch channels of every Path to Glory coach
// (coaches.twitch in the PTG Supabase database, typed in by staff on the
// site), and for each coach live in Eternal Return with "[PTG]" in the title:
//   - one ptg_vods row per broadcast (keyed by Twitch's stream id)
//   - one ptg_marks row per stretch the title had [PTG] in it — taking [PTG]
//     out closes the mark, putting it back opens a new one
//   - once Twitch has an archive video for the broadcast, its id, thumbnail
//     and an estimated delete date
// The site (projectlumi.space → VODs) reads those rows; coaches file them.
//
// Writes go straight to the PTG database over PTG_DATABASE_URL (Supabase's
// Postgres connection string, set in Railway — never in code or chat). That
// connection skips the site's row rules, which is what lets Lumi write.
// Everything is restart-safe: open broadcasts and marks live in the database,
// not in memory.
const { Pool } = require('pg');
const { getAppAccessToken, ETERNAL_RETURN_GAME_ID } = require('../coastalClash/twitchApi');

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TICK_MINUTES = 3;
const PTG_TAG = /\[\s*ptg\s*\]/i;
// Twitch keeps past broadcasts 7 days for most streamers, 60 for partners (14
// for some affiliates); Helix doesn't say which, so the site shows this estimate.
const VOD_DAYS = parseInt(process.env.PTG_VOD_DAYS || '7', 10);

let pool = null;
function db() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.PTG_DATABASE_URL,
      ssl: { rejectUnauthorized: false },   // Supabase needs SSL; its pooler's certificate isn't in Node's store
      max: 3,
    });
    pool.on('error', (err) => console.error('[ptg] database pool error:', err.message));
  }
  return pool;
}

async function helix(path, params) {
  const token = await getAppAccessToken();
  const res = await fetch(`https://api.twitch.tv/helix/${path}?${params.toString()}`, {
    headers: { 'Client-Id': TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.data) throw new Error(`Twitch ${path} failed: ${data.message || res.status}`);
  return data.data;
}

// up to 100 logins per call; returns the raw Helix entries
async function inBatches(path, key, values) {
  const out = [];
  for (let i = 0; i < values.length; i += 100) {
    const params = new URLSearchParams();
    for (const v of values.slice(i, i + 100)) params.append(key, v);
    out.push(...(await helix(path, params)));
  }
  return out;
}

const cleanLogin = (raw) => {
  const t = String(raw || '').trim().replace(/\/+$/, '');
  const m = t.match(/twitch\.tv\/([^/?#\s]+)/i);
  return (m ? m[1] : t.replace(/^@/, '')).toLowerCase();
};

// One pass. Returns who's live with [PTG] right now, for the Discord board.
async function tick() {
  const pg = db();
  const { rows: coaches } = await pg.query(`select id, name, twitch from public.coaches where twitch <> ''`);
  const byLogin = new Map();
  for (const c of coaches) { const l = cleanLogin(c.twitch); if (l) byLogin.set(l, c); }
  const logins = [...byLogin.keys()];

  // live streams of those channels, kept only when in Eternal Return with [PTG] in the title
  const streams = logins.length ? await inBatches('streams', 'user_login', logins) : [];
  const tagged = streams.filter((s) => s.game_id === ETERNAL_RETURN_GAME_ID && PTG_TAG.test(s.title || ''));
  const now = new Date();
  const started = [];   // coaches who just went live with [PTG], for the go-live announcements

  for (const s of tagged) {
    const coach = byLogin.get(s.user_login.toLowerCase());
    if (!coach) continue;
    // the broadcast (created the first time [PTG] shows up in it)
    const { rows: [vod] } = await pg.query(
      `insert into public.ptg_vods (coach_id, twitch_login, stream_id, title, started_at)
         values ($1, $2, $3, $4, $5)
       on conflict (stream_id) do update set title = excluded.title, ended_at = null
       returning id, (xmax = 0) as inserted`,
      [coach.id, s.user_login.toLowerCase(), s.id, (s.title || '').slice(0, 200), s.started_at],
    );
    // a brand-new broadcast is a go-live, unless the same coach went live in the last 30 minutes
    // (a stream that crashed and restarted gets a new id, and shouldn't be announced twice)
    if (vod.inserted) {
      const { rows: [recent] } = await pg.query(
        `select 1 from public.ptg_vods where coach_id = $1 and id <> $2 and created_at > now() - interval '30 minutes' limit 1`,
        [coach.id, vod.id],
      );
      if (!recent) started.push({ coach, stream: s });
    }
    // an open mark while [PTG] stays in the title
    await pg.query(
      `insert into public.ptg_marks (vod_id, started_at)
         select $1, $2 where not exists (select 1 from public.ptg_marks where vod_id = $1 and ended_at is null)`,
      [vod.id, now],
    );
  }

  // close marks whose broadcast lost [PTG] (or ended), and broadcasts that ended
  const liveIds = tagged.map((s) => s.id);
  const anyLiveIds = streams.map((s) => s.id);
  await pg.query(
    `update public.ptg_marks m set ended_at = $2
       from public.ptg_vods v
      where m.vod_id = v.id and m.ended_at is null and not (v.stream_id = any($1::text[]))`,
    [liveIds, now],
  );
  await pg.query(
    `update public.ptg_vods set ended_at = $2 where ended_at is null and not (stream_id = any($1::text[]))`,
    [anyLiveIds, now],
  );

  await attachVods(pg);
  const live = tagged.map((s) => ({ coach: byLogin.get(s.user_login.toLowerCase()), stream: s }));
  live.started = started;
  return live;
}

// Twitch makes the archive video while the stream runs; match it by stream id.
async function attachVods(pg) {
  const { rows: pending } = await pg.query(
    `select id, twitch_login, stream_id from public.ptg_vods
      where vod_id is null and started_at > now() - interval '3 days'`,
  );
  if (!pending.length) return;
  const logins = [...new Set(pending.map((v) => v.twitch_login))];
  const users = await inBatches('users', 'login', logins);
  for (const u of users) {
    const videos = await helix('videos', new URLSearchParams({ user_id: u.id, type: 'archive', first: '20' }));
    for (const v of pending.filter((p) => p.twitch_login === u.login.toLowerCase())) {
      const video = videos.find((x) => String(x.stream_id) === String(v.stream_id));
      if (!video) continue;
      const thumb = (video.thumbnail_url || '').replace('%{width}', '640').replace('%{height}', '360') || null;
      const expires = new Date(new Date(video.created_at).getTime() + VOD_DAYS * 864e5);
      await pg.query(
        `update public.ptg_vods set vod_id = $2, thumbnail_url = $3, expires_at = case when saved then null else $4 end where id = $1`,
        [v.id, video.id, thumb, expires],
      );
    }
  }
}

// Runs on round marks (:00, :03, :06…), so restarts don't drift the cadence.
function startPtgTracker(onLive) {
  if (!process.env.PTG_DATABASE_URL) {
    console.error('[ptg] PTG_DATABASE_URL is not set — the [PTG] stream tracker is off.');
    return;
  }
  if (!TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
    console.error('[ptg] TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are not set — the [PTG] stream tracker is off.');
    return;
  }
  let running = false;
  const run = async () => {
    if (running) return;   // a slow pass never overlaps the next one
    running = true;
    try {
      const live = await tick();
      if (onLive) await onLive(live);
    } catch (err) {
      console.error('[ptg] tracker pass failed (will retry next pass):', err.message);
    } finally {
      running = false;
    }
  };
  console.log(`[ptg] [PTG] stream tracker on, every ${TICK_MINUTES} minutes.`);
  run();
  let last = -1;
  setInterval(() => {
    const m = new Date().getMinutes();
    if (m % TICK_MINUTES === 0 && m !== last) { last = m; run(); }
  }, 20 * 1000);
}

module.exports = { startPtgTracker, tick, cleanLogin };
