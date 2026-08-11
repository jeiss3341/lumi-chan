# Handoff — Lumi-Chan, Coastal Clash bounty bot

Paste this whole file as your first message to a new Claude session (or read it yourself) to get oriented before touching anything.

---

## What this is

**Lumi-chan** is a Discord bot (Node.js, discord.js v14, Postgres via `pg`) for a "Coastal Clash" community event. It runs a full bounty lifecycle — request → staff approval → claim (or ongoing leaderboard-style submission) → finalized — plus general support tickets and a Q&A board. There's also a small built-in admin website (same process, served over HTTP) for staff to browse/edit bounties and tickets without going through Discord.

**Hosting**: Railway. Pushing to the `main` branch on GitHub triggers an automatic redeploy — Railway restarts the bot and admin site with whatever's on `main`, using its own `DATABASE_URL` (set in Railway's dashboard, not from any local file).

**You do not have to babysit this.** Every Discord interaction is wrapped in a try/catch (`index.js`, the big `client.on(Events.InteractionCreate, ...)` handler) — a bug in one button/command shows up as a generic "something went wrong" ephemeral reply to whoever triggered it, not a crash. If the whole process does crash, Railway restarts it automatically. The main risk isn't downtime, it's a *wrong* behavior nobody notices for a while (no automated tests exist — see below).

---

## Current state (as of this handoff)

- `main` is up to date with everything described below — nothing is sitting uncommitted or unpushed.
- The most recent real work (same session as this handoff) was a substantial rework of the **submissions-type bounty lifecycle** — see "How submissions bounties work" below, it's the newest and least battle-tested part of the codebase.
- Slash commands are registered and current on both guilds (main server + test server) — `/endsubmissions` exists, `/allbounties` has a `claim_type` filter option.
- A **local-only Postgres database** now exists on this Mac (`lumi_local`, via Homebrew) — local dev no longer shares a database with production. See "Local dev setup" below; this matters a lot if you do any local testing.

---

## How the bounty system works

Two bounty types, chosen by staff at approval time (`claim_type`: `claim` or `submissions`):

1. **Request** — a player fills out a form, staff reviews it in a private ticket, approves or denies. An approved bounty (either type) posts the same plain card to the `#approved`-equivalent board channel (configured via `/deployrequestbounty`'s `board` option). Denying just closes the ticket, nothing posted.

2. **Claim-type** (the simple, one-shot kind): a player claims it (proof + private ticket), staff presses **Approve Claim**, and it's done for good — posts to the `#claimed`-equivalent board (`/deployclaimbounty`'s `board` option), ticket archived.

3. **Submissions-type** (ongoing leaderboard, e.g. score chases or best-clip contests): players submit the same way (proof + private ticket), but **Approve Claim promotes the claimant to current leader** instead of finalizing anything. The *first* approved submission creates a **live leaderboard card** in the submissions board channel (`/deployclaimbounty`'s `submissions_board` option) — this card gets **edited in place** every time someone new takes the lead. Whoever gets beaten has their ticket **archived immediately** as `submission-lost-<bounty>` (not reopened — this used to reopen tickets for reconsideration, which was fragile and got removed this session, see below). The bounty stays open indefinitely until staff runs **`/endsubmissions`**.

4. **`/endsubmissions`** — staff-only, two-step confirmation ("are you sure" → "really sure"). Finalizes and **publicly announces every pending submissions bounty at once**: declares each one's current leader the winner, deletes the live leaderboard post from the submissions channel, and posts a final "Bounty Closed" card to `#claimed`. This is now the **only** way to close a submissions bounty — there used to be an individual "Close Bounty" button on each live leaderboard card, but it was removed this session in favor of `/endsubmissions` handling everything (the user's explicit call).

Every ticket (regardless of outcome — claimed, denied, won, lost) gets **archived, never deleted**: moved to a dedicated archive category and renamed (`declared-claim-`, `denied-claim-`, `submission-won-`, `submission-lost-`, etc.), so the full history stays inspectable in Discord and on the admin site's Tickets page. See "Known risks" below for why this matters.

The admin website (nav: Content & Style / Bounties / Tickets) can also edit a bounty's fields or deny/cancel it after the fact — for submissions bounties, this now syncs (or removes) the live leaderboard card too, not just the static `#approved`-equivalent record.

---

## Local dev setup

There is now a **separate, local-only Postgres database** on this machine, specifically so local testing can never again touch production data:

- Installed via Homebrew: `brew services start postgresql@16` (should already be running; if not, that's the command to restart it).
- Database name: `lumi_local`.
- `.env`'s `DATABASE_URL` points at `postgres://localhost/lumi_local`. **The original production connection string is commented out directly below it in `.env`** — don't delete that line, it's the only record of the real value outside Railway's dashboard.
- The local bot is scoped to the test guild via `.env`'s `ACTIVE_GUILD_ID` — this makes the locally-running process ignore interactions from the main server (see `index.js` around the `InteractionCreate` handler's very first lines).
- `lumi_local` starts empty of bounty data, but was seeded once with a copy of production's `settings` and `content_overrides` tables (text/style customizations) — **only the guild-agnostic `content_overrides` rows are actually correct**; the `settings` rows (channel/category/role IDs) were copied from the *main* server and need to be redone by re-running `/deployrequestbounty`, `/deployclaimbounty`, `/deployticket` once in the *test* server if they haven't been already.
- **Never run two `node index.js` processes at once** (local + something else) — both would connect to Discord's gateway and race to answer every interaction; the loser throws `DiscordAPIError[10062] Unknown interaction`. Check first: `pgrep -fl "node index.js"`.

