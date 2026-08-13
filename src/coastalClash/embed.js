// Builds the two live leaderboard embeds (Pro / Casual) for Discord —
// same status language as the leaderboard site mockup: active players
// ranked by RP, an in-danger warning for whoever's on the current cutoff
// line, and eliminated players kept visible (struck through) rather than
// removed, matching the event's "bounties stay claimable after elimination"
// rule (their profile staying visible follows the same spirit).
const { EmbedBuilder } = require('discord.js');
const { VISUALS } = require('../text');
const schedule = require('./schedule');

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

      const activeLines = active.map((p, i) => {
        const region = p.region ? `${p.region} | ` : '';
        const status = p.indanger ? '⚠️' : '✅';
        // 0 is the "not fetched yet" sentinel, not a real RP value (see
        // db.getSeasonLive() — the ER API isn't being queried yet), so it
        // displays as N/A instead of a misleadingly literal "0 RP".
        const rpDisplay = p.mmr === 0 ? 'N/A' : `${p.mmr} RP`;
        return `${i + 1}. **${region}${p.name}** — ${rpDisplay} ${status}`;
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

module.exports = { buildLeaderboardEmbeds, postOrUpdateLeaderboard };
