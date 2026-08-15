// Coastal Clash leaderboard timers — same proven shape as project-lumi's
// commands/hanabi.js startTimers(): a 60s tick that fires two different
// things at two different cadences. Runs inside the already-always-on
// Discord bot process; no separate hosting/cron needed.
//
//   - Every 20 minutes: RP refresh + indanger recompute (no culling).
//   - Every 3 minutes: Twitch live-status refresh, on its own faster
//     cadence since it doesn't depend on the ER API at all.
//   - Once/day at 11:59 PM PDT: the real cull (src/coastalClash/cull.js
//     runDailyCull), auto-retried on failure, with an alert either way.
const { runDailyCull, refreshLeaderboardOnly, refreshTwitchOnly } = require('./cull');
const { postOrUpdateLeaderboard, postOrUpdateLiveNow, postLiveAnnouncements } = require('./embed');
const db = require('../db');
const erApi = require('./erApi');

// People to DM on cull failure/retry/self-correction and on the RP-refresh
// auto-pause below. Hardcoded per the user's explicit instruction — these
// are specific people, not a configurable setting.
const ALERT_USER_IDS = ['220690226752913418', '212368573669048330'];

// Channel-webhook alert, alongside the DM above — added after DMs proved
// unreliable in production (Discord rejected every DM attempt on
// 2026-08-14 with DiscordAPIError[50278] "no mutual guilds", despite
// shared servers; the user's own DM TO the bot also failed to deliver,
// pointing at a Discord-level setting, not this code). A webhook has no
// dependency on the bot's own permission/relationship state — it's a
// plain HTTP POST to a channel — so it can't fail the same way. Posts
// plainly with no @mention — the user's explicit call, after having it
// ping on the first real trip. URL lives in the environment (Railway
// Variables), same as DISCORD_TOKEN — never hardcoded, since it's a
// bearer credential for posting to that channel.
const ALERT_WEBHOOK_URL = process.env.COASTAL_CLASH_ALERT_WEBHOOK;

// Webhooks post under their own default identity ("Coastal Clash Alerts")
// unless overridden per-message — username/avatar_url below make it show
// up as Lumi-chan instead, so alerts read as coming from the bot itself
// rather than a separate app. Hardcoded, not fetched live, since the
// avatar only changes if someone deliberately changes the bot's profile
// picture — not worth an extra API call on every single alert.
const LUMI_CHAN_AVATAR_URL = 'https://cdn.discordapp.com/avatars/1535359066803544144/859567e9299eddf015da7375cada0bad.png';

async function webhookAlert(message) {
  if (!ALERT_WEBHOOK_URL) return;
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: message,
        username: 'Lumi-chan',
        avatar_url: LUMI_CHAN_AVATAR_URL,
      }),
    });
  } catch (err) {
    // A failed webhook post shouldn't crash the caller — this is a
    // best-effort second channel alongside the DM, not the only one.
    console.error('Coastal Clash: webhook alert failed:', err);
  }
}

// Fires both alert channels together — DM (may silently fail, see above)
// and webhook (should always land). Call sites use this instead of
// dmAlert directly so every alert gets both without duplicating the
// message text at each call site.
async function alert(client, message) {
  await dmAlert(client, message);
  await webhookAlert(message);
}

// A full 74-player refresh pass takes ~8-9 min in practice (real network
// time + season verification, confirmed by measuring an actual cycle —
// the old "~3.7 min" estimate only ever counted the artificial spacing
// sleeps, never the real thing). Widened from 15 to 20 min alongside the
// erApi.js circuit-breaker rewrite — a HALF_OPEN probe attempt or a
// circuit trip mid-pass can both add real time on top of that baseline,
// and 20 min (round marks :00/:20/:40) gives more comfortable margin than
// 15 did without meaningfully slowing down how fresh the board looks.
const REFRESH_INTERVAL_MINUTES = 20;
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

// Same reasoning as nowInPDT above — fixed UTC-4 (EDT) offset is safe for
// the whole event window (Aug 12-28, no DST transition inside it). Used
// only for the quiet-hours RP-refresh pause below.
function nowInET(date = new Date()) {
  return new Date(date.getTime() - 4 * 60 * 60 * 1000);
}

