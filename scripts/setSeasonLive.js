// Coastal Clash — manual on/off switch for coastal_clash_season_live.
// This flag gates every ER API call in src/coastalClash/cull.js (RP refresh,
// season verification) — flipping it off stops the bot from hitting the ER
// API at all, while leaving the process/timer running. See
// coastal_clash_stop_tracking_at_top1 memory for why: turn off once the
// event's final Top 1 is decided, so the bot doesn't keep polling forever.
//
// Usage:
//   node scripts/setSeasonLive.js --off
//   node scripts/setSeasonLive.js --on
require('dotenv').config();
const { initDb, getSeasonLive, setSeasonLive, pool } = require('../src/db');

const turnOn = process.argv.includes('--on');
const turnOff = process.argv.includes('--off');

async function main() {
  if (turnOn === turnOff) {
    console.error('Pass exactly one of --on or --off.');
    process.exit(1);
  }

  console.log(`Connected to: ${process.env.DATABASE_URL}`);
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('rlwy.net')) {
    console.log('⚠️  This is pointed at PRODUCTION. Make sure that is intentional.');
  }

  await initDb();

  const before = await getSeasonLive();
  console.log(`season_live before: ${before}`);

  await setSeasonLive(turnOn);

  const after = await getSeasonLive();
  console.log(`season_live after:  ${after}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
