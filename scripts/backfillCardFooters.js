// One-off maintenance script — re-renders every already-posted bounty card's
// footer to the new fixed PST/EST format (src/bountyCard.js's
// footerWithTimestamp()), instead of Discord's old per-viewer auto-localized
// timestamp. Only touches the two "board" post types that persist a
// channel+message id: the plain approved-bounty board post
// (board_channel_id/board_message_id, set for every approved bounty
// regardless of claim_type) and the live submissions leaderboard post
// (submissions_board_channel_id/submissions_board_message_id, only present
// once a submissions bounty has its first approved claim, and only while
// still open — submissions_finalized rows had that post deleted already).
//
// Safe to re-run: each edit just rebuilds the embed from current DB state,
// so running this twice produces the same result the second time.
//
// Usage:
//   node scripts/backfillCardFooters.js --dry-run   (report only, no edits)
//   node scripts/backfillCardFooters.js             (actually edit messages)
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { pool, initDb } = require('../src/db');
const { buildBountyEmbed, buildLeaderboardEmbed } = require('../src/bountyCard');

const DRY_RUN = process.argv.includes('--dry-run');
const EDIT_DELAY_MS = 400; // stay well clear of Discord's per-channel edit rate limit

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function backfillBoardPosts(client) {
  const { rows } = await pool.query(`
    SELECT id, name, description, reward, requester_id, group_type, board_channel_id, board_message_id
    FROM bounties
    WHERE board_message_id IS NOT NULL AND board_channel_id IS NOT NULL
    ORDER BY id
  `);

  console.log(`\nApproved-bounty board posts found: ${rows.length}`);
  let edited = 0;
  let skipped = 0;

  for (const b of rows) {
    try {
      const channel = await client.channels.fetch(b.board_channel_id);
      const message = await channel.messages.fetch(b.board_message_id);
      const requester = await client.users.fetch(b.requester_id);

      const embed = buildBountyEmbed({
        name: b.name,
        description: b.description,
        amountRaw: b.reward,
        groupType: b.group_type,
        user: requester,
        status: 'approved',
      });

      if (DRY_RUN) {
        console.log(`  [dry-run] would edit bounty #${b.id} "${b.name}" (${b.board_channel_id}/${b.board_message_id})`);
      } else {
        await message.edit({ embeds: [embed] });
        console.log(`  edited bounty #${b.id} "${b.name}"`);
        await sleep(EDIT_DELAY_MS);
      }
      edited++;
    } catch (err) {
      skipped++;
      console.warn(`  skipped bounty #${b.id} "${b.name}" — ${err.message}`);
    }
  }

  console.log(`Board posts: ${edited} ${DRY_RUN ? 'would be edited' : 'edited'}, ${skipped} skipped (missing message/channel/user).`);
}

async function backfillSubmissionsBoardPosts(client) {
  const { rows } = await pool.query(`
    SELECT id, name, description, reward, group_type, leader_id, leader_value,
           submission_metric_kind, submission_metric_label, leader_teammates,
           submissions_board_channel_id, submissions_board_message_id
    FROM bounties
    WHERE submissions_board_message_id IS NOT NULL
      AND submissions_board_channel_id IS NOT NULL
      AND submissions_finalized = false
    ORDER BY id
  `);

  console.log(`\nLive submissions leaderboard posts found: ${rows.length}`);
  let edited = 0;
  let skipped = 0;

  for (const b of rows) {
    try {
      const channel = await client.channels.fetch(b.submissions_board_channel_id);
      const message = await channel.messages.fetch(b.submissions_board_message_id);

      let leaderAvatarURL;
      if (b.leader_id) {
        const leader = await client.users.fetch(b.leader_id).catch(() => null);
        if (leader) leaderAvatarURL = leader.displayAvatarURL();
      }

      const embed = buildLeaderboardEmbed(b, { closed: false, leaderAvatarURL });

      if (DRY_RUN) {
        console.log(`  [dry-run] would edit submissions bounty #${b.id} "${b.name}" (${b.submissions_board_channel_id}/${b.submissions_board_message_id})`);
      } else {
        await message.edit({ embeds: [embed] });
        console.log(`  edited submissions bounty #${b.id} "${b.name}"`);
        await sleep(EDIT_DELAY_MS);
      }
      edited++;
    } catch (err) {
      skipped++;
      console.warn(`  skipped submissions bounty #${b.id} "${b.name}" — ${err.message}`);
    }
  }

  console.log(`Submissions posts: ${edited} ${DRY_RUN ? 'would be edited' : 'edited'}, ${skipped} skipped.`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — point .env at the database you actually want to backfill (prod vs. local).');
    process.exit(1);
  }
  if (!process.env.DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN is not set.');
    process.exit(1);
  }

  console.log(DRY_RUN ? 'Running in --dry-run mode — no messages will be edited.' : 'LIVE mode — messages will be edited.');

  await initDb();

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
  await new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.login(process.env.DISCORD_TOKEN).catch(reject);
  });
  console.log(`Logged in as ${client.user.tag}.`);

  await backfillBoardPosts(client);
  await backfillSubmissionsBoardPosts(client);

  await pool.end();
  client.destroy();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
