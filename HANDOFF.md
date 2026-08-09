# Handoff — Lumi-Chan editable style-guide / admin page

Paste this whole file's content as your first message to a new Claude session to bring it up to speed.

---

I'm working on **Lumi-chan**, a Discord bot at `/Users/jeiss/Lumi-Chan` (Node.js, discord.js v14, Postgres via `pg`) for a "Coastal Clash" bounty event. It runs bounty request/claim/support-ticket flows for players via Discord panels, buttons, modals, and embeds — all copy for those lives in `src/text.js`.

## What was just built (this session, not yet pushed to git)

An **admin-facing editable style-guide page**, served by a small built-in HTTP server alongside the Discord bot itself. It lets a non-technical manager view every board/button/form/message the bot sends, organized by player action (Requesting a Bounty / Claiming a Bounty / Getting Help & Q&A), and **edit it directly** — edits save to Postgres and actually change what the bot posts in Discord, not just the page's own preview.

Run it locally: `node index.js` starts both the Discord client and the HTTP server (default port 3000, or `$PORT`). Visit `http://localhost:3000/`.

### File layout

Everything for this feature lives in **`src/styleGuide/`** (new this session):
- `server.js` — plain Node `http` server (no framework). Routes: `GET /` (the page), `POST /edit/:unitId` (save one card's fields), `POST /qanda/topics` (add a Q&A topic), `POST /qanda/topics/:id/delete` (remove one).
- `styleGuide.js` — builds the page HTML. Organized into ~17 small self-contained "units" (Board, Form Fields, Buttons, Card, Messages — per section), each showing a live preview above its own save form.
- `overrides.js` — Postgres-backed key/value override store (table `content_overrides`), with an in-memory cache warmed at startup (mirrors the pre-existing `settingsCache` pattern in `src/db.js`). `get(path, fallback)`, `setMany(entries)`. Also runs `migrateLegacyLineOverrides()` on boot (idempotent, safe to leave in — migrates an old storage format from earlier in this session, unlikely to ever fire again).
- `liveText.js` — **the critical piece**: `resolveText(path)` / `resolveLines(path)`, which check a saved override first and fall back to `text.js`'s default. Every bot-facing module reads copy through this now instead of `TEXT.*` directly — without it, saved edits would only affect the admin page's own preview, never the real bot. (This was a real gap caught mid-session; fixed by wiring it into `index.js`, `src/panel.js`, `src/modal.js`, `src/ticket.js`, `src/bountyCard.js`, `src/qanda.js`.)
- `fieldSchema.js` — single source of truth for every editable field: which unit it belongs to, its label, and which Discord API length limit governs it (`FIELD_KINDS`, verified against the actual installed `@discordjs/builders` validator source, not guessed — e.g. embed title 1–256, button label 1–80, modal field label 1–45). Used by both the renderer and the save-validation logic.
- `qandaTopics.js` — turns the Q&A topics (originally a fixed 6-entry object in `text.js`) into an addable/removable collection. An ordered list of topic IDs is itself saved state (`QANDA.topics.__order__`); removing a default topic just hides it, never touches `text.js`; capped at 25 (Discord's dropdown option limit).
- `textLines.js` — `linesToText`/`textToLines`, converting between `text.js`'s array-of-lines format (blank = paragraph break, `'> '` prefix = bullet) and a single `\n`-joined string for a `<textarea>`.

### Key behaviors to know before touching this

- **Multi-line fields are one `<textarea>` each**, not one input per line — a manager can freely add/remove bullets by adding/removing lines. The only convention: blank line = paragraph break, a line starting with `> ` = a bullet.
- **Validation happens server-side on submit**, using real Discord limits from `fieldSchema.js`. An invalid save does **not** redirect — it re-renders the page directly (HTTP 400) with the one failing unit's inputs showing what was actually typed plus inline errors, while its own preview stays untouched (never shows unvalidated content). Valid saves redirect (303) with a `?saved=<unitId>` toast.
- **No auth yet** — deliberately deferred. The user wants Discord OAuth + Google login with a pre-approved allowlist eventually, but explicitly said "later, not now." There's a visible warning banner on the page about this. Don't add a password/basic-auth gate unless asked — the user has a specific plan for this.
- **`esc()` in `styleGuide.js` must escape `"` and `'`**, not just `&`/`<`/`>` — a real bug earlier this session (missing quote-escaping) silently truncated any saved value containing a literal quote, because it broke the `value="..."` HTML attribute. Already fixed; don't regress it if you touch that function.
- **The Palette section (colors) is read-only** — not wired into the override/edit system yet. Out of scope so far.
- **`src/text.js` is never written to** — it's the static default; overrides layer on top of it in Postgres. Keep it that way.

### Operational gotcha (bit us repeatedly this session)

**Never run two `node index.js` processes at once.** Both connect to Discord's gateway and race to answer every interaction — the loser throws `DiscordAPIError[10062] Unknown interaction`. Before starting the bot, always check first:
```bash
pgrep -fl "node index.js"
```
Kill any existing one before starting a new one. This also applies to any one-off `node -e "..."` test script that touches the override cache — if the real server is also running, they'll maintain independent stale in-memory caches of the same Postgres data and clobber each other's writes (this happened once this session during Q&A-topic-cap testing; caused real confusion until caught).

## Current state

- **Nothing from this session is pushed to git.** `git status` shows `index.js`, `src/bountyCard.js`, `src/modal.js`, `src/panel.js`, `src/qanda.js`, `src/ticket.js` modified, and `src/styleGuide/` untracked. Last pushed commit on `origin/main` is `9a4956a`.
- Fully tested end-to-end this session: valid saves, over-limit rejection with exact boundary checks (256/257, 80/81, 45/46), textarea add/remove-bullet round-trip, Q&A add/remove (including removing a default topic and hitting the 25-topic cap), and full process-restart persistence — all confirmed working, including confirming the *live bot* (not just the page) reflects saved edits.
- There's a full implementation plan with more detail at `/Users/jeiss/.claude/plans/cuddly-wishing-bird.md` if you need the original design reasoning.
- There's also a persistent memory note at `lumi_chan_webpage_revert_plan.md` (in Claude's memory system) describing exactly how to fully revert this feature if the user ever wants to abandon it — check that if asked to undo any of this.

## Immediate next steps (pick up here)

Nothing urgent is broken — the last thing I need to do is decide whether to push this to git (and eventually deploy to Railway with a public domain, and add the auth layer later per the user's stated preference). Ask me what to work on next rather than assuming.
