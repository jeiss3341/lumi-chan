# Lumi-chan

Lumi-chan is a Discord bot built for **Coastal Clash**, a community bounty
event: players propose "bounties" (challenges with a reward), staff review
and approve them, other players claim and complete them, and staff verify
and pay out. Lumi-chan runs that entire pipeline — the request/approval
flow, the claim/verification flow, general support tickets, a self-serve
Q&A board, and a full web-based admin dashboard for managing all of it
without touching Discord directly.

It's a single Node.js process: the Discord bot and a small HTTP admin
server run side by side, sharing one Postgres database.

## What it does

### For players, in Discord

- **Request a bounty** — press a button on the public board, fill out a
  short form (an optional preferred name — falls back to your Discord
  nickname — plus name, description, and reward), preview the card, and
  submit it. Submitting opens a private ticket where staff review it.
- **Claim a bounty** — press a button on the claim board, pick an approved
  bounty from a searchable dropdown (paginated past Discord's 25-option
  limit), and submit proof (notes plus up to 3 screenshots/clips, or a
  video link). This opens a private ticket for staff to verify.
- **Ask a question** — a Q&A board with a dropdown of topics that replies
  instantly with an answer. Never touches staff or creates a ticket.
- **Talk to staff** — a general support ticket for anything that isn't a
  bounty request or claim, with an optional subject/details form.

### For staff, in Discord

- **Approve / Deny** a bounty request, editing the wording/reward first if
  needed. Approving opens a two-step form — Discord caps a modal at 5
  fields, so step 1 (preferred name, name, description) leads into step 2
  (tier, reward type, reward) via a Continue button. Tier
  (None/Bronze/Silver/Gold) and reward type (Money/NP Code/Merch-Items/
  Other) are staff-only, never shown to players. Approved bounties post to
  the public board automatically.
- **Approve / Deny** a claim. Approving marks it claimed, removes it from
  the request board, posts it to a separate claim board, and moves the
  ticket into an archive category (or closes it, if none is configured).
  Staff can also **Include Requester** to loop the original requester into
  a claim ticket.
- **Close** a general support ticket, with a confirmation step first.
- **`/deployrequestbounty`** — posts the request board; sets its ticket
  category, public board channel, and staff (role and/or person).
- **`/deployclaimbounty`** — same, for the claim pipeline, plus the
  category approved claim tickets get archived to.
- **`/deployticket`** — sets up general support tickets; optionally, a
  category closed tickets get archived to instead of deleted.
- **`/deployqanda`** — posts the Q&A board.
- **`/allbounties`** — lists bounty history by status, with sort order and
  optional status grouping, or exports it as a themed `.xlsx` spreadsheet.
- **`/readme`** — an in-Discord staff walkthrough of the whole system.

### The admin web dashboard

A password-free, login-gated site (Discord or Google OAuth, checked
against an explicit allowlist — no separate account system) with three
sections:

- **Content & Style** — every board, button, form, and message the bot
  sends, organized by player action, each with a live preview above its
  own edit form. Saved edits are layered over the code's defaults in
  Postgres and take effect immediately — no redeploy, no restart.
- **Bounties** — view every bounty (filterable by status), create one
  directly (skipping the normal ticket flow — useful for sponsor
  bounties), edit its fields (name, description, reward, donator, tier,
  reward type), and freely change its status
  (pending/approved/denied/cancelled, any to any) with an inline
  confirmation. Editing or approving a bounty that's already posted
  updates its live Discord message to match.
- **Tickets** — every request/claim/help ticket, active or archived, read
  live from Discord. Click into one to read its message log (including
  attachments), and configure where each ticket type's closed channels get
  archived to.

## Under the hood

