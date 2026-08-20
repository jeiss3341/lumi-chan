// Builds the two live leaderboard embeds (Pro / Casual) for Discord —
// same status language as the leaderboard site mockup: active players
// ranked by RP, an in-danger warning for whoever's on the current cutoff
// line, and eliminated players kept visible (struck through) rather than
// removed, matching the event's "bounties stay claimable after elimination"
// rule (their profile staying visible follows the same spirit).
const { EmbedBuilder } = require('discord.js');
const { VISUALS } = require('../text');
const schedule = require('./schedule');
const twitchApi = require('./twitchApi');

function buildBracketEmbed(pool, isPro, day, lastUpdatedAt) {
  return pool
    // name DESC mirrors the ASC-ordered queries in cull.js (mmr ASC, name
    // ASC) so ties resolve as true opposite ends of the same list — while
    // every player is tied at N/A during testing, this is what keeps
    // "in danger" landing on the visual bottom of the display instead of
    // scattered arbitrarily (Postgres doesn't guarantee tie order matches
    // between separately-sorted queries without an explicit tiebreaker).
    .query(`
      SELECT p.name, p.region, p.mmr, p.culled, p.indanger, pi.dak
      FROM players p
      LEFT JOIN player_igns pi ON pi.name = p.name
      WHERE p.ispro = $1
      ORDER BY p.culled ASC, p.mmr DESC, p.name DESC
    `, [isPro])
    .then(({ rows }) => {
      const active = rows.filter((p) => !p.culled);
      const culled = rows.filter((p) => p.culled);

      // active is already sorted mmr DESC, so in-danger players (the
      // lowest-ranked, below the next cull threshold) are always
      // contiguous at the bottom — findIndex finds exactly where safe
      // ends and danger begins, to draw one divider line there. No
      // divider at all on a grace day (nobody in danger yet) or in the
      // edge case where literally everyone is.
      const firstDangerIndex = active.findIndex((p) => p.indanger);
      const activeLines = active.map((p, i) => {
        const region = p.region ? `${p.region} | ` : '';
        const status = p.indanger ? '⚠️' : '✅';
        const dakLink = p.dak ? ` ([dak](${p.dak}))` : '';
        const line = `${i + 1}. **${region}${p.name}** — ${p.mmr} RP ${status}${dakLink}`;
        return i === firstDangerIndex && firstDangerIndex > 0 ? `\`──────⚠️ CUTOFF LINE ⚠️──────\`\n${line}` : line;
      });

      const culledLines = culled.map((p) => {
        const dakLink = p.dak ? ` ([dak](${p.dak}))` : '';
        return `~~${p.region ? `${p.region} | ` : ''}${p.name}~~ ☠️ Eliminated${dakLink}`;
      });

      const bracket = isPro ? 'pro' : 'casual';
      // Same "has today's own cull already run?" check as
      // updateIndangerForBracket/updateLeaderboardMeta (src/coastalClash/
      // cull.js) — getNextCullThreshold/getNextCullDay always skip to
      // day+1, correct only once today's cull has actually executed.
      // `active` (still-active players, already computed above) tells us
      // that directly: if it's still bigger than today's own threshold,
      // today's cull hasn't happened yet, so today's threshold/moment IS
      // the next one to show, not tomorrow's. Kept independent of
      // updateLeaderboardMeta's own DB-stored next_cull_at (which
      // project-lumi's site reads) since this embed builds its own display
      // text straight from the schedule + current active count.
      const todayThreshold = schedule.getThreshold(bracket, day);
      const todayCullPending = todayThreshold !== null && active.length > todayThreshold;
      const nextCullDay = todayCullPending ? day : schedule.getNextCullDay(bracket, day);

      // Discord's <t:UNIX:R> tag renders as a live, auto-updating relative
      // countdown ("in 5 hours") for every viewer regardless of their own
      // timezone — this only works in the embed DESCRIPTION/fields, never
      // the footer (footers are plain text, no Discord markup renders
      // there at all), which is why this is prepended here and not part
      // of footerText below.
      let countdownLine = '';
      if (nextCullDay !== null) {
        const unixSeconds = Math.floor(schedule.cullMomentForDay(nextCullDay).getTime() / 1000);
        // No trailing "in" here — Discord's :R tag already renders its own
        // "in 3 days" / "in 5 hours", so "Next cull in: in 3 days" would
        // double up.
        countdownLine = `⏰ **Next cull:** <t:${unixSeconds}:R>\n`;
      }

      // Same <t:UNIX:...> trick as the countdown above — each viewer's
      // Discord client renders this in their own local timezone/format
      // automatically, no manual conversion needed on our end.
      let lastUpdatedLine = '';
      if (lastUpdatedAt) {
        const unixSeconds = Math.floor(new Date(lastUpdatedAt).getTime() / 1000);
        lastUpdatedLine = `🕐 **Last updated:** <t:${unixSeconds}:R>\n`;
      }

      let description = countdownLine + lastUpdatedLine + (countdownLine || lastUpdatedLine ? '\n' : '') + (activeLines.join('\n') || '*No active players.*');

      // Discord hard-caps embed descriptions at 4096 chars — truncate with a
      // note rather than let the API reject the whole message if the roster
      // ever grows past what fits. Cut at the last full line instead of a
      // raw character slice — a mid-string cut can land inside a markdown
      // link's `[label](url)` syntax and leave it unclosed, which Discord
      // then renders as broken literal text instead of quietly dropping it
      // (confirmed live 2026-08-20, a cut-off "([dak](https://dak.gg/..."
      // showed up unrendered at the bottom of the pro bracket board).
      if (description.length > 4000) {
        const lastNewline = description.lastIndexOf('\n', 4000);
        description = description.slice(0, lastNewline > 0 ? lastNewline : 4000) + '\n\n*(truncated — too many players to show in full)*';
      }

      // Eliminated players live in fields instead of the description now
      // — a separate 1024-char-per-field budget from the description's
      // own 4096 cap, which is what lets dak links stay on BOTH lists
      // without ever overflowing (roster size is fixed for the whole
      // event, so the eliminated list only grows, never shrinks). Chunked
      // across multiple fields since one field alone can't hold all ~50
      // eventual eliminations with a dak link on each; every field after
      // the first uses a zero-width-space name since Discord rejects an
      // empty field name but a second "Eliminated (N)" header would read
      // as a duplicate count.
      const culledFields = [];
      if (culledLines.length) {
        let chunk = [];
        let chunkLen = 0;
        for (const line of culledLines) {
          if (chunkLen + line.length + 1 > 1000 && chunk.length) {
            culledFields.push(chunk.join('\n'));
            chunk = [];
            chunkLen = 0;
          }
          chunk.push(line);
          chunkLen += line.length + 1;
        }
        if (chunk.length) culledFields.push(chunk.join('\n'));
      }

      // "Top N" info lives in the footer now, since the description's own
      // headline is just the countdown per the user's requested wording.
      // Shows the cutoff AFTER the imminent one, not the imminent one itself
      // — the user's explicit call: the ⚠️/✅ markers above already show
      // exactly who's at risk for the upcoming cull, so repeating that same
      // number here was redundant; showing one step further ahead is new
      // information instead. Labeled "Following cutoff" rather than "Next
      // cutoff" specifically so it can't be misread as matching the
      // countdown line above (which still correctly points at the real
      // next cull) — same kind of label/value mismatch this whole session
      // started by fixing, not something to reintroduce here.
      const followingThreshold = nextCullDay !== null ? schedule.getNextCullThreshold(bracket, nextCullDay) : null;
      // Grace (days 1-3) / patch (day 14) days don't cull anyone even
      // though a future cutoff is still shown — flagging that explicitly
      // so "Following cutoff: Top 45" doesn't read as "today culls to 45".
      const nonCullNote = !schedule.isCullDay(day)
        ? ` · ${schedule.getNonCullReason(day).replace(/\b\w/g, (c) => c.toUpperCase())}`
        : '';
      const footerText = `Day ${day} of 17${nonCullNote}${followingThreshold !== null ? ` · Following cutoff: Top ${followingThreshold}` : ''}`;

      const embed = new EmbedBuilder()
        .setTitle(`${isPro ? '🔱 Pro' : '⚔️ Casual'} Bracket — Day ${day}`)
        .setColor(isPro ? VISUALS.COLORS.sand : VISUALS.COLORS.brand)
        .setDescription(description)
        .setFooter({ text: footerText });

      if (culledFields.length) {
        embed.addFields(culledFields.map((value, i) => ({
          name: i === 0 ? `Eliminated (${culledLines.length})` : '​',
          value,
        })));
      }

      return embed;
    });
}

