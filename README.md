# Coastal Clash — Bounty Bot

Phase 1: the **capture path**. A user presses a button, fills out a form, and the
bot produces a clean, organized bounty card.

## What's built so far

- `/deploy` posts the bounty panel (with the **Request Bounty** button) into whatever
  channel you run it in. Staff-only (needs Manage Server).
- The button opens a 4-field modal: Name, Description, Solo/Stackable (dropdown), Amount.
- On submit, the bot builds the leni-bot-style card and shows it back to you as a preview.

## What's next (not built yet)

- Creating the private ticket channel under a category
- The claim pattern (staff hidden until one engages)
- Submit / Close buttons inside the ticket
- Posting the approved card to the public board

The modal handler in `index.js` has a clearly marked spot where all of that plugs in.

## Setup

1. **Install Node 18+** (20+ recommended), then install deps:

   ```bash
   npm install
   ```

   This pulls the latest discord.js 14.x, which is required for select menus inside
   modals (needs 14.23.0+).

2. **Create your bot** at https://discord.com/developers/applications
   - Grab the bot **token** and the application **ID** (that's your `clientId`).
   - Invite it to your server with the `bot` and `applications.commands` scopes,
     and permissions to Send Messages / Manage Channels / Read Message History.

3. **Add your token.** Copy `.env.example` to `.env` and paste your token in:

   ```bash
   cp .env.example .env
   ```

4. **Fill in `config.json`** with your `clientId` and `guildId` (your server ID).
   Leave the other IDs blank for now — they're for phase 2.

5. **Register the command** (run once, and again any time you change the command):

   ```bash
   npm run deploy
   ```

6. **Start the bot:**

   ```bash
   npm start
   ```

7. In your server, run `/deploy` in the channel you want the panel in.

## Deploying on Railway

- Don't upload `.env`. Set `DISCORD_TOKEN` in Railway's **Variables** tab instead.
- Railway restarts on every redeploy. That's fine — all buttons here use static
  customIds handled in the global interaction event, so nothing breaks on restart.
- Run `npm run deploy` locally once (or as a one-off) to register the slash command;
  it doesn't need to run on every boot.

## File map

| File | What it does |
|------|--------------|
| `index.js` | Client + the single interaction router |
| `deploy-commands.js` | Registers `/deploy` to your guild |
| `src/panel.js` | The read-only channel panel + button |
| `src/modal.js` | The 4-field request form |
| `src/bountyCard.js` | The organized bounty embed (recolors by status) |
| `src/constants.js` | Colors |
| `config.json` | Non-secret IDs |
