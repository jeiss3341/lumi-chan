// Coastal Clash leaderboard core logic: refresh RP, compute indanger, and
// execute the daily cull. Two independent pipelines — Pro and Casual never
// share a ranking pool or a cutoff.
const db = require('../db');
const erApi = require('./erApi');
const twitchApi = require('./twitchApi');
const schedule = require('./schedule');

// Reference players used to verify the stored season ID is still live
// (see erApi.getVerifiedSeasonId). Picked as currently-active, non-culled
// players likely to have played recently — not load-bearing beyond that.
async function pickReferenceNicknames(pool, limit = 3) {
  const { rows } = await pool.query(
    `SELECT name FROM players WHERE culled = false ORDER BY mmr DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.name);
}

// Refreshes RP for every still-active player (both brackets), sequentially,
// respecting the API's rate limit. Culled players are skipped — once
// eliminated, their RP is frozen, matching Hanabi Cup's prior behavior.
//
// Skips the ER API entirely while db.getSeasonLive() is off (the default)
// — the API technically responds for season 40, but that's carried-over
// placement data from season 39, not real current-season standing, per an
// explicit call the user made. Cull/indanger logic still runs on whatever
// mmr is already stored (0 until this is flipped on) — only the FETCH is
// gated, not the ranking mechanics.
async function refreshAllRP(pool, seasonId, dryRun = false) {
  const seasonLive = (await db.getSeasonLive()) === 'true';
  if (!seasonLive) {
    return { updated: 0, failed: [], skipped: true, reason: 'season not marked live (db.getSeasonLive())' };
  }

  const { rows: active } = await pool.query(`SELECT name FROM players WHERE culled = false ORDER BY name`);
  const results = { updated: 0, failed: [], notPlayedYet: [] };

  for (const { name } of active) {
    const { rp, notPlayedYet } = await erApi.fetchPlayerRP(name, seasonId);
    if (rp !== null) {
      if (!dryRun) await pool.query(`UPDATE players SET mmr = $2 WHERE name = $1`, [name, rp]);
      results.updated++;
    } else if (notPlayedYet) {
      // Normal and expected, NOT a failure — leave their mmr as-is
      // (stays at the N/A sentinel until they actually queue this
      // season) and don't count it toward the DM-alert-worthy failed list.
      results.notPlayedYet.push(name);
    } else {
      results.failed.push(name);
    }
    await erApi.sleep(erApi.CALL_SPACING_MS);
  }

  return results;
}

// Announcements re-fire if the same player's last announcement was more
// than this long ago — a stream that crashes and restarts within the
// window is treated as the SAME session continuing, not a new one worth
// re-announcing (the user's explicit call).
const LIVE_ANNOUNCE_COOLDOWN_MS = 30 * 60 * 1000;

// Refreshes twitchlive for EVERY player (active and eliminated alike —
// live status isn't tied to elimination, the design mockup shows it
// regardless), AND figures out who just switched INTO the Eternal Return
// category for the /deployliveupdate announcement feed — both share this
// single Helix call rather than doubling the API hit. twitchlive lives
// on players (part of the shared contract project-lumi's site reads
// directly); title/last_game/announced_at live in the separate
// twitch_status table, deliberately kept out of players per the user's
// explicit call. Unlike refreshAllRP, none of this is gated behind
// db.getSeasonLive() — Twitch status has nothing to do with whether the
// ER ranked season is considered "real," and one batched call for the
// whole roster is cheap enough to just always run.
//
// "Switched into ER" = their PREVIOUS check wasn't ER (or they weren't
// live at all) and their CURRENT check is ER — not just "is live", so
// someone streaming just-chatting for hours doesn't get announced, but
// they do the moment they tab into Eternal Return. Cooldown is keyed off
// announced_at regardless of brief drops, per LIVE_ANNOUNCE_COOLDOWN_MS.
async function refreshTwitchLiveStatus(pool, dryRun = false) {
  const { rows } = await pool.query(
    `SELECT p.name, p.twitch, s.last_game, s.announced_at
     FROM players p
     LEFT JOIN twitch_status s ON s.name = p.name
     WHERE p.twitch != ''`,
  );
  const results = { updated: 0, failed: [], toAnnounce: [] };
  if (!rows.length) return results;

  const rowsByLogin = new Map();
  for (const row of rows) {
    const login = twitchApi.extractTwitchLogin(row.twitch);
    if (!login) continue;
    if (!rowsByLogin.has(login)) rowsByLogin.set(login, []);
    rowsByLogin.get(login).push(row);
  }

  let liveLogins;
  try {
    liveLogins = await twitchApi.fetchLiveLogins([...rowsByLogin.keys()]);
  } catch (err) {
    // One failed batch call shouldn't crash the whole refresh cycle —
    // report it and leave twitchlive untouched until the next attempt.
    results.failed = [...rowsByLogin.values()].flat().map((r) => r.name);
    results.error = err.message;
    return results;
  }

  const now = Date.now();
  for (const [login, playerRows] of rowsByLogin) {
    const liveInfo = liveLogins.get(login);
    const isLive = !!liveInfo;
    // Title cleared to '' when offline, same as it never having been set —
    // avoids showing a stale title from their last stream once they're
    // no longer live.
    const title = liveInfo?.title ?? '';
    const currentGameId = liveInfo?.gameId ?? '';
    const isEternalReturn = currentGameId === twitchApi.ETERNAL_RETURN_GAME_ID;

    for (const row of playerRows) {
      const wasEternalReturn = row.last_game === twitchApi.ETERNAL_RETURN_GAME_ID;
      const justSwitchedIn = isEternalReturn && !wasEternalReturn;
      const lastAnnouncedMs = row.announced_at ? new Date(row.announced_at).getTime() : 0;
      const offCooldown = now - lastAnnouncedMs > LIVE_ANNOUNCE_COOLDOWN_MS;
      const willAnnounce = justSwitchedIn && offCooldown;

      if (willAnnounce) results.toAnnounce.push({ name: row.name, twitch: row.twitch, title, gameName: liveInfo.gameName });

      if (!dryRun) {
        await pool.query(`UPDATE players SET twitchlive = $2 WHERE name = $1`, [row.name, isLive]);
        // announced_at only advances when actually announcing — otherwise
        // it stays whatever it already was (row.announced_at, already in
        // hand from the earlier join, no extra query needed).
        const announcedAt = willAnnounce ? new Date() : row.announced_at;
        await pool.query(
          `INSERT INTO twitch_status (name, title, last_game, announced_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (name) DO UPDATE SET title = EXCLUDED.title, last_game = EXCLUDED.last_game, announced_at = EXCLUDED.announced_at`,
          [row.name, title, currentGameId, announcedAt],
        );
      }
      results.updated++;
    }
  }

  return results;
}

// Recomputes `indanger` for one bracket: everyone still active, bottom N by
// the NEXT scheduled cull's threshold gap — not literally tomorrow (which
// during grace days 1-3 or the day-14 patch day has nothing scheduled).
// Deliberately inactive on Day 1 itself (the user's explicit call: danger
// previews start showing from Day 2 onward, not Day 1). Resets to false
// for anyone no longer in that group. Does not touch `culled`.
// excludeNames covers players culled earlier in THIS SAME run that a
// dry-run hasn't persisted yet (executeCullForBracket skips its UPDATE
// under --dry-run) — without this, a dry run would compute indanger
// against the pre-cull pool and produce numbers a live run wouldn't match.
// Harmless to pass in a live run too (those names are already culled=true
// in the DB by this point, so the exclusion is redundant, not wrong).
async function updateIndangerForBracket(pool, isPro, day, dryRun = false, excludeNames = []) {
  const bracket = isPro ? 'pro' : 'casual';
  const threshold = day < 2 ? null : schedule.getNextCullThreshold(bracket, day);

  const { rows: active } = await pool.query(
    `SELECT name FROM players WHERE culled = false AND ispro = $1 AND NOT (name = ANY($2::text[])) ORDER BY mmr ASC, name ASC`,
    [isPro, excludeNames],
  );

  // Day 1, or past the last scheduled cull — nobody's in danger.
  if (threshold === null) {
    if (!dryRun) await pool.query(`UPDATE players SET indanger = false WHERE ispro = $1`, [isPro]);
    return { dangerNames: [] };
  }

  const cullCount = Math.max(0, active.length - threshold);
  const dangerNames = active.slice(0, cullCount).map((r) => r.name);

  if (!dryRun) {
    await pool.query(`UPDATE players SET indanger = false WHERE ispro = $1`, [isPro]);
    if (dangerNames.length) {
      await pool.query(
        `UPDATE players SET indanger = true WHERE ispro = $1 AND name = ANY($2::text[])`,
        [isPro, dangerNames],
      );
    }
  }
  return { dangerNames };
}

// Executes today's actual cull for one bracket: bottom N (today's
// threshold gap) get culled=true, indanger=false. Idempotent — if today's
// threshold has already been satisfied (e.g. a retry after a partial
// failure), cullCount comes out <= 0 and this is a safe no-op.
async function executeCullForBracket(pool, isPro, day, dryRun = false) {
  const threshold = schedule.getThreshold(isPro ? 'pro' : 'casual', day);
  if (threshold === null) return { culled: [] };

  const { rows: active } = await pool.query(
    `SELECT name FROM players WHERE culled = false AND ispro = $1 ORDER BY mmr ASC, name ASC`,
    [isPro],
  );

  const cullCount = Math.max(0, active.length - threshold);
  if (cullCount === 0) return { culled: [] };

  const toCull = active.slice(0, cullCount).map((r) => r.name);
  if (!dryRun) {
    await pool.query(
      `UPDATE players SET culled = true, indanger = false WHERE ispro = $1 AND name = ANY($2::text[])`,
      [isPro, toCull],
    );
  }
  return { culled: toCull };
}

// Full daily run: refresh RP, execute the cull for both brackets IF today
// actually culls anyone, then ALWAYS recompute indanger regardless — grace
// days (1-3) and the patch day (14) skip the cull itself, but indanger
// still needs to preview whatever the next real cull is (getNextCullThreshold
// already looks past those gap days), so it must not be skipped alongside
// the cull. Safe to re-run — executeCullForBracket is idempotent, and
// refreshAllRP just re-fetches the same still-active pool.
async function runDailyCull(now = new Date(), dryRun = false) {
  const day = schedule.getEventDay(now);
  const cullsToday = schedule.isCullDay(day);

  // Season-ID verification itself calls the ER API (against reference
  // players) — skip it too while season isn't marked live, so /daychange
  // and the daily cull make ZERO API calls until then, not just skip the
  // RP fetch. refreshAllRP already no-ops safely with seasonId=null.
  const seasonLive = (await db.getSeasonLive()) === 'true';
  let seasonId = null;
  let corrected = false;
  if (seasonLive) {
    const referenceNicknames = await pickReferenceNicknames(db.pool);
    ({ seasonId, corrected } = await erApi.getVerifiedSeasonId(db, referenceNicknames, dryRun));
    if (seasonId === null) {
      throw new Error('Could not verify a live ER season ID — refusing to run the cull with unverified data.');
    }
  }

  const refreshResult = await refreshAllRP(db.pool, seasonId, dryRun);
  const twitchResult = await refreshTwitchLiveStatus(db.pool, dryRun);

  let proCull = { culled: [] };
  let casualCull = { culled: [] };
  if (cullsToday) {
    proCull = await executeCullForBracket(db.pool, true, day, dryRun);
    casualCull = await executeCullForBracket(db.pool, false, day, dryRun);
  }

  const proDanger = await updateIndangerForBracket(db.pool, true, day, dryRun, proCull.culled);
  const casualDanger = await updateIndangerForBracket(db.pool, false, day, dryRun, casualCull.culled);

  return {
    day,
    skipped: !cullsToday,
    reason: cullsToday ? undefined : `${schedule.getNonCullReason(day)} — indanger still updated`,
    seasonId,
    seasonIdCorrected: corrected,
    refresh: refreshResult,
    twitchRefresh: twitchResult,
    proCulled: proCull.culled,
    casualCulled: casualCull.culled,
    proIndanger: proDanger.dangerNames,
    casualIndanger: casualDanger.dangerNames,
  };
}

// Lighter-weight pass for the 30-minute cadence: refresh RP and recompute
// indanger for both brackets, but never actually cull anyone. Culling only
// ever happens once/day, from runDailyCull at the scheduled cutoff.
async function refreshLeaderboardOnly(now = new Date(), dryRun = false) {
  const day = schedule.getEventDay(now);

  const seasonLive = (await db.getSeasonLive()) === 'true';
  let seasonId = null;
  let corrected = false;
  if (seasonLive) {
    const referenceNicknames = await pickReferenceNicknames(db.pool);
    ({ seasonId, corrected } = await erApi.getVerifiedSeasonId(db, referenceNicknames, dryRun));
    if (seasonId === null) {
      throw new Error('Could not verify a live ER season ID — refusing to refresh with unverified data.');
    }
  }

  const refreshResult = await refreshAllRP(db.pool, seasonId, dryRun);
  const twitchResult = await refreshTwitchLiveStatus(db.pool, dryRun);
  const proDanger = await updateIndangerForBracket(db.pool, true, day, dryRun);
  const casualDanger = await updateIndangerForBracket(db.pool, false, day, dryRun);

  return {
    day,
    seasonId,
    seasonIdCorrected: corrected,
    refresh: refreshResult,
    twitchRefresh: twitchResult,
    proIndanger: proDanger.dangerNames,
    casualIndanger: casualDanger.dangerNames,
  };
}

module.exports = {
  pickReferenceNicknames,
  refreshAllRP,
  refreshTwitchLiveStatus,
  updateIndangerForBracket,
  executeCullForBracket,
  runDailyCull,
  refreshLeaderboardOnly,
};