async function buildLeaderboardEmbeds(pool, now = new Date()) {
  const day = schedule.getEventDay(now);
  const { rows: metaRows } = await pool.query('SELECT last_updated_at FROM leaderboard_meta WHERE id = 1');
  const lastUpdatedAt = metaRows[0]?.last_updated_at ?? null;
  const [proEmbed, casualEmbed] = await Promise.all([
    buildBracketEmbed(pool, true, day, lastUpdatedAt),
    buildBracketEmbed(pool, false, day, lastUpdatedAt),
  ]);
  return { pro: proEmbed, casual: casualEmbed };
}

// Posts (first time) or edits-in-place (every time after) ONE bracket's
// leaderboard message, in whichever channel THAT bracket was deployed to
// (db.getLeaderboardChannel(bracket)) — Pro and Casual are fully
// independent and may live in different channels. No-ops quietly if that
// bracket's /deploy*leaderboard command hasn't been run yet, since the
// 30-min timer calls this unconditionally for both brackets.
async function postOrUpdateBracketMessage(client, db, bracket, embed) {
  const channelId = await db.getLeaderboardChannel(bracket);
  if (!channelId) return { posted: false, reason: 'no channel configured' };

  const channel = await client.channels.fetch(channelId);
  const existingMessageId = await db.getLeaderboardMessageId(bracket);
  if (existingMessageId) {
    try {
      const message = await channel.messages.fetch(existingMessageId);
      await message.edit({ embeds: [embed] });
      return { posted: true, edited: true };
    } catch (err) {
      // Message was deleted or otherwise unreachable — fall through and
      // post a fresh one rather than erroring the whole refresh cycle.
      console.warn(`Coastal Clash: could not edit existing ${bracket} leaderboard message, posting a new one:`, err.message);
    }
  }

  const message = await channel.send({ embeds: [embed] });
  await db.setLeaderboardMessageId(bracket, message.id);
  return { posted: true, edited: false };
}