- **Runtime:** Node.js 18+, plain CommonJS (`require`), no build step.
- **Discord:** [discord.js](https://discord.js.org/) v14 — slash commands,
  buttons, select menus, modals (including modal file-upload components).
- **Database:** PostgreSQL via [`pg`](https://node-postgres.com/) — one
  `bounties` table and a generic key/value `settings` table, plus a
  `content_overrides` table backing the live-editable text system.
- **Admin site:** a framework-free `http` server (no Express) serving
  server-rendered HTML with plain `<form>` POSTs — no client-side
  JavaScript framework, no build pipeline.
- **Auth:** Discord OAuth2 and Google OAuth2, both implemented directly
  against their REST APIs (no auth library) — signed, HMAC-verified
  session cookies, checked against `ADMIN_USER_IDS` / `ADMIN_GOOGLE_EMAILS`.
- **Spreadsheet export:** [`exceljs`](https://github.com/exceljs/exceljs),
  themed to match the bot's own color palette.
- **Hosting:** deployed on [Railway](https://railway.app), which also
  hosts the Postgres instance; redeploys automatically on push to `main`.

## Project layout

```
index.js                    Discord client + the interaction router
deploy-commands.js          Registers slash commands with Discord
src/
  db.js                     Postgres access — bounties + settings
  panel.js                  The four permanent boards (request/claim/Q&A/support)
  modal.js                  The popup forms
  ticket.js                 Private ticket channel creation + buttons
  bountyCard.js             The bounty/claim embed cards
  qanda.js                  Q&A dropdown + answers
  bountyExport.js           Themed .xlsx spreadsheet export
  text.js                   Every piece of static bot copy, in one file
  styleGuide/
    server.js               The admin HTTP server + route dispatch
    auth.js                 Discord/Google OAuth2 + signed sessions
    overrides.js            Postgres-backed live text-override store
    liveText.js             Resolves an override, falling back to text.js
    styleGuide.js            Content & Style page
    bounties.js / bountyRoutes.js    Bounties admin page
    tickets.js / ticketRoutes.js     Tickets admin page
```

## Setup

1. **Install Node 18+**, then install dependencies:

   ```bash
   npm install
   ```

2. **Create a Discord application** at
   [discord.com/developers/applications](https://discord.com/developers/applications).
   Grab the bot token, and invite it to your server with the `bot` and
   `applications.commands` scopes (Send Messages / Manage Channels / Read
   Message History permissions).

3. **Set up a Postgres database** (Railway's Postgres plugin is the
   easiest if you're also hosting there).

4. **Copy `.env.example` to `.env`** and fill it in — see below for what
   each variable is for.

5. **Register the slash commands** (re-run this any time a command or its
   options change — everything else in `text.js` just needs a restart):

   ```bash
   node deploy-commands.js
   ```

6. **Start the bot:**

   ```bash
   npm start
   ```

7. In Discord, run `/deployrequestbounty`, `/deployclaimbounty`,
   `/deployticket`, and `/deployqanda` in the channels you want each board
   posted in.

## Environment variables

| Variable | Required | What it's for |
|---|---|---|
| `DISCORD_TOKEN` | yes | The bot's token. |
| `DATABASE_URL` | yes | Postgres connection string. |
| `PGSSL` | no | Set `true` if your Postgres host requires SSL. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | for admin login | From the **same** Discord application, OAuth2 tab. |
| `DISCORD_REDIRECT_URI` | for admin login | e.g. `https://your-domain/auth/callback` — must also be added to that app's OAuth2 redirect list. |
| `ADMIN_USER_IDS` | for admin login | Comma-separated Discord user IDs allowed into the admin site. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | For Google as a second login option — from Google Cloud Console. |
| `GOOGLE_REDIRECT_URI` | if using Google login | e.g. `https://your-domain/auth/google/callback`. |
| `ADMIN_GOOGLE_EMAILS` | if using Google login | Comma-separated Google account emails allowed in. |
| `SESSION_SECRET` | for admin login | Any long random string, signs the login session cookie. |
| `PORT` | no | The admin site's port; Railway sets this automatically. |

## Deploying

- Don't upload `.env` — set variables in Railway's **Variables** tab instead.
- Railway restarts on every redeploy; that's fine, every button/interaction
  uses a static or bounty-id-embedded `customId` handled centrally, so
  nothing breaks on restart.
- `node deploy-commands.js` only needs to run when a slash command itself
  changes (new command, new/changed option) — it doesn't run on every boot.
