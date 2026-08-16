// One-off maintenance script — fixes the "Group Type" field's text on
// already-posted CLAIM BOARD cards (buildClaimEmbed, posted once to the
// claim_board_channel setting when a claim is approved). Unlike the request
// board and submissions leaderboard (see backfillCardFooters.js), no
// per-bounty message id is ever persisted for a claim board post, so there's
// no way to look these up from the bounties table. Instead this walks the
// claim board channel's own message history directly and fixes the field
// text in place wherever it still says the old label — doesn't touch
// anything else on the embed (color, other fields, image), and doesn't need
// to know which bounty a given message even belongs to.
//
// Safe to re-run: only edits messages whose Group Type field still matches
// one of the old label strings.
//
// Usage:
//   node scripts/backfillClaimBoardGroupType.js --dry-run   (report only)
//   node scripts/backfillClaimBoardGroupType.js             (actually edit)
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { initDb, pool, getClaimBoardChannel } = require('../src/db');

const DRY_RUN = process.argv.includes('--dry-run');
const EDIT_DELAY_MS = 400;
const GROUP_TYPE_FIELD = 'Group Type';
const OLD_LABELS = ['Solo Queue Match', 'Matched Only', 'Non-Premade'];
const NEW_LABEL = 'Roll Required';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const channelId = await getClaimBoardChannel();
  if (!channelId) {
    console.error('No claim board channel configured — nothing to backfill.');
    await pool.end();
    client.destroy();
    return;
  }

  const channel = await client.channels.fetch(channelId);
  console.log(`Scanning #${channel.name} for stale Group Type text...`);

  let before;
  let scanned = 0;
  let edited = 0;
  let batchCount;

  do {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    batchCount = batch.size;
    scanned += batchCount;

    for (const message of batch.values()) {
      before = message.id; // oldest in this batch, used as the next page's cursor
      const embed = message.embeds[0];
      if (!embed || message.author.id !== client.user.id) continue;

      const fieldIndex = embed.fields.findIndex((f) => f.name === GROUP_TYPE_FIELD);
      if (fieldIndex === -1) continue;
      if (!OLD_LABELS.includes(embed.fields[fieldIndex].value)) continue;

      const rebuilt = EmbedBuilder.from(embed);
      const fields = embed.fields.map((f, i) => (i === fieldIndex ? { ...f, value: NEW_LABEL } : f));
      rebuilt.setFields(fields);

      if (DRY_RUN) {
        console.log(`  [dry-run] would fix ${message.id} ("${embed.fields[fieldIndex].value}" -> "${NEW_LABEL}")`);
      } else {
        await message.edit({ embeds: [rebuilt] });
        console.log(`  fixed ${message.id}`);
        await sleep(EDIT_DELAY_MS);
      }
      edited++;
    }
  } while (batchCount === 100);

  console.log(`\nScanned ${scanned} messages. ${edited} ${DRY_RUN ? 'would be fixed' : 'fixed'}.`);

  await pool.end();
  client.destroy();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