// No automatic RP refresh between 5am-12pm ET — the user's explicit call,
// a quiet window with nothing to watch, so there's no reason to keep
// calling the ER API during it. Widened from 11am to 12pm on 2026-08-15.
// Does NOT affect Twitch refresh (zero dependency on the ER API) or the
// daily cull (fixed at 11:59 PM PDT, outside this window anyway).
function isRefreshQuietHours(date = new Date()) {
  const et = nowInET(date);
  const h = et.getUTCHours();
  return h >= 5 && h < 12;
}

async function dmAlert(client, message) {
  // Each recipient independent — one person having DMs closed shouldn't
  // stop the other from getting the alert.
  for (const userId of ALERT_USER_IDS) {
    try {
      const user = await client.users.fetch(userId);
      await user.send(message);
    } catch (err) {
      // A failed DM (privacy settings, etc.) shouldn't crash the retry loop —
      // log loudly so it's at least visible in Railway's logs.
      console.error(`Coastal Clash: failed to DM alert user ${userId}:`, err);
    }
  }
}

async function runDailyCullWithRetry(client) {
  for (let attempt = 1; attempt <= CULL_MAX_RETRIES; attempt++) {
    try {
      const result = await runDailyCull();
      if (result.seasonIdCorrected) {
        await alert(client, `⚠️ Coastal Clash: the stored ER season ID looked stale and was auto-corrected to ${result.seasonId} during today's cull. Worth double-checking this was right.`);
      }
      if (result.refresh?.failed?.length) {
        await alert(client, `⚠️ Coastal Clash: today's cull (day ${result.day}) completed, but RP fetch failed for ${result.refresh.failed.length} player(s): ${result.refresh.failed.join(', ')}. Their culled/indanger status may be stale.`);
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
        await alert(client, `🚨 Coastal Clash: today's cull FAILED after ${CULL_MAX_RETRIES} attempts and needs a manual re-run (\`node scripts/updateLeaderboard.js\`). Last error: ${err.message}`);
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

// Auto-pause after repeated season-verification failures, instead of
// relying on someone noticing and manually flipping season_live off (what
// happened multiple times on 2026-08-14 — every time only because it
// happened to be actively watched). Resets to 0 on any successful cycle.
// Threshold of 3 is ~45 min of sustained failure at the 15-min cadence —
// long enough to rule out one-off blips, short enough to not sit broken
// for hours unnoticed.
//
// Persisted in the settings table, NOT an in-memory variable — confirmed
// live on 2026-08-14 that an in-memory counter never actually got the
// chance to reach the threshold, because Railway redeploys (which happen
// on every commit push) restart the process and wipe it back to 0. On an
// active dev night with frequent pushes, that meant the counter kept
// resetting before ever firing, even though the underlying block was
// sustained the whole time. A DB-backed counter survives redeploys.
const REFRESH_FAILURE_AUTO_PAUSE_THRESHOLD = 3;
const REFRESH_FAILURE_COUNT_KEY = 'coastal_clash_refresh_failure_count';

// Tracks the retryAt of the last circuit-open state actually alerted on,
// so a circuit that stays OPEN across several refresh cycles (up to
// FORBIDDEN_COOLDOWN_MS = 30 min, i.e. up to 2 cycles at the 20-min
// cadence) only pings once per trip instead of once per cycle. A NEW
// retryAt (the circuit reopening after a failed HALF_OPEN probe) alerts
// again, since that's genuinely new information. Persisted in settings,
// same reasoning as REFRESH_FAILURE_COUNT_KEY above — survives redeploys.
const CIRCUIT_ALERT_KEY = 'coastal_clash_last_circuit_alert_retry_at';

async function getRefreshFailureCount() {
  const stored = await db.getSetting(REFRESH_FAILURE_COUNT_KEY);
  return stored ? parseInt(stored, 10) : 0;
}

async function setRefreshFailureCount(count) {
  await db.setSetting(REFRESH_FAILURE_COUNT_KEY, String(count));
}

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

    // Round marks (:00/:20/:40 at the current 20-min cadence) — the
    // user's explicit request. This replaces the earlier deliberate 4-min
    // offset (:56/:06/:16/...) that existed specifically to avoid
    // round-mark collisions with other processes; that reasoning turned
    // out not to matter for the actual issue (an account-level 403,
    // unrelated to timing/collisions), so there's no longer a reason to
    // prefer an offset over round marks.
    if (m % REFRESH_INTERVAL_MINUTES === 0 && !isRefreshQuietHours()) {
      const minuteKey = `${dateKey}T${h}:${m}`;
      if (lastRefreshMinuteKey !== minuteKey) {
        lastRefreshMinuteKey = minuteKey;
        try {
          const result = await refreshLeaderboardOnly();
          await postOrUpdateLeaderboard(client, db);

          if (result.seasonVerificationFailed) {
            const consecutiveRefreshFailures = (await getRefreshFailureCount()) + 1;
            await setRefreshFailureCount(consecutiveRefreshFailures);
            if (consecutiveRefreshFailures >= REFRESH_FAILURE_AUTO_PAUSE_THRESHOLD) {
              await db.setSeasonLive(false);

              // Pull the last known-good update time AND the actual most
              // recent API response — real data instead of assuming it's
              // the same 403 issue as earlier tonight, since the whole
              // point of tonight was discovering the failure mode wasn't
              // what we first assumed (429) either.
              let staleness = '';
              let lastErrorDetail = '';
              try {
                const metaRes = await db.pool.query('SELECT last_updated_at FROM leaderboard_meta WHERE id = 1');
                if (metaRes.rows[0]?.last_updated_at) {
                  const lastGood = new Date(metaRes.rows[0].last_updated_at);
                  const minsStale = Math.round((Date.now() - lastGood.getTime()) / 60000);
                  staleness = ` Last successful update was ${minsStale} min ago (${lastGood.toISOString()}).`;
                }
                const lastCallRes = await db.pool.query(
                  `SELECT response_status, response_body, error_message FROM er_api_call_log ORDER BY called_at DESC LIMIT 1`,
                );
                const lastCall = lastCallRes.rows[0];
                if (lastCall) {
                  const bodyMsg = lastCall.response_body?.message ?? lastCall.error_message ?? 'no message';
                  lastErrorDetail = ` Most recent API response: \`${lastCall.response_status ?? 'no status'}\` — "${bodyMsg}".`;
                }
              } catch (err) {
                console.error('Coastal Clash: failed to read diagnostics for alert:', err);
              }

              const failWindowMin = consecutiveRefreshFailures * REFRESH_INTERVAL_MINUTES;
              await alert(
                client,
                `🚨 Coastal Clash: RP refresh failed ${consecutiveRefreshFailures} cycles in a row (~${failWindowMin} min) — season verification couldn't get a live season each time.${lastErrorDetail}${staleness} I've automatically set season_live to false so it stops hammering a possibly-blocked key. Check \`er_api_call_log\` for the full picture, and turn season_live back on once you've confirmed the API is responding again.`,
              );
              await setRefreshFailureCount(0);
            }
          } else {
            await setRefreshFailureCount(0);
          }
        } catch (err) {
          // A tripped circuit breaker throws out of refreshLeaderboardOnly
          // entirely (see erApi.js/cull.js) rather than returning a clean
          // result object — the existing seasonVerificationFailed branch
          // above never runs in that case, so without this, a circuit
          // trip would only ever show up as a silent console.error, the
          // exact failure mode that left this whole system unmonitored
          // for hours on 2026-08-14. Alert once per trip (see
          // CIRCUIT_ALERT_KEY above), not once per cycle it stays open.
          // Deliberately does NOT call db.setSeasonLive(false) here, unlike
          // the seasonVerificationFailed auto-pause below. The circuit
          // breaker itself already stops every further call while OPEN —
          // there's nothing left to "stop hammering." Leaving season_live
          // untouched means it stays true, so once FORBIDDEN_COOLDOWN_MS
          // elapses, the circuit's own HALF_OPEN probe (erApi.js) fires
          // automatically on the very next refresh cycle with no human
          // needing to flip anything back on — real self-healing instead
          // of a permanent pause that waits for someone to notice.
          if (erApi.isCircuitBreakerError(err)) {
            const state = erApi.getCircuitBreakerState();
            const alreadyAlertedRetryAt = await db.getSetting(CIRCUIT_ALERT_KEY);
            if (alreadyAlertedRetryAt !== state.retryAt) {
              await db.setSetting(CIRCUIT_ALERT_KEY, state.retryAt ?? '');
              await alert(
                client,
                `🔌 Coastal Clash: ER API circuit breaker is OPEN (${state.reason ?? 'repeated 401/403'}) — blocking every further ER call until ${state.retryAt ?? 'unknown'} so it stops hammering a possibly-blocked key. This resolves itself automatically (one probe request after cooldown); nothing needs doing unless it's still open well past that time.`,
              );
            }
          } else {
            console.error('Coastal Clash: refresh cycle failed:', err);
          }
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

module.exports = { startCoastalClashTimers, ALERT_USER_IDS };