// `now` defaults to the real current time (correct for the live 30-min
// timer / real daily cull). /daychange (index.js) passes the SIMULATED
// date explicitly here — without that, the displayed "Day N" label and
// "next cull" footer would always reflect the real calendar day (still
// Day 1 today) no matter how far the simulation has actually advanced,
// even though the underlying culled/indanger DATA is correctly simulated.
async function postOrUpdateLeaderboard(client, db, now = new Date()) {
  const { pro, casual } = await buildLeaderboardEmbeds(db.pool, now);
  const proResult = await postOrUpdateBracketMessage(client, db, 'pro', pro);
  const casualResult = await postOrUpdateBracketMessage(client, db, 'casual', casual);
  return { pro: proResult, casual: casualResult };
}

// Active: Region | Twitch name (linked) | Dak.gg: [player IGN, linked] · #rank · RP.
// Region | Twitch name (linked) · #rank · RP. Eliminated (showStats:
// false) drops rank/RP, neither of which mean anything post-elimination.
// Dak.gg link dropped — too much per line stacked with everything else.
function buildLiveStreamerLine(p, { showStats } = {}) {
  const region = p.region ? `${p.region} | ` : '';
  const bracket = p.ispro ? '🔱' : '⚔️';
  const login = twitchApi.extractTwitchLogin(p.twitch);
  const twitchLink = login ? `https://twitch.tv/${login}` : null;
  const twitchPart = twitchLink ? `[${p.name}](${twitchLink})` : p.name;
  let nameLine = `${bracket} **${region}${twitchPart}**`;
  if (showStats) {
    nameLine += ` · #${p.bracket_rank} · ${p.mmr} RP`;
  }
  return p.title ? `${nameLine}\n> ${p.title}` : nameLine;
}

