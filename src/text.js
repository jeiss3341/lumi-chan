// ─────────────────────────────────────────────────────────────────────────────
// THE ONE FILE FOR CUSTOMIZING HOW THE BOT LOOKS AND SOUNDS.
// Every piece of static copy (titles, labels, descriptions, placeholders,
// button text, emojis, error/confirmation messages, command descriptions),
// plus the color palette and banner image, live here.
//
// What's NOT here: any message built with a template literal that bakes in
// a variable (a user mention, a channel, a bounty name, a count, etc). Those
// can't be a plain string, so they stay inline in the file that builds them
// — e.g. `✅ Bounty panel deployed. Tickets open under **${category.name}**...`
// in index.js. Search that file for the fixed part of the wording if you
// want to tweak one of those; everything fully static is here instead.
//
// ── QUICK MAP, BY WHAT YOU'RE TRYING TO CHANGE ──────────────────────────────
// (Listed in the same order the sections actually appear below.)
//
// Colors / banner image ................. VISUALS
// Shared embed footer .................... FOOTER
// The four permanent boards + buttons:
//   Request board ......................... PANEL.request
//   Claim board ........................... PANEL.claim
//   Q&A board .............................. PANEL.qanda
//   Support board .......................... PANEL.ticket
// Bounty/claim card titles + field names . CARD.request, CARD.claim
// Popup forms:
//   "Request Bounty" form ................. MODAL.bountyRequest
//   Staff's approve/edit form ............. MODAL.approveEdit
//   Claim proof form ....................... MODAL.claimProof
//   "Talk to Staff" details form .......... MODAL.ticketDetails
// Ticket buttons + "no staff configured" .. TICKET
// /readme content .......................... README
// Q&A popup's topics (public) ............ QANDA
// /allbounties status-group headers ...... ALL_BOUNTIES
// Bot's ephemeral replies/errors .......... REPLIES
// Slash command descriptions .............. COMMANDS
//   (^ that last one needs `node deploy-commands.js` re-run after editing —
//   everything else here just needs a bot restart)
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Colors used across every embed, and the banner image shown in panels
  // and cards. This used to live in a separate src/constants.js — merged
  // here so there's one file for everything you'd want to reskin.
  VISUALS: {
    COLORS: {
      brand: 0x2aa9d8, // panel / brand accent — vivid ocean blue
      pending: 0x2aa9d8, // same ocean blue while awaiting review
      approved: 0x1abc9c, // tropical turquoise, reads as "good to go"
      denied: 0xe8553d, // sunset coral, still unmistakably "no"
      // Not used for embed status (bountyCard.js only ever looks up
      // pending/approved), just extra palette pulled from the same beach/
      // ocean/racing mood board — for spreadsheet exports, future embeds, etc.
      sand: 0xe4c9a0,
      navy: 0x123c54,
      // Platform accent for the Live Now board / live announce feed —
      // muted mauve instead of Twitch's actual (much brighter) brand
      // purple, to match this palette's softer beach/ocean/racing tones
      // rather than standing out. YouTube's brand red can join here once
      // YouTube live tracking is added, so each platform reads as itself
      // at a glance instead of both sharing a generic color.
      twitch: 0x8878a8,
    },
    // Shown inside panels and bounty/claim cards. 1500x500 — the original
    // banner size (not the 3000x1000 upscale).
    BANNER_URL: 'https://i.imgur.com/mePdqer.jpeg',
  },

  // Used at the bottom of every embed across the whole bot (panels, cards,
  // /readme). One shared string so it only needs updating in one place.
  FOOTER: 'Project Lumi • Coastal Clash 🌊',

  // The four permanent boards, in the order players actually encounter
  // them: put in a request, claim it once approved, or (if something's
  // unclear) check the Q&A board / talk to a person.
  PANEL: {
    // src/panel.js → buildPanel(). The permanent request-board message.
    request: {
      title: '🏴‍☠️ Bounty Board',
      // Joined with '\n' when used — each entry is one line/paragraph.
      description: [
        'Want to put a bounty on the board? Press **Request Bounty** below.',
        '',
        "You'll fill out a short form, then a private channel opens where staff review and verify it with you.",
        '',
        '**Before you request, make sure your bounty is:**',
        '> 🧭 Verifiable & trackable (Dak.gg / Match ID)',
        '> ⚖️ Within reason — no "kill 100 Rozzis"',
        '> 🚫 Not creepy, invasive, or trolling',
        '> 📜 Within Eternal Return TOS',
      ],
      buttonLabel: 'Request Bounty',
      buttonEmoji: '🏖️',
    },
    // src/panel.js → buildClaimPanel(). The permanent claim-board message.
    claim: {
      title: '🏁 Claim a Bounty',
      description: [
        'Completed a bounty from the board? Press **Claim Bounty** below.',
        '',
        "You'll pick which bounty you're claiming and submit proof, then a private channel opens where staff verify it with you.",
        '',
        '**Before you claim, make sure you have:**',
        '> 📸 A screenshot or clip proving it',
        '> 🧭 Anything needed to verify it (Dak.gg / Match ID)',
      ],
      buttonLabel: 'Claim Bounty',
      buttonEmoji: '🏁',
    },
    // src/panel.js → buildQandAPanel(). The permanent Q&A board message —
    // entirely separate from the support board below. Its button replies
    // with a topic dropdown; nothing gets sent to staff no matter what's picked.
    qanda: {
      title: '❓ Q&A',
      description: [
        'Got a question about requesting, claiming, or the event rules? Press **Ask a Question** below.',
        '',
        "You'll pick a topic from the dropdown and get an instant answer — nothing is submitted to staff.",
      ],
      buttonLabel: 'Ask a Question',
      buttonEmoji: '❓',
    },
    // src/panel.js → buildTicketPanel(). The permanent support-ticket board
    // message — entirely separate from the Q&A board above. Its button skips
    // straight to creating a ticket, no topic picker involved.
    ticket: {
      title: '💬 Talk to Staff',
      description: [
        "Have a question or an issue? Press **Talk to Staff** below to open a private ticket.",
        '',
        "You'll get a private channel where staff can help you directly.",
        '',
        '**Before you open a ticket:**',
        '> ❓ Check the Q&A board first — it covers requesting, claiming, and common questions',
        "> 💬 Still stuck? That's exactly what this is for!",
      ],
      buttonLabel: 'Talk to Staff',
      buttonEmoji: '💬',
    },
  },

  CARD: {
    // src/bountyCard.js → buildBountyEmbed(). The card shown in request
    // tickets and posted to the request board. titlePrefix is followed by
    // the bounty's name (e.g. "🏖️ Bounty Request: The Phantom Thief").
    request: {
      titlePrefix: '🏖️ Bounty Request:', // while pending review
      approvedTitlePrefix: '✅ Bounty Approved:', // once approved, still unclaimed
      fieldRequester: 'Requester',
      fieldReward: 'Reward',
      fieldGroupType: 'Group Type',
      fieldExpires: 'Expires',
    },
    // src/bountyCard.js → buildClaimEmbed(). The card shown in claim
    // tickets and posted to the claim board.
    claim: {
      titlePrefix: '🏁 Bounty Claim:', // while the claim is pending review
      fieldClaimant: 'Claimant',
      fieldReward: 'Reward',
      fieldOriginalRequester: 'Original Requester',
      // Only added to the card once Add Premade actually adds someone (see
      // index.js add_premade_select) — not part of buildClaimEmbed's usual
      // fields, so a solo claim never shows an empty one.
      fieldTeammates: 'Teammates',
    },
    // Shared "it's done" title, used once a claim is finalized — on the
    // claim ticket/board card itself (index.js → approve_claim), AND when
    // that same event overwrites the original request-board post so both
    // surfaces agree once a bounty is no longer available.
    claimedTitlePrefix: '🏁 Bounty Claimed:',
    // src/bountyCard.js → buildLeaderboardEmbed(). The card posted to the
    // submissions board (see /deployclaimbounty) — stays live, edited in
    // place as the current leader changes, until staff runs /endsubmissions.
    submissions: {
      openTitlePrefix: '🏆 Bounty Approved:', // still open, live standing
      closedTitlePrefix: '🏆 Bounty Closed:',
      fieldStanding: 'Standing',
      noLeaderYet: 'Open — no submissions yet.',
      leadingVerb: 'is leading with', // numeric metric, still open
      wonVerb: 'won with', // numeric metric, closed
      leadingOtherVerb: 'currently has', // non-numeric metric, still open
      wonOtherVerb: 'won with', // non-numeric metric, closed
    },
  },

  MODAL: {
    // src/modal.js → buildBountyModal(). The form a player fills out to
    // request a bounty.
    bountyRequest: {
      title: 'Request a Bounty',
      name: {
        label: 'Name of Bounty',
        description: 'A short, catchy title',
        placeholder: 'The Phantom Thief',
      },
      description: {
        label: 'Description',
        description: 'What has to happen? Mention here if you want it to expire by a certain date.',
        placeholder: 'Describe the challenge, how it can be verified, and any expiry date you want.',
      },
      reward: {
        label: 'Reward',
        description: 'Whatever the reward is — cash, in-game currency, anything',
        placeholder: '$10, 250 NP, 5 gems, etc.',
      },
      donator: {
        label: 'Preferred Name',
        description: "How you'd like to be credited — leave blank to use your Discord nickname",
        placeholder: 'e.g. Squortle',
      },
      groupType: {
        label: 'Group Type',
        description: 'Solo only, or can a premade group complete it together?',
      },
    },
    // src/modal.js → buildApproveModalStep1()/buildApproveModalStep2(). Staff's
    // edit-before-approve form — pre-filled with the bounty's current values,
    // so no placeholders. Split across two modals (see modal.js).
    approveEdit: {
      title: 'Review & Approve Bounty',
      donator: {
        label: 'Preferred Name',
        description: "Who to credit — leave blank to use the requester's current Discord nickname",
      },
      // Shown instead of the singular version above when the bounty's
      // Group Type is Premade Allowed — same field (bounty_donator), just a
      // label/hint reminding staff this is where the whole team's names go,
      // gathered by talking it over with the requester in the ticket, not
      // just the one requester's own name.
      donatorPremade: {
        label: 'Preferred Name(s)',
        description: 'Whole premade team — list each preferred name if someone doesn\'t want their Discord nickname shown',
      },
      name: {
        label: 'Name of Bounty',
        description: 'Edit if needed — this is what ships to the board',
      },
      description: {
        label: 'Description',
        description: 'Edit if needed — this is what ships to the board',
      },
      reward: {
        label: 'Reward',
        description: 'Whatever the reward is — cash, in-game currency, anything',
      },
      rewardType: {
        label: 'Reward Type',
        description: 'Money, NP Code, Merch/Items, or Other — staff only, never shown to players',
      },
      tier: {
        label: 'Tier',
        description: 'Reward tier — staff only, never shown to players',
      },
      claimType: {
        label: 'Claim Type',
        description: 'Which claim-ticket category this opens under later — staff only',
      },
      // Only shown as a 3rd modal step when Claim Type above is Submissions —
      // defines the bounty's leaderboard once, up front, so it's never asked
      // again on individual claims.
      submissionMetricKind: {
        label: 'Tracked By',
        description: 'Numeric (enter a value each time, e.g. kills) or Other (staff judgment call, e.g. best clip)',
      },
      submissionMetricLabel: {
        label: 'Label',
        description: 'e.g. "kills" for a numeric bounty, or "best clip" for a judgment-call one',
      },
      isExpiring: {
        label: 'Bounty Expires',
        description: 'Yes shows a day picker after this step — expires 11:59 PM PST on the day picked',
      },
    },
    // src/modal.js → buildClaimProofModal(). The claimant's proof form.
    // titlePrefix is followed by the bounty's name, e.g. "Claim: The Phantom Thief".
    claimProof: {
      titlePrefix: 'Claim:',
      notes: {
        label: 'Proof / Notes',
        description: 'What did you do, and how can staff verify it? Links welcome.',
        // Discord caps uploads at 10MB unless the server hits Boost Level 2
        // (50MB), and even that isn't much for a gameplay clip — so video
        // proof is steered to a link here rather than the upload field.
        placeholder: 'How you completed it and how staff can verify. Paste a video link (YouTube/Streamable) here.',
      },
      files: {
        label: 'Proof (Screenshot or Video)',
        description: 'Optional — screenshots, under 10MB each. For video, paste a link in Proof / Notes above.',
      },
    },
    // src/modal.js → buildTicketDetailsModal(). Optional subject/details for
    // a "Talk to Staff" ticket, popped when its panel button is pressed —
    // like an email's subject + body, both skippable.
    ticketDetails: {
      title: 'Talk to Staff', // the modal's title bar
      subject: {
        label: 'Subject',
        description: 'A short summary (optional)',
        placeholder: "What's this about?",
      },
      body: {
        label: 'Details',
        description: 'Optional — anything else staff should know',
        placeholder: 'Type as much or as little as you want...',
      },
    },
  },

  TICKET: {
    // src/ticket.js → previewButtons(). Shown on the ephemeral preview
    // before a request ticket exists.
    submitButton: 'Submit',
    submitEmoji: '📥',
    closeButton: 'Close',
    closeEmoji: '',
    // src/ticket.js → staffReviewButtons(). Buttons inside a request ticket.
    approveBountyButton: 'Approve',
    approveBountyEmoji: '✅',
    denyBountyButton: 'Deny',
    denyBountyEmoji: '⛔',
    // src/ticket.js → claimReviewButtons(). Buttons inside a claim ticket.
    approveClaimButton: 'Approve Claim',
    approveClaimEmoji: '✅',
    denyClaimButton: 'Deny Claim',
    denyClaimEmoji: '⛔',
    // Grants the original bounty requester access to the claim ticket too,
    // in case they want to weigh in before it's approved.
    includeRequesterButton: 'Include Requester',
    includeRequesterEmoji: '👥',
    // Only shown on premade-type claims — opens a native Discord user-search
    // picker (src/ticket.js → addPremadeSelectRow) so staff can grant the
    // claimant's teammates access to the ticket too.
    addPremadeButton: 'Add Premade',
    addPremadeEmoji: '🤝',
    addPremadePlaceholder: 'Search for teammates to add…',
    // index.js → promoteSubmissionLeader(). Posted in a displaced leader's
    // ticket when someone else takes the lead — %s is replaced with a
    // mention of whoever surpassed them.
    submissionSurpassedNote:
      '⚠️ This submission was surpassed by %s and is no longer leading — archiving this ticket. A new (better) submission from the same person would be a fresh claim ticket, judged the same as any other.',
    // src/ticket.js → createHelpTicket(). The one button inside a general
    // support ticket — no approve/deny here, just closing it once resolved.
    closeHelpButton: 'Close Ticket',
    closeHelpEmoji: '🔒',
    // The ephemeral (staff-only) "are you sure?" confirmation shown after
    // pressing Close Ticket, before it actually closes/archives anything.
    confirmCloseHelpButton: 'Yes, Close It',
    cancelCloseHelpButton: 'Cancel',
    // src/ticket.js → createTicket()/createClaimTicket()/createHelpTicket().
    // Shown instead of a staff ping when no staff role/person is configured
    // for that pipeline yet.
    noRequestStaffConfigured:
      '⚠️ No staff is configured — a staff member should run `/deployrequestbounty` to set one.',
    noClaimStaffConfigured:
      '⚠️ No staff is configured — a staff member should run `/deployclaimbounty` to set one.',
    noHelpStaffConfigured:
      '⚠️ No staff is configured — a staff member should run `/deployticket` to set one.',
  },

  README: {
    // index.js → the /readme command's embed, now 3 paginated pages
    // (Previous/Next buttons, customId `readme_page_N`) instead of one
    // long embed — kept it a single /readme command per the user's call,
    // just multi-page now that Coastal Clash's deploy docs got folded in.
    pages: [
      {
        title: '📖 How the Bounty System Works (1/3) — Players',
        description: [
          '💰 **Requesting a Bounty**',
          '> 1. Press **Request Bounty** on the request board and fill out a short form: an optional preferred name (falls back to your Discord nickname), name, description, reward, and whether it\'s Solo Only or Premade Allowed.',
          '> 2. You get an ephemeral preview of the bounty card. **Submit** opens a private ticket and pings staff. **Close** cancels — nothing is created.',
          '> 3. Staff review it (see page 2). Once approved, it posts to the public board.',
          '',
          '🏁 **Claiming a Bounty**',
          '> 1. Press **Claim Bounty** on the claim board and pick an approved bounty from a searchable dropdown (paginated past 25 options).',
          '> 2. Submit proof — notes plus up to 3 optional screenshots/clips — which immediately opens a private claim ticket. No preview step here, unlike requesting.',
          '> 3. Staff review it. For a normal bounty, an approved claim finishes it for good — it comes off the board.',
          '',
          '🏆 **Submitting to a Leaderboard Bounty**',
          '> Some bounties (score chases, best-clip contests) aren\'t first-come-first-served — they stay open on their own **submissions board**, always showing whoever\'s currently best. Claiming one works exactly like above (proof + private ticket), but:',
          '> • If staff approve your submission and you\'re currently the best, you become the **leader** — shown live on the submissions board.',
          '> • If someone later submits something better, they take your spot and your ticket is archived — submit a new (better) claim any time to get back in contention.',
          '> • The bounty stays open until staff run **/endsubmissions**, declaring whoever\'s leading at that moment the winner.',
          '',
          '💬 **Getting Help**',
          '> 1. **Ask a Question** replies with a topic dropdown and instant answers.',
          '> 2. **Talk to Staff** opens an optional subject/details form, then creates a private ticket. Staff close it with **Close Ticket** once resolved.',
          '',
          '🌐 **Admin site** → [lumi-chan-production.up.railway.app](https://lumi-chan-production.up.railway.app/)',
        ],
      },
      {
        title: '📖 How the Bounty System Works (2/3) — Staff',
        description: [
          '📋 **Reviewing a Request**',
          '> • **Approve** opens a 2-step edit form: step 1 (preferred name, name, description, tier, claim type) → step 2 (reward type, reward — plus, for Submissions, what the leaderboard tracks: a number like kills, or a judgment call like best clip). Nothing saves until the last step.',
          '> • Premade bounties: the preferred-name field becomes **Preferred Name(s)** — list the whole team.',
          '> • **Deny** just closes the ticket.',
          '> • Titles must be unique among approved/claimed bounties — a duplicate name blocks approval.',
          '',
          '🏁 **Reviewing a Claim**',
          '> • **Approve Claim** on a normal bounty finalizes it for good — posts to the claim board, archives the ticket, removes it from the board.',
          '> • **Approve Claim** on a Submissions bounty instead promotes that claimant to leader (asks for a numeric value first, if that\'s what it tracks) — the first approved claim posts the live board card; the submissions board updates in place after that, and whoever they just beat gets their ticket archived.',
          '> • **Deny Claim** archives the ticket without changing the bounty — it (or, for Submissions, the leaderboard spot) stays open to try again.',
          '> • **Include Requester** adds the original requester to the ticket; **Add Premade** *(Premade Allowed or Roll Required only)* adds teammates via a member picker — they show up as a **Teammates** field on the card.',
          '> • **/endsubmissions** (staff-only slash command, two-step confirmation) finalizes and publicly announces every pending Submissions bounty at once — declares each one\'s leader the winner and logs it to the claim board.',
          '',
          '🛠️ **Ongoing Tools**',
          '> • `/allbounties` → review bounty history: **status** *(required)* — Approved/Pending/Claimed/Denied/All; **order** — newest/oldest/A–Z; **filter** — *By Status* to group results; **export** — *Yes* for a spreadsheet instead of the on-screen list.',
          '> • **Admin site** → [lumi-chan-production.up.railway.app](https://lumi-chan-production.up.railway.app/) — view/edit bounties (including live Submissions standings), browse tickets with message logs, and edit all board/button text (Discord/Google login, admin/dev only).',
        ],
      },
      {
        title: '📋 Every /deploy Command (3/3) — Deployment',
        description: [
          'Each of these gets run once, in whichever channel you want that piece to live. Discord will ask you to fill in a few things (which category, which channel, who reviews it) — just follow the prompts. Re-run any of them any time to move something or change its settings.',
          '',
          '**💰 Bounty System**',
          '> • **`/deployrequestbounty`** — sets up requests and posts the request board.',
          '> • **`/deployclaimbounty`** — sets up claiming, including the live Submissions leaderboard.',
          '> • **`/deployticket`** — sets up general "talk to staff" support tickets.',
          '> • **`/deployqanda`** — posts the Q&A board (no setup needed, just run it).',
          '',
          '**🌊 Coastal Clash**',
          '> • **`/deployproleaderboard`** / **`/deploycasualleaderboard`** — posts that bracket\'s live standings, updating automatically all event.',
          '> • **`/deployislive`** — posts the "Live Now" board (who\'s streaming Eternal Return right now).',
          '> • **`/deployliveupdate`** — posts an alert every time someone goes live playing Eternal Return.',
          '',
          '⚠️ The Coastal Clash boards are shared across every server the bot is in — running one of those three in the wrong server will move the real board there by mistake.',
          '',
          '🗑️ Deleting a Coastal Clash board message tells the bot to stop, not to repost it — just re-run the command to bring it back.',
          '',
          '🌐 **Admin site** → same site as page 1, also has a **Leaderboard** page for editing Coastal Clash players (region, Twitch link, bracket).',
        ],
      },
    ],
  },

  // src/qanda.js → the Q&A board's dropdown (open to anyone, entirely
  // separate from the support-ticket system). Object keys become the
  // dropdown's option values; insertion order is the order topics appear in
  // the list. Each topic needs label/description (shown in the dropdown
  // itself) and title/body (shown as the embed once that topic is picked).
  QANDA: {
    prompt: 'Which question do you have?',
    selectPlaceholder: 'Choose a topic',
    topics: {
      request: {
        label: '🏖️ How do I request a bounty?',
        description: 'Putting a bounty on the board',
        title: '🏖️ Requesting a Bounty',
        body: [
          '1. Press **Request Bounty** on the bounty board.',
          '2. Fill out the form: name, description, and reward.',
          '3. Review your preview — press **Submit** to send it to staff, or **Close** to cancel.',
          '4. A private ticket channel opens where staff review it with you.',
        ],
      },
      claim: {
        label: '🏁 How do I claim a bounty?',
        description: 'Claiming a bounty you completed',
        title: '🏁 Claiming a Bounty',
        body: [
          '1. Press **Claim Bounty** on the claim board.',
          '2. Pick which approved bounty you completed from the dropdown.',
          '3. Fill out proof — notes, plus an optional screenshot or clip.',
          '4. A private ticket opens where staff verify your claim.',
        ],
      },
      rules: {
        label: '📜 What makes a bounty valid?',
        description: 'Rules to follow before requesting',
        title: '📜 Before You Request',
        body: [
          '> 🧭 Verifiable & trackable (Dak.gg / Match ID)',
          '> ⚖️ Within reason — no "kill 100 Rozzis"',
          '> 🚫 Not creepy, invasive, or trolling',
          '> 📜 Within Eternal Return TOS',
        ],
      },
      proof: {
        label: '📸 What proof do I need to claim?',
        description: "What staff need to verify it's really done",
        title: '📸 Before You Claim',
        body: [
          '> 📸 A screenshot or clip proving it (optional, but recommended)',
          '> 🧭 Anything else needed to verify it (Dak.gg / Match ID)',
          '',
          'Staff review every claim manually, so the easier it is to verify, the faster it gets approved.',
        ],
      },
      review: {
        label: '⏳ What happens after I submit?',
        description: 'How the review process works',
        title: '⏳ After You Submit',
        body: [
          'Both requests and claims open a private ticket where staff review it with you.',
          '',
          '**For a bounty request:**',
          '> ✅ **Approved** → it goes live on the board for others to claim.',
          '> ⛔ **Denied** → the ticket closes; nothing gets posted.',
          '',
          '**For a claim:**',
          '> ✅ **Approved Claim** → you get credit; it\'s marked claimed.',
          '> ⛔ **Denied Claim** → the ticket closes, but the bounty stays open for anyone to claim.',
        ],
      },
      event: {
        label: '❓ Event rules & payment FAQ',
        description: 'Premades, shared pool, payouts, and more',
        title: '❓ Event Rules & Payment',
        body: [
          '**Are premades allowed?**',
          "> Yes — but not every bounty allows them. Each bounty states whether it's Solo-only or Stack-eligible.",
          '',
          '**Is the bounty pool shared?**',
          '> Yes, the same pool covers both the Casual and Pro brackets.',
          '',
          "**Can I still complete bounties after I'm eliminated?**",
          '> Yes — as long as you still meet the streamer requirement (60% of games streamed).',
          '',
          '**How & when do I get paid?**',
          '> All bounties are paid in **$ USD** via **PayPal only**, at the **end of the event**.',
          '> Unclaimed bounties return to the sponsor or roll into the next event.',
          '> PayPal may take a small fee out of your payout.',
        ],
      },
    },
  },

  // index.js → /allbounties, when status:all is picked. Section header shown
  // above each status group in the results — and since JS objects keep
  // insertion order, THIS ORDER is also the order the groups are shown in.
  // Reorder these keys to change the category order; edit a value to change
  // that header's text.
  ALL_BOUNTIES: {
    approved: '✅ Approved',
    pending: '⏳ Pending',
    claimed: '🏁 Claimed',
    denied: '⛔ Denied',
  },

  // index.js → short ephemeral replies/errors sprinkled through the
  // interaction handler. Grouped below by which step triggers them — the
  // group comments are just for scanning, they don't affect anything.
  REPLIES: {
    // /deployrequestbounty, /deployclaimbounty, /deployticket — shown if
    // neither a staff role nor a staff person was picked.
    missingRequestStaff: '⚠️ Set at least a staff role or a staff person to review bounties.',
    missingClaimStaff: '⚠️ Set at least a staff role or a staff person to review claims.',
    missingTicketStaff: '⚠️ Set at least a staff role or a staff person to handle tickets.',

    // Requesting a bounty (form → preview → submit).
    requestExpired: '⚠️ This request expired. Please start again from **Request Bounty**.',
    requestCancelled: '❌ Cancelled. No ticket was created.',
    requestPreview:
      "Here's your bounty preview. Press **Submit** to open a private ticket and send it to staff — or **Close** to cancel. Nothing is created until you submit.",
    bountyMissing: '⚠️ This bounty no longer exists in the database.',

    // Claiming a bounty (pick from dropdown → proof → submit). Discord's
    // select menu caps at 25 options, so once there are more approved
    // bounties than that, Prev/Next buttons page through them 25 at a time.
    noClaimableBounties: '🏝️ No approved bounties are available to claim right now.',
    claimPickPrompt: 'Which bounty are you claiming?',
    claimSelectPlaceholder: 'Choose a bounty to claim',
    claimPrevButton: '◀ Prev',
    claimNextButton: 'Next ▶',
    claimBountyUnavailable: '⚠️ That bounty is no longer available to claim.',
    claimNoLongerAvailable: '⚠️ This bounty is no longer available to claim (it may have already been claimed).',
    claimFinalizeFailed:
      '⚠️ Could not finalize this claim — the bounty may have already been claimed elsewhere, or its record is missing.',
    includeRequesterFailed: "⚠️ Couldn't find the original requester on this card.",

    // Duplicate-title prevention (request submit + staff approve/edit).
    // %s is replaced with the conflicting bounty's exact title.
    requestTitleTaken:
      '⚠️ A bounty named **%s** is already approved or claimed. Please pick a different name and try again.',
    approveTitleTaken:
      '⚠️ A bounty named **%s** is already approved or claimed. Change this bounty\'s name and press **Approve** again.',

    // /allbounties' `export:Yes` option. %s is replaced with the count.
    exportReady: '📊 Your spreadsheet is ready — %s bounties exported.',

    // Catch-all, used when nothing more specific applies.
    genericError: 'Something went wrong. Please ping staff.',
  },

  // deploy-commands.js → slash command + option names as they appear in
  // Discord's "/" picker. Editing these requires re-running
  // `node deploy-commands.js` to push the change to Discord — everything
  // else in this file just needs a bot restart.
  COMMANDS: {
    deployRequestBounty: {
      command: 'Set up bounty requests and post the request board (staff only).',
      category: 'The category new bounty REQUEST ticket channels will be created under.',
      board: 'The public channel where approved bounties are posted.',
      staffUser: 'A specific person who can approve bounties and gets pinged. (Set a role and/or a person.)',
      staffRole: 'A role that can approve bounties and gets pinged. (Set a role and/or a person.)',
    },
    allBounties: {
      command: 'List bounties by status with who reviewed them and when (staff only).',
      status: 'Which bounties to show.',
      order: 'How to sort the results (defaults to newest first).',
      filter: 'Filter the results into groups by status too (default: on for All).',
      claimType: 'Only show Claim-type or Submissions-type bounties (default: both).',
      export: 'Get a themed spreadsheet (.xlsx) instead of the on-screen list.',
    },
    readme: {
      command: 'How the bounty system works (staff only).',
    },
    deployClaimBounty: {
      command: 'Set up bounty claiming and post the claim board (staff only).',
      claimCategory: 'The category new CLAIM-type bounty claim tickets will be created under.',
      submissionsCategory: 'The category new SUBMISSIONS-type bounty claim tickets will be created under.',
      board: 'The public channel where finalized (approved) claims are posted.',
      submissionsBoard: 'Public channel for SUBMISSIONS-type bounties — stays live, edited to show the current leader.',
      archiveCategory: 'Category approved claim tickets get MOVED to (make this private/staff-only).',
      staffUser: 'A specific person who can review claims and gets pinged. (Set a role and/or a person.)',
      staffRole: 'A role that can review claims and gets pinged. (Set a role and/or a person.)',
    },
    deployTicket: {
      command: 'Set up general "talk to staff" support tickets (staff only).',
      category: 'The category new support ticket channels will be created under.',
      archiveCategory: 'Category closed tickets move to (staff-only). Unset = delete on close, as before.',
      staffUser: 'A specific person who gets pinged on new tickets. (Set a role and/or a person.)',
      staffRole: 'A role that gets pinged on new tickets. (Set a role and/or a person.)',
    },
    deployQandA: {
      command: 'Post the Q&A board in this channel (staff only).',
    },
    deployProLeaderboard: {
      command: 'Post the live Coastal Clash Pro bracket leaderboard here (staff only, auto-updates).',
    },
    deployCasualLeaderboard: {
      command: 'Post the live Coastal Clash Casual bracket leaderboard here (staff only, auto-updates).',
    },
    deployIsLive: {
      command: 'Post the live Coastal Clash "who is live" board here (staff only, auto-updates).',
    },
    deployLiveUpdate: {
      command: 'Post a new alert here whenever a player switches into Eternal Return on Twitch.',
    },
    dayChange: {
      command: 'TEST ONLY: advance the simulated Coastal Clash day by one and refresh the live board.',
    },
    dayPrevious: {
      command: 'TEST ONLY: go back one simulated Coastal Clash day and refresh the live board.',
    },
    endSubmissions: {
      command: 'Finalize and publicly announce every pending submission bounty at once (staff only).',
    },
  },
};
