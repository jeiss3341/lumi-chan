// One-off maintenance script — renames already-archived claim/submission
// ticket channels to append the claimant's display name at the end, same
// as index.js now does going forward for declared-claim/denied-claim/
// submission-won/submission-lost archiving. Only needed for channels
// archived BEFORE that change shipped — those lost the claimant's name
// because the rename rebuilt the channel name from just the bounty's own
// name, and archiving itself (setParent with lockPermissions: true) wipes
// the per-member permission overwrite that would otherwise have let us
// recover who it was. So instead this reads each ticket's own card embed
// (the "Claimant" field), which survives archiving untouched.
//
// Safe to re-run: skips any channel whose name already ends with the
// claimant's name slug.
//
// Usage:
//   node scripts/backfillArchivedClaimantNames.js --dry-run   (report only)
//   node scripts/backfillArchivedClaimantNames.js             (actually rename)
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { initDb, pool, getClaimArchiveCategory } = require('../src/db');
const { toChannelName } = require('../src/ticket');

const DRY_RUN = process.argv.includes('--dry-run');
const RENAME_DELAY_MS = 400; // stay well clear of Discord's per-channel rename rate limit
const ARCHIVED_PREFIXES = ['declared-claim-', 'denied-claim-', 'submission-lost-', 'submission-won-'];

// Same production guild every other script/screenshot in this project
// points at — Coastal Clash only ever runs on this one server.
const GUILD_ID = '1425159436443455681';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractMentionId(embed, fieldName) {
  const field = embed.fields.find((f) => f.name === fieldName);
  const match = field?.value.match(/<@!?(\d+)>/);
  return match ? match[1] : null;
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

  console.log(DRY_RUN ? 'Running in --dry-run mode — no channels will be renamed.' : 'LIVE mode — channels will be renamed.');

  await initDb();

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
  await new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.login(process.env.DISCORD_TOKEN).catch(reject);
  });
  console.log(`Logged in as ${client.user.tag}.`);

  const categoryId = await getClaimArchiveCategory();
  if (!categoryId) {
    console.error('No claim archive category configured — nothing to backfill.');
    await pool.end();
    client.destroy();
    return;
  }

  const guild = await client.guilds.fetch(GUILD_ID);
  const category = await guild.channels.fetch(categoryId);
  const allChannels = await guild.channels.fetch();
  const archived = [...allChannels.values()].filter(
    (ch) => ch?.parentId === category.id && ARCHIVED_PREFIXES.some((p) => ch.name.startsWith(p)),
  );

  console.log(`Archived claim/submission channels found: ${archived.length}`);

  let renamed = 0;
  let skippedAlready = 0;
  let skippedNoClaimant = 0;

  for (const channel of archived) {
    try {
      const recent = await channel.messages.fetch({ limit: 50 });
      const cardMessage = [...recent.values()].find((m) => m.embeds[0]?.fields?.some((f) => f.name === 'Claimant'));
      const claimantId = cardMessage ? extractMentionId(cardMessage.embeds[0], 'Claimant') : null;

      if (!claimantId) {
        skippedNoClaimant++;
        console.warn(`  skipped ${channel.name} — no Claimant field found in recent history`);
        continue;
      }

      const member = await guild.members.fetch(claimantId).catch(() => null);
      const displayName = member?.displayName;
      if (!displayName) {
        skippedNoClaimant++;
        console.warn(`  skipped ${channel.name} — claimant ${claimantId} no longer in the server`);
        continue;
      }

      const nameSlug = toChannelName(displayName);
      if (channel.name.endsWith(`-${nameSlug}`)) {
        skippedAlready++;
        continue;
      }

      const oldName = channel.name;
      const newName = toChannelName(channel.name, displayName);
      if (DRY_RUN) {
        console.log(`  [dry-run] ${oldName} -> ${newName}`);
      } else {
        // channel.setName mutates this same channel object's .name in
        // place, so oldName must be captured before this call — logging
        // channel.name afterward would print the new value on both sides.
        await channel.setName(newName);
        console.log(`  renamed ${oldName} -> ${newName}`);
        await sleep(RENAME_DELAY_MS);
      }
      renamed++;
    } catch (err) {
      console.warn(`  skipped ${channel.name} — ${err.message}`);
    }
  }

  console.log(`\n${renamed} ${DRY_RUN ? 'would be renamed' : 'renamed'}, ${skippedAlready} already had a name, ${skippedNoClaimant} skipped (no claimant found).`);

  await pool.end();
  client.destroy();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
