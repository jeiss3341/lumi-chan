// Coastal Clash — finds "stragglers": active players whose stored RP no
// longer matches what the ER API currently returns, meaning some past
// refresh cycle (auto or manual) missed or failed them.
//
// This exists because the ad-hoc manual monitoring loop (light checks most
// of the time, targeted checks at :10/:40 past the hour) had no consistent
// definition of "straggler" — every check was a one-off node -e query, so
// there was no way to be sure what got checked from one pass to the next.
// This script makes it a fixed, repeatable definition instead: fetch the
// verified season's live RP for every active player, diff it against
// players.mmr, and report the mismatches.
//
// Usage:
//   node scripts/checkStragglers.js              (report only, no writes)
//   node scripts/checkStragglers.js --apply       (also fix the mismatches found)
require('dotenv').config();
const db = require('../src/db');
const { initDb, pool } = db;
const erApi = require('../src/coastalClash/erApi');
const cull = require('../src/coastalClash/cull');

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`Connected to: ${process.env.DATABASE_URL}`);
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.net')) {
    console.log('⚠️  This is pointed at PRODUCTION. Make sure that is intentional.');
  }
  console.log(APPLY ? '✏️  APPLY — mismatches found will be written to the DB.\n' : '🔍 REPORT ONLY — no writes will happen (pass --apply to fix).\n');

  await initDb();

  const referenceNicknames = await cull.pickReferenceNicknames(pool);
  const { seasonId, corrected } = await erApi.getVerifiedSeasonId(db, referenceNicknames, true);

  if (seasonId === null) {
    console.log('❌ Could not verify a live season right now — API may be under rate pressure. Try again shortly.');
    process.exit(1);
  }
  console.log(`Season ${seasonId}${corrected ? ' (differs from stored value!)' : ''}\n`);

  const { rows: active } = await pool.query(
    `SELECT p.name, COALESCE(en.ign, p.name) AS ign, p.mmr AS stored_mmr FROM players p
     LEFT JOIN player_igns en ON en.name = p.name
     WHERE p.culled = false ORDER BY p.name`,
  );

  const stragglers = [];
  for (const { name, ign, stored_mmr } of active) {
    const { rp, notPlayedYet } = await erApi.fetchPlayerRP(ign, seasonId);
    if (notPlayedYet) continue; // not a straggler — hasn't queued this season yet, expected
    if (rp === null) {
      stragglers.push({ name, storedMmr: stored_mmr, liveRp: null, reason: 'fetch failed' });
      continue;
    }
    if (rp !== stored_mmr) {
      stragglers.push({ name, storedMmr: stored_mmr, liveRp: rp, reason: 'stale' });
    }
    // No sleep here anymore — erApi.js's fetchWithTimeout now enforces
    // spacing centrally via its own request queue.
  }

  if (stragglers.length === 0) {
    console.log('✅ No stragglers — every active player matches the live API.');
    process.exit(0);
  }

  console.log(`Found ${stragglers.length} straggler(s):`);
  for (const s of stragglers) {
    console.log(`  ${s.name}: stored=${s.storedMmr} live=${s.liveRp ?? 'n/a'} (${s.reason})`);
  }

  if (APPLY) {
    console.log('\nApplying fixes...');
    for (const s of stragglers) {
      if (s.liveRp === null) continue; // nothing to write for a fetch failure
      await pool.query(`UPDATE players SET mmr = $2 WHERE name = $1`, [s.name, s.liveRp]);
      console.log(`  ✏️  ${s.name} -> ${s.liveRp}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