---

## Known risks / things to watch

Ranked roughly by how likely they are to actually bite:

1. **No automated tests.** Every change this whole session was verified by hand (local testing, reading the diff, tracing code paths). A fix made without that care could silently regress something. Be extra careful with anything touching `promoteSubmissionLeader`, `finalizeSubmissionBountyPrivately`, or `announceSubmissionBountyPublicly` in `index.js` — that's this session's newest code.

2. **The shared-database mistake is easy to repeat.** This exact incident already happened once: testing locally against the *same* database as production silently overwrote a real production setting (a ticket category ID) and broke real ticket creation on the main server, with a confusing "Category does not exist" error as the only symptom. Local dev is now isolated (`lumi_local`, see above) specifically to prevent this — **if anyone ever "fixes" `.env` back to the production connection string for convenience, this can happen again.** If you see `parent_id[CHANNEL_PARENT_INVALID]: Category does not exist` in Railway's logs, this family of bug is the first thing to check — specifically, whether `settings` in the *production* database has a category/channel ID that doesn't actually exist in the main guild.

3. **Discord channel count.** Every finished ticket is archived (renamed + moved), never deleted — none of them ever come back down. Discord's hard limit is 500 channels per guild (categories count, threads don't). A long-running event with many submissions-type bounties (each losing submission leaves a permanent archived channel) could approach this over time. Nothing has been built to address this yet — it was flagged, not fixed, this session. Two options discussed: (a) auto-delete archived tickets past some retention window (small, contained fix), or (b) rebuild tickets as Discord threads instead of channels (threads don't count against the limit at all, but it's a real rewrite — thread permissions work completely differently from channel `permissionOverwrites`, role-based access doesn't translate directly). If you're reading this because the bot can't create a new ticket channel and the error mentions a channel/category limit, this is why.

4. **Slash command registration is a separate manual step from deploying code.** Pushing to `main` deploys the *code*, but adding/changing a slash command's definition (`deploy-commands.js`) additionally requires running `node deploy-commands.js` once, by hand — it is **not** automatic on push. This registers to *every* guild in `config.json`'s `guildIds` (currently both the main server and the test server) in one shot. If a new/changed command doesn't show up in Discord after a deploy, this is almost certainly why.

5. **The `submissions_finalized` column matters.** If `/endsubmissions` ever partially fails (some bounties finalize, one throws mid-way), it's designed to be safe to just run again — it only ever touches bounties where `submissions_finalized` is still `false`. Don't manually flip that column in the database unless you're sure a bounty's public announcement actually went out; if you do it wrongly, that bounty will never get announced by `/endsubmissions` again (silently skipped).

---

## How to actually ship a fix

1. Make the change, test it locally against `lumi_local` first if at all possible (start the bot: `pgrep -fl "node index.js"` to check nothing's already running, then `npm start`).
2. Commit directly to `main` (this session didn't use long-lived feature branches — small working-tree changes, committed and pushed once verified) — or a short branch if you want a clean diff to review first, doesn't matter, just merge/push to `main` when ready.
3. **Stage files by name, never `git add -A`/`.`** — there's real risk of accidentally picking up something you didn't mean to (this was a deliberate practice the whole session, to avoid `.env` or stray local artifacts ever ending up in a commit — though `.env` is also gitignored as a backstop).
4. `git push origin main` — Railway redeploys automatically. It restarts the process, which briefly drops any in-flight button click, but nothing is lost (archived tickets, DB rows, etc. are all safe either way).
5. If you touched `deploy-commands.js`, also run `node deploy-commands.js` by hand (see risk #4 above) — this hits **production**, so double-check the change is actually right before running it.
6. Check Railway's dashboard logs after deploying to confirm a clean boot (`Database ready.`, `Logged in as Lumi-chan#...`, no immediate errors).

---

## Where to look for more

- Every non-obvious decision in the code has an inline comment explaining *why*, not just what — this codebase leans heavily on that instead of separate docs. If something looks surprising, read the comment above it before assuming it's a bug.
- `git log --oneline` — commit messages are detailed and explain reasoning, not just "fix bug."
- `README.md` — setup instructions, environment variables, deploy notes.
- Claude's plan files under `/Users/jeiss/.claude/plans/` capture the reasoning behind specific past changes, but get overwritten by later, unrelated planning sessions — don't treat any specific plan filename as a stable reference, they're transient by design.

## A couple of standing preferences worth knowing

- Bulk, public, hard-to-undo actions (like `/endsubmissions`) get a **two-step** confirmation, not just one — this was an explicit, deliberate choice, not an oversight. Don't "simplify" it back to one step without checking first.
- The user generally prefers things default to **private/staff-only first, with an explicit separate step to go public** — that's why Close Bounty went private-only and `/endsubmissions` is the deliberate public-announcement step. Keep that pattern in mind if adding anything new to the closing flow.
