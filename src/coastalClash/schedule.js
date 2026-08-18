// Coastal Clash elimination schedule — fixed per-day, per-bracket survivor
// thresholds from the event's own spec calendar (not derivable from any
// game data). Day 1 = event launch date. Days 1-3 are grace days (no
// elimination). Days 7 AND 14 are patch days (no elimination) — updated
// 2026-08-17 after realizing every Wednesday in the event window is a
// patch day, not just day 14 (Day 1 = Thursday Aug 13, so Day 7 = Wed
// Aug 19 and Day 14 = Wed Aug 26 are the only two Wednesdays that fall
// inside the event). Days 4-6 are unchanged by this update (today, Day 5,
// already ran before this change — nothing retroactive needed). Day 17 is
// the finale — the calendar just labels it "End," but per the user's
// explicit, confirmed-twice call it's a real Top-1 cull (2 -> 1,
// auto-declares the winner), using the exact same mechanism as every
// other day.
//
// Thresholds are CUMULATIVE SURVIVOR COUNTS ("Top N remain"), not per-day
// removal counts — the actual number culled on a given day is
// (currently active count) - (that day's threshold).
const EVENT_START_DATE = '2026-08-13'; // Day 1

const PRO_THRESHOLDS = {
  4: 45, 5: 39, 6: 34, 8: 29, 9: 24, 10: 19,
  11: 14, 12: 10, 13: 7, 15: 4, 16: 2, 17: 1,
};

const CASUAL_THRESHOLDS = {
  4: 20, 5: 18, 6: 16, 8: 14, 9: 12, 10: 10,
  11: 8, 12: 6, 13: 4, 15: 3, 16: 2, 17: 1,
};

// Every cull happens at 11:59 PM PDT. Days 1-3 (grace) and days 7/14
// (patch) have no entry in the threshold maps above, so isCullDay()
// covers all of them.
function getEventDay(now = new Date()) {
  const start = new Date(`${EVENT_START_DATE}T00:00:00-07:00`); // PDT
  const diffMs = now.getTime() - start.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
}

function getThreshold(bracket, day) {
  const table = bracket === 'pro' ? PRO_THRESHOLDS : CASUAL_THRESHOLDS;
  return table[day] ?? null;
}

// Scans forward from `afterDay` for the next day that actually culls
// someone, skipping grace days (1-3) and the patch day (14) — those have
// no entry in the threshold tables. Used so "in danger" previews the next
// REAL cull, not just literally-tomorrow (which is often a gap day with
// nothing scheduled). Now that Day 17 has a real Top-1 entry, this reads
// it like any other day — no special-casing needed. Returns null only
// once actually past the finale.
function getNextCullThreshold(bracket, afterDay) {
  for (let day = afterDay + 1; day <= 17; day++) {
    const threshold = getThreshold(bracket, day);
    if (threshold !== null) return threshold;
  }
  return null;
}

// Same scan as getNextCullThreshold, but returns WHICH day the next real
// cull actually lands on (not its threshold) — needed to compute a
// countdown timestamp for it. Returns null once past the finale.
function getNextCullDay(bracket, afterDay) {
  for (let day = afterDay + 1; day <= 17; day++) {
    if (getThreshold(bracket, day) !== null) return day;
  }
  return null;
}

// The actual moment (as a real Date) a given day's cull fires — 11:59 PM
// PDT of that day. dateForSimulatedDay gives midnight; add 23h59m.
function cullMomentForDay(day) {
  const midnight = dateForSimulatedDay(day).getTime();
  return new Date(midnight + (23 * 60 + 59) * 60 * 1000 + 59 * 1000);
}

// True on every day that actually culls someone (4-13, 15-17) — including
// the Day-17 finale, which now has a real Top-1 threshold.
function isCullDay(day) {
  return getThreshold('pro', day) !== null || getThreshold('casual', day) !== null;
}

// Human-readable reason a given day doesn't cull anyone — grace (1-3) vs.
// patch (14) are different things, not one generic "grace/patch" bucket.
// Only meaningful when isCullDay(day) is false; callers shouldn't call
// this for a real cull day (which now includes Day 17).
function getNonCullReason(day) {
  if (day <= 3) return 'grace day';
  if (day === 7 || day === 14) return 'patch day';
  return 'not a scheduled cull day';
}

// Pure epoch-millisecond math, deliberately NOT Date.setDate() — see
// scripts/updateLeaderboard.js's history for why setDate() is unsafe here
// (it shifts using the HOST machine's local timezone, not the -07:00
// baked into EVENT_START_DATE). Shared by every simulated-day testing path
// (scripts/updateLeaderboard.js, scripts/simulateNextDay.js, the
// /testadvancecoastalclashday command) so they all agree on what "day N"
// means as a real timestamp.
function dateForSimulatedDay(day) {
  const start = new Date(`${EVENT_START_DATE}T00:00:00-07:00`).getTime();
  return new Date(start + (day - 1) * 24 * 60 * 60 * 1000);
}

module.exports = {
  EVENT_START_DATE,
  PRO_THRESHOLDS,
  CASUAL_THRESHOLDS,
  getEventDay,
  getThreshold,
  getNextCullThreshold,
  getNextCullDay,
  cullMomentForDay,
  isCullDay,
  getNonCullReason,
  dateForSimulatedDay,
};
