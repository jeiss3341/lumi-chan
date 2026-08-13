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

function buildBracketEmbed(pool, isPro, day) {
  return pool
    // name DESC mirrors the ASC-ordered queries in cull.js (mmr ASC, name
    // ASC) so ties resolve as true opposite ends of the same list — while
    // every player is tied at N/A during testing, this is what keeps
    // "in danger" landing on the visual bottom of the display instead of
    // scattered arbitrarily (Postgres doesn't guarantee tie order matches
    // between separately-sorted queries without an explicit tiebreaker).
    .query(`SELECT name, region, mmr, culled, indanger FROM players WHERE ispro = $1 ORDER BY culled ASC, mmr DESC, name DESC`, [isPro])
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
        // 0 is the "not fetched yet" sentinel, not a real RP value (see
        // db.getSeasonLive() — the ER API isn't being queried yet), so it
        // displays as N/A instead of a misleadingly literal "0 RP".
        const rpDisplay = p.mmr === 0 ? 'N/A' : `${p.mmr} RP`;
        const line = `${i + 1}. **${region}${p.name}** — ${rpDisplay} ${status}`;
        return i === firstDangerIndex && firstDangerIndex > 0 ? `⚠️ **— Danger Zone —**\n${line}` : line;
      });

      const culledLines = culled.map((p) => `~~${p.region ? `${p.region} | ` : ''}${p.name}~~ ☠️ Eliminated`);

      const bracket = isPro ? 'pro' : 'casual';
      const nextThreshold = schedule.getNextCullThreshold(bracket, day);
      const nextCullDay = schedule.getNextCullDay(bracket, day);

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
        countdownLine = `⏰ **Next cull:** <t:${unixSeconds}:R>\n\n`;
      }

      let description = countdownLine + (activeLines.join('\n') || '*No active players.*');
      if (culledLines.length) {
        description += `\n\n**Eliminated (${culledLines.length})**\n${culledLines.join('\n')}`;
      }

      // Discord hard-caps embed descriptions at 4096 chars — truncate with a
      // note rather than let the API reject the whole message if the roster
      // ever grows past what fits.
      if (description.length > 4000) {
        description = description.slice(0, 4000) + '\n\n*(truncated — too many players to show in full)*';
      }

      // "Top N" info lives in the footer now, since the description's own
      // headline is just the countdown per the user's requested wording.
      const footerText = `Day ${day} of 17${nextThreshold !== null ? ` · Next cutoff: Top ${nextThreshold}` : ''}`;

      return new EmbedBuilder()
        .setTitle(`${isPro ? '🔱 Pro' : '⚔️ Casual'} Bracket — Day ${day}`)
        .setColor(isPro ? VISUALS.COLORS.sand : VISUALS.COLORS.brand)
        .setDescription(description)
        .setFooter({ text: footerText });
    });
}

async function buildLeaderboardEmbeds(pool, now = new Date()) {
  const day = schedule.getEventDay(now);
  const [proEmbed, casualEmbed] = await Promise.all([
    buildBracketEmbed(pool, true, day),
    buildBracketEmbed(pool, false, day),
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
// Eliminated (showStats: false): just Region | Twitch name (linked) — no
// Dak.gg, rank, or RP, none of which mean anything post-elimination.
// Dak.gg itself is a plain label, not a link — only the name next to it
// links out, to that player's actual dak.gg profile.
function buildLiveStreamerLine(p, { showStats } = {}) {
  const region = p.region ? `${p.region} | ` : '';
  const bracket = p.ispro ? '🔱' : '⚔️';
  const login = twitchApi.extractTwitchLogin(p.twitch);
  const twitchLink = login ? `https://twitch.tv/${login}` : null;
  const twitchPart = twitchLink ? `[${p.name}](${twitchLink})` : p.name;
  let nameLine = `${bracket} **${region}${twitchPart}**`;
  if (showStats) {
    const dakggLink = `https://dak.gg/er/players/${encodeURIComponent(p.name)}`;
    const rpDisplay = p.mmr === 0 ? 'N/A' : `${p.mmr} RP`;
    nameLine += ` | Dak.gg: [${p.name}](${dakggLink}) · #${p.bracket_rank} · ${rpDisplay}`;
  }
  return p.title ? `${nameLine}\n> ${p.title}` : nameLine;
}

// twitchlive alone only means "live on Twitch, some game" — both boards
// below are specifically an Eternal Return watch list, so both also
// require last_game to match, same filter /deployliveupdate already uses
// (index.js) to find who's already live in ER. Without this, someone live
// but playing something else (or who just tabbed out of ER while staying
// live) would incorrectly stay listed.
const LIVE_IN_ER_JOIN = `JOIN twitch_status s ON s.name = p.name WHERE p.twitchlive = true AND s.last_game = $1`;

// "Live Now" — active (non-culled) players currently streaming ER. Split
// out from eliminated streamers into its own separate board/message/
// channel (rather than one embed with two sections) — see
// buildEliminatedLiveNowEmbed below.
async function buildLiveNowEmbed(pool) {
  // bracket_rank: this player's 1-indexed standing among active players in
  // their own bracket, same ordering (mmr DESC, name DESC tiebreak) as the
  // main leaderboard embed above — counts how many active bracket-mates
  // outrank them, +1.
  const { rows } = await pool.query(
    `SELECT p.name, p.region, p.twitch, p.mmr, p.ispro, s.title,
       (SELECT COUNT(*) + 1 FROM players p2
        WHERE p2.ispro = p.ispro AND p2.culled = false
          AND (p2.mmr > p.mmr OR (p2.mmr = p.mmr AND p2.name > p.name))) AS bracket_rank
     FROM players p
     ${LIVE_IN_ER_JOIN} AND p.culled = false
     ORDER BY p.ispro DESC, p.name ASC`,
    [twitchApi.ETERNAL_RETURN_GAME_ID],
  );

  const lines = rows.map((p) => buildLiveStreamerLine(p, { showStats: true }));
  const description = lines.length ? lines.join('\n') : '*Nobody is live right now.*';

  return new EmbedBuilder()
    .setTitle('🔴 Live Now')
    .setColor(VISUALS.COLORS.denied)
    .setDescription(description)
    .setFooter({ text: `${rows.length} streamer${rows.length === 1 ? '' : 's'} live` });
}

// Same idea as buildLiveNowEmbed, but for eliminated players — culled
// status doesn't stop someone from streaming, this just tracks them on a
// separate board instead of mixing them into the active one. No rank/RP,
// since neither means anything post-elimination.
async function buildEliminatedLiveNowEmbed(pool) {
  const { rows } = await pool.query(
    `SELECT p.name, p.region, p.twitch, p.mmr, p.ispro, s.title
     FROM players p
     ${LIVE_IN_ER_JOIN} AND p.culled = true
     ORDER BY p.ispro DESC, p.name ASC`,
    [twitchApi.ETERNAL_RETURN_GAME_ID],
  );

  const lines = rows.map((p) => buildLiveStreamerLine(p, { showStats: false }));
  const description = lines.length ? lines.join('\n') : '*No eliminated players are live right now.*';

  return new EmbedBuilder()
    .setTitle('☠️ Eliminated — Live Now')
    .setColor(VISUALS.COLORS.denied)
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
      .setTitle(`🟣 ${player.name} is now live!`)
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
