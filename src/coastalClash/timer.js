// Coastal Clash leaderboard timers — same proven shape as project-lumi's
// commands/hanabi.js startTimers(): a 60s tick that fires two different
// things at two different cadences. Runs inside the already-always-on
// Discord bot process; no separate hosting/cron needed.
//
//   - Every 10 minutes: RP refresh + indanger recompute (no culling).
//   - Every 3 minutes: Twitch live-status refresh, on its own faster
//     cadence since it doesn't depend on the ER API at all.
//   - Once/day at 11:59 PM PDT: the real cull (src/coastalClash/cull.js
//     runDailyCull), auto-retried on failure, with a DM alert either way.
const { runDailyCull, refreshLeaderboardOnly, refreshTwitchOnly } = require('./cull');
const { postOrUpdateLeaderboard, postOrUpdateLiveNow, postLiveAnnouncements } = require('./embed');
const db = require('../db');

// Person to DM on cull failure/retry/self-correction. Hardcoded per the
// user's explicit instruction — this is a single specific person, not a
// configurable setting.
const ALERT_USER_ID = '220690226752913418';

// A full 74-player refresh pass takes ~3.7 min (74 x 3s API spacing) —
// against a 10-min cadence that's a comfortable ~6.3 min of buffer. Still
// keeping the isRefreshing guard below regardless: a rate-limit retry
// storm could still push a pass long enough to risk overlap, and the
// guard costs nothing when passes finish on time.
const REFRESH_INTERVAL_MINUTES = 10;
// Twitch status has zero dependency on the ER API, and a single batched
// Helix call for the whole roster is cheap/fast (no per-player spacing
// needed, unlike ER) — so it runs on its own much faster cadence,
// completely decoupled from the ER-bound refresh above.
const TWITCH_REFRESH_INTERVAL_MINUTES = 3;
const CULL_RETRY_DELAY_MS = 5 * 60 * 1000; // 5 min
const CULL_MAX_RETRIES = 6; // spans ~30 min of retrying before giving up

// PDT is a fixed UTC-7 offset for the entire event window (Aug 12-28 —
// no DST transition falls inside that range), so a manual offset is safe
// here without pulling in a timezone library this repo doesn't otherwise
// depend on. Revisit if this code is ever reused across a DST boundary.
function nowInPDT(date = new Date()) {
  return new Date(date.getTime() - 7 * 60 * 60 * 1000);
}

async function dmAlert(client, message) {
  try {
    const user = await client.users.fetch(ALERT_USER_ID);
    await user.send(message);
  } catch (err) {
    // A failed DM (privacy settings, etc.) shouldn't crash the retry loop —
    // log loudly so it's at least visible in Railway's logs.
    console.error('Coastal Clash: failed to DM alert user:', err);
  }
}

async function runDailyCullWithRetry(client) {
  for (let attempt = 1; attempt <= CULL_MAX_RETRIES; attempt++) {
    try {
      const result = await runDailyCull();
      if (result.seasonIdCorrected) {
        await dmAlert(client, `⚠️ Coastal Clash: the stored ER season ID looked stale and was auto-corrected to ${result.seasonId} during today's cull. Worth double-checking this was right.`);
      }
      if (result.refresh?.failed?.length) {
        await dmAlert(client, `⚠️ Coastal Clash: today's cull (day ${result.day}) completed, but RP fetch failed for ${result.refresh.failed.length} player(s): ${result.refresh.failed.join(', ')}. Their culled/indanger status may be stale.`);
      }
      if (result.twitchRefresh?.error) {
        console.error('Coastal Clash: Twitch refresh failed:', result.twitchRefresh.error);
      }
      console.log(`Coastal Clash: day ${result.day} cull complete. Pro culled: ${result.proCulled?.length ?? 0}, Casual culled: ${result.casualCulled?.length ?? 0}.`);
      try {
        await postOrUpdateLeaderboard(client, db);
        await postOrUpdateLiveNow(client, db);
        await postLiveAnnouncements(client, db, result.twitchRefresh?.toAnnounce ?? []);
      } catch (err) {
        console.error('Coastal Clash: failed to post/update leaderboard message after cull:', err);
      }
      return;
    } catch (err) {
      console.error(`Coastal Clash: cull attempt ${attempt}/${CULL_MAX_RETRIES} failed:`, err);
      if (attempt === CULL_MAX_RETRIES) {
        await dmAlert(client, `🚨 Coastal Clash: today's cull FAILED after ${CULL_MAX_RETRIES} attempts and needs a manual re-run (\`node scripts/updateLeaderboard.js\`). Last error: ${err.message}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, CULL_RETRY_DELAY_MS));
    }
  }
}

let timerInterval = null;
let lastCullDateKey = null;
let lastRefreshMinuteKey = null;
let lastTwitchRefreshMinuteKey = null;

function startCoastalClashTimers(client) {
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(async () => {
    const pdt = nowInPDT();
    const dateKey = pdt.toISOString().slice(0, 10);
    const h = pdt.getUTCHours();
    const m = pdt.getUTCMinutes();

    if (h === 23 && m === 59 && lastCullDateKey !== dateKey) {
      lastCullDateKey = dateKey;
      await runDailyCullWithRetry(client);
      return;
    }

    if (m % REFRESH_INTERVAL_MINUTES === 0) {
      const minuteKey = `${dateKey}T${h}:${m}`;
      if (lastRefreshMinuteKey !== minuteKey) {
        lastRefreshMinuteKey = minuteKey;
        try {
          await refreshLeaderboardOnly();
          await postOrUpdateLeaderboard(client, db);
        } catch (err) {
          console.error('Coastal Clash: 10-min refresh failed:', err);
        }
      }
    }

    if (m % TWITCH_REFRESH_INTERVAL_MINUTES === 0) {
      const twitchMinuteKey = `${dateKey}T${h}:${m}`;
      if (lastTwitchRefreshMinuteKey !== twitchMinuteKey) {
        lastTwitchRefreshMinuteKey = twitchMinuteKey;
        try {
          const twitchResult = await refreshTwitchOnly(db.pool);
          if (twitchResult.error) {
            console.error('Coastal Clash: Twitch refresh failed:', twitchResult.error);
          }
          await postOrUpdateLiveNow(client, db);
          await postLiveAnnouncements(client, db, twitchResult.toAnnounce ?? []);
        } catch (err) {
          console.error('Coastal Clash: 3-min Twitch refresh failed:', err);
        }
      }
    }
  }, 60 * 1000);

  console.log('✅ Coastal Clash leaderboard timers started.');
}

module.exports = { startCoastalClashTimers, ALERT_USER_ID };