// twitchlive alone only means "live on Twitch, some game" — this board
// is specifically an Eternal Return watch list, so it also requires
// last_game to match, same filter /deployliveupdate already uses
// (index.js) to find who's already live in ER. Without this, someone
// live but playing something else (or who just tabbed out of ER while
// staying live) would incorrectly stay listed.
const LIVE_IN_ER_JOIN = `JOIN twitch_status s ON s.name = p.name WHERE p.twitchlive = true AND s.last_game = $1`;

// "Live Now" — active (non-eliminated) players currently streaming ER
// only. Eliminated players who are still streaming don't show up here at
// all (culled status genuinely excludes them from this board, not just
// from the rank/RP display).
async function buildLiveNowEmbed(pool) {
  // bracket_rank: this player's 1-indexed standing among active players in
  // their own bracket, same ordering (mmr DESC, name DESC tiebreak) as the
  // main leaderboard embed above — counts how many active bracket-mates
  // outrank them, +1.
  const { rows } = await pool.query(
    `SELECT p.name, p.region, COALESCE(s.live_twitch_url, p.twitch) AS twitch, p.mmr, p.ispro, p.culled, s.title,
       (SELECT COUNT(*) + 1 FROM players p2
        WHERE p2.ispro = p.ispro AND p2.culled = false
          AND (p2.mmr > p.mmr OR (p2.mmr = p.mmr AND p2.name > p.name))) AS bracket_rank
     FROM players p
     ${LIVE_IN_ER_JOIN} AND p.culled = false
     ORDER BY p.ispro DESC, p.mmr DESC, p.name DESC`,
    [twitchApi.ETERNAL_RETURN_GAME_ID],
  );

  const lines = rows.map((p) => buildLiveStreamerLine(p, { showStats: true }));
  let description = lines.length ? lines.join('\n') : '*Nobody is live right now.*';

  // Same 4096-char hard cap as buildBracketEmbed above — with enough
  // people live at once this can genuinely exceed it (confirmed live:
  // was throwing and crashing the 3-min Twitch refresh cycle every time
  // instead of just this one post failing).
  if (description.length > 4000) {
    description = description.slice(0, 4000) + '\n\n*(truncated — too many streamers to show in full)*';
  }

  return new EmbedBuilder()
    .setTitle('🔴 Live Now')
    .setColor(VISUALS.COLORS.denied)
    .setDescription(description)
    .setFooter({ text: `${rows.length} streamer${rows.length === 1 ? '' : 's'} live` });
}

// Same idea as buildLiveNowEmbed, but for eliminated players — culled
// status doesn't stop someone from streaming, this just tracks them on a
// separate board instead of mixing them into the active one. No rank/RP,
// since neither means anything post-elimination. NOT currently wired up
// to any command — index.js/db.js/deploy-commands.js/text.js changes for
// a real /deployeliminatedlive command are still sitting uncommitted,
// left unfinished on purpose (see conversation — undecided whether to
// ship a separate board at all). This function is unreachable dead code
// until/unless that gets finished and committed too.
async function buildEliminatedLiveNowEmbed(pool) {
  const { rows } = await pool.query(
    `SELECT p.name, p.region, COALESCE(s.live_twitch_url, p.twitch) AS twitch, p.mmr, p.ispro, s.title
     FROM players p
     ${LIVE_IN_ER_JOIN} AND p.culled = true
     ORDER BY p.ispro DESC, p.name ASC`,
    [twitchApi.ETERNAL_RETURN_GAME_ID],
  );

  const lines = rows.map((p) => buildLiveStreamerLine(p, { showStats: false }));
  const description = lines.length ? lines.join('\n') : '*No eliminated players are live right now.*';

  return new EmbedBuilder()
    .setTitle('Eliminated — Live Now')
    .setColor(VISUALS.COLORS.eliminated)
    .setDescription(description)
    .setFooter({ text: `${rows.length} streamer${rows.length === 1 ? '' : 's'} live` });
}

