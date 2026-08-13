// Coastal Clash leaderboard — step-by-step local simulation. Each run
// advances a simulated "day counter" by one and runs a REAL (non-dry-run)
// cull against whatever DATABASE_URL is currently active, so cumulative
// state (who's already culled) builds up correctly across days — unlike
// testing a single day in isolation, which can't see prior days' culls.
//
// Refuses to run against production outright (not just a warning) — this
// script does real writes purely for rehearsal, it should never be
// pointed at the live 74 players.
//
// Usage:
//   node scripts/simulateNextDay.js          (advance one day, apply it for real)
//   node scripts/simulateNextDay.js --reset  (clear simulated culls/indanger + day counter, start over)
require('dotenv').config();
const { initDb, pool, getSetting, setSetting } = require('../src/db');
const { runDailyCull } = require('../src/coastalClash/cull');
const { dateForSimulatedDay } = require('../src/coastalClash/schedule');

// Same key the /testadvancecoastalclashday Discord command uses (index.js)
// — running this script and using that command interchangeably stays
// consistent, both advance the same simulated timeline.
const SIM_DAY_KEY = 'coastal_clash_sim_day';
const RESET = process.argv.includes('--reset');

async function main() {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.net')) {
    console.error('🚨 Refusing to run — DATABASE_URL points at production. This script does real writes and is for local rehearsal only.');
    process.exit(1);
  }

  await initDb();

  if (RESET) {
    // mmr reset to 0 too — otherwise a "fresh" Day 1 still shows whatever
    // RP got fetched during a previous test run (grace days never refresh
    // RP themselves, since runDailyCull skips grace/patch days entirely),
    // which looks like stale leftover data instead of a true blank slate.
    await pool.query('UPDATE players SET culled = false, indanger = false, mmr = 0');
    await setSetting(SIM_DAY_KEY, '0');
    console.log('✅ Reset: all players un-culled, RP zeroed, simulation day counter cleared.');
    await pool.end();
    return;
  }

  const current = parseInt((await getSetting(SIM_DAY_KEY)) ?? '0', 10);
  const nextDay = current + 1;
  const simulatedNow = dateForSimulatedDay(nextDay);

  console.log(`Connected to: ${process.env.DATABASE_URL}`);
  console.log(`Advancing simulation: day ${current} -> day ${nextDay} (${simulatedNow.toISOString()})\n`);

  const result = await runDailyCull(simulatedNow, false);
  await setSetting(SIM_DAY_KEY, String(nextDay));

  console.log(`Day ${result.day}${result.skipped ? ` (${result.reason})` : ''}, season ${result.seasonId ?? 'n/a'}${result.seasonIdCorrected ? ' (auto-corrected!)' : ''}`);
  console.log(`RP refresh: ${result.refresh.updated} updated, ${result.refresh.failed.length} failed${result.refresh.failed.length ? ' — ' + result.refresh.failed.join(', ') : ''}${result.refresh.skipped ? ' (skipped — ' + result.refresh.reason + ')' : ''}`);
  console.log(`Pro culled today (${result.proCulled.length}): ${result.proCulled.join(', ') || '(none)'}`);
  console.log(`Casual culled today (${result.casualCulled.length}): ${result.casualCulled.join(', ') || '(none)'}`);
  console.log(`Pro indanger next (${result.proIndanger.length}): ${result.proIndanger.join(', ') || '(none)'}`);
  console.log(`Casual indanger next (${result.casualIndanger.length}): ${result.casualIndanger.join(', ') || '(none)'}`);

  const { rows: counts } = await pool.query(
    `SELECT ispro, count(*) FILTER (WHERE culled) AS culled, count(*) FILTER (WHERE NOT culled) AS active FROM players GROUP BY ispro`
  );
  console.log('\nCumulative standings:');
  for (const row of counts) {
    console.log(`  ${row.ispro ? 'Pro' : 'Casual'}: ${row.active} active, ${row.culled} culled total`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('❌ simulateNextDay failed:', err);
  process.exit(1);
});
