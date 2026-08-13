// Coastal Clash leaderboard — manual/testing runner for the daily
// RP-refresh + cull + indanger pipeline (src/coastalClash/cull.js).
//
// Normally this runs automatically via the in-process timer (see
// src/coastalClash/timer.js), fired once/day at 11:59 PM PDT. This script
// exists to test that logic by hand — against whichever DATABASE_URL is
// active (lumi_local by default; see .env) — before trusting it live.
//
// Usage:
//   node scripts/updateLeaderboard.js --dry-run   (report only, no writes)
//   node scripts/updateLeaderboard.js             (actually update players)
//   node scripts/updateLeaderboard.js --dry-run --day=5   (simulate a specific event day)
require('dotenv').config();
const { initDb, pool } = require('../src/db');
const { runDailyCull } = require('../src/coastalClash/cull');
const { dateForSimulatedDay } = require('../src/coastalClash/schedule');

const DRY_RUN = process.argv.includes('--dry-run');
const dayArg = process.argv.find((a) => a.startsWith('--day='));
const simulatedDay = dayArg ? parseInt(dayArg.split('=')[1], 10) : null;

async function main() {
  console.log(`Connected to: ${process.env.DATABASE_URL}`);
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.net')) {
    console.log('⚠️  This is pointed at PRODUCTION. Make sure that is intentional.');
  }
  console.log(DRY_RUN ? '🔍 DRY RUN — no writes will happen.\n' : '✏️  LIVE RUN — this will write to the database.\n');

  await initDb();

  const now = simulatedDay ? dateForSimulatedDay(simulatedDay) : new Date();
  if (simulatedDay) console.log(`Simulating event day ${simulatedDay} (${now.toISOString()})\n`);

  const result = await runDailyCull(now, DRY_RUN);

  console.log(`Day ${result.day}${result.skipped ? ` (${result.reason})` : ''}, season ${result.seasonId ?? 'n/a'}${result.seasonIdCorrected ? ' (auto-corrected from stored value!)' : ''}`);
  console.log(`RP refresh: ${result.refresh.updated} updated, ${result.refresh.failed.length} failed${result.refresh.failed.length ? ' — ' + result.refresh.failed.join(', ') : ''}${result.refresh.skipped ? ' (skipped — ' + result.refresh.reason + ')' : ''}`);
  console.log(`Pro culled today (${result.proCulled.length}): ${result.proCulled.join(', ') || '(none)'}`);
  console.log(`Casual culled today (${result.casualCulled.length}): ${result.casualCulled.join(', ') || '(none)'}`);
  console.log(`Pro indanger next (${result.proIndanger.length}): ${result.proIndanger.join(', ') || '(none)'}`);
  console.log(`Casual indanger next (${result.casualIndanger.length}): ${result.casualIndanger.join(', ') || '(none)'}`);

  await pool.end();
}

main().catch((err) => {
  console.error('❌ updateLeaderboard failed:', err);
  process.exit(1);
});