// Same edit-in-place pattern as postOrUpdateBracketMessage — one message,
// one channel, no duplicates on repeat refreshes.
async function postOrUpdateLiveNow(client, db) {
  const channelId = await db.getLiveNowChannel();
  if (!channelId) return { posted: false, reason: 'no channel configured' };

  const channel = await client.channels.fetch(channelId);
  const embed = await buildLiveNowEmbed(db.pool);

  const existingMessageId = await db.getLiveNowMessageId();
  if (existingMessageId) {
    try {
      const message = await channel.messages.fetch(existingMessageId);
      await message.edit({ embeds: [embed] });
      return { posted: true, edited: true };
    } catch (err) {
      console.warn('Coastal Clash: could not edit existing Live Now message, posting a new one:', err.message);
    }
  }

  const message = await channel.send({ embeds: [embed] });
  await db.setLiveNowMessageId(message.id);
  return { posted: true, edited: false };
}

// Same edit-in-place pattern, for the separate eliminated-players board.
async function postOrUpdateEliminatedLiveNow(client, db) {
  const channelId = await db.getEliminatedLiveNowChannel();
  if (!channelId) return { posted: false, reason: 'no channel configured' };

  const channel = await client.channels.fetch(channelId);
  const embed = await buildEliminatedLiveNowEmbed(db.pool);

  const existingMessageId = await db.getEliminatedLiveNowMessageId();
  if (existingMessageId) {
    try {
      const message = await channel.messages.fetch(existingMessageId);
      await message.edit({ embeds: [embed] });
      return { posted: true, edited: true };
    } catch (err) {
      console.warn('Coastal Clash: could not edit existing Eliminated Live Now message, posting a new one:', err.message);
    }
  }

  const message = await channel.send({ embeds: [embed] });
  await db.setEliminatedLiveNowMessageId(message.id);
  return { posted: true, edited: false };
}

// One fresh message PER entry in `toAnnounce` (src/coastalClash/cull.js
// refreshTwitchLiveStatus's toAnnounce list — already filtered to
// "just switched into Eternal Return" + off cooldown). Deliberately NOT
// edited-in-place like Live Now above — this is a feed of distinct
// events, not a status board. No-ops quietly if /deployliveupdate hasn't
// been run yet, since the refresh cycle calls this unconditionally.
async function postLiveAnnouncements(client, db, toAnnounce) {
  if (!toAnnounce.length) return { posted: 0 };

  const channelId = await db.getLiveAnnounceChannel();
  if (!channelId) return { posted: 0, reason: 'no channel configured' };

  const channel = await client.channels.fetch(channelId);
  let posted = 0;
  for (const player of toAnnounce) {
    const login = twitchApi.extractTwitchLogin(player.twitch);
    const link = login ? `https://twitch.tv/${login}` : null;
    const embed = new EmbedBuilder()
      .setTitle(`🟣 ${player.twitchDisplayName || player.name} is now live!`)
      .setColor(VISUALS.COLORS.twitch)
      .setDescription(`Playing **${player.gameName}**${player.title ? `\n> ${player.title}` : ''}`);
    // setURL throws on null/undefined — only set it when there's a real
    // link, same defensive pattern as liveText.js's applyEmoji.
    if (link) embed.setURL(link);
    await channel.send({ embeds: [embed] });
    posted++;
  }
  return { posted };
}

module.exports = {
  buildLeaderboardEmbeds,
  postOrUpdateLeaderboard,
  buildLiveNowEmbed,
  postOrUpdateLiveNow,
  buildEliminatedLiveNowEmbed,
  postOrUpdateEliminatedLiveNow,
  postLiveAnnouncements,
};
