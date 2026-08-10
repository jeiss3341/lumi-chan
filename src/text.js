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
    },
    // src/bountyCard.js → buildClaimEmbed(). The card shown in claim
    // tickets and posted to the claim board.
    claim: {
      titlePrefix: '🏁 Bounty Claim:', // while the claim is pending review
      fieldClaimant: 'Claimant',
      fieldReward: 'Reward',
      fieldOriginalRequester: 'Original Requester',
    },
    // Shared "it's done" title, used once a claim is finalized — on the
    // claim ticket/board card itself (index.js → approve_claim), AND when
    // that same event overwrites the original request-board post so both
    // surfaces agree once a bounty is no longer available.
    claimedTitlePrefix: '🏁 Bounty Claimed:',
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
        description: 'What has to happen? Add all the flavor you want.',
        placeholder: 'Describe the challenge, any flavor, and how it can be verified.',
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
    // index.js → the /readme command's embed.
    title: '📖 How the Bounty System Works',
    description: [
      '**What players go through:**',
      '',
      '💰 **Requesting a Bounty**',
      '> 1. The **requester** presses **Request Bounty** on the request board and fills out a short form: an optional preferred name (falls back to their Discord nickname), name, description, reward, and whether it\'s Solo Only or Premade Allowed.',
      '> 2. They get an ephemeral preview of the bounty card. **Submit** opens a private ticket under the configured category and pings staff. **Close** cancels — nothing is created.',
      '> 3. Inside the ticket, staff **Approve** or **Deny** (closes the ticket). Approving opens a two-step edit form — Discord caps a single popup at 5 fields, so step 1 (preferred name, name, description) is followed by a **Continue** button into step 2 (tier, reward type, claim type, reward). Tier (Boot/Shrimp/Crab/Pearl/Blue NP/Treasure Chest), reward type (Money/NP Code/Merch-Items/Other), and claim type (Claim/Submissions — which ticket category this bounty\'s claim opens under) are staff-only — players never see them. Nothing is saved until step 2 is submitted.',
      '> 4. Approved bounties post to the public board and remain until claimed. Titles must be unique among approved/claimed bounties — a duplicate name blocks approval.',
      '',
      '🏁 **Claiming a Bounty**',
      '> 1. The **claimant** presses **Claim Bounty** on the claim board and picks an approved bounty from a searchable dropdown (paginated past 25 options).',
      '> 2. They submit proof — notes plus up to 3 optional screenshots/clips — which immediately opens a private claim ticket. There is no preview step here, unlike requesting.',
      '> 3. Staff **Approve Claim** (marks it claimed, removes it from the request board, posts it to the claim board, and archives the ticket) or **Deny Claim** (closes the ticket; the bounty remains claimable by others).',
      '> 4. Staff can press **Include Requester** at any time to give the original requester access to the claim ticket as well.',
      '',
      '💬 **Getting Help**',
      '> 1. **Ask a Question** replies with a topic dropdown and instant answers.',
      '> 2. **Talk to Staff** opens an optional subject/details form, then creates a private ticket. Staff close it with **Close Ticket** once resolved.',
      '',
      '**For staff:**',
      '> • **Approve** / **Deny** → reviews a request; approved posts to the board, denied just closes.',
      '> • **Approve Claim** / **Deny Claim** → finalizes a claim (updates the board, archives the ticket) or closes it, leaving the bounty claimable.',
      '> • **Include Requester** → gives the original requester access to the claim ticket too.',
      '> • **Close Ticket** → closes a general support ticket.',
      '> • `/allbounties` → review bounty history:',
      '>   — **status** *(required)*: which bounties to show — Approved, Pending, Claimed, Denied, or All.',
      '>   — **order**: sort newest first, oldest first, or A–Z.',
      '>   — **filter**: set to *By Status* to also group the results into sections.',
      '>   — **export**: set to *Yes* to get a spreadsheet instead of the on-screen list.',
      '> • `/deployrequestbounty` → sets up and posts the request board (where players submit bounty ideas).',
      '> • `/deployclaimbounty` → sets up and posts the claim board — two categories (Claim, Submissions), a shared board channel and archive category. A bounty\'s claim type (set at approval) decides which category its claim opens under.',
      '> • `/deployticket` → sets up and posts the support board (general help tickets).',
      '> • `/deployqanda` → posts the Q&A board.',
      '> • **Admin site** → [lumi-chan-production.up.railway.app](https://lumi-chan-production.up.railway.app/) — view/edit every bounty, browse active and archived tickets (with message logs), and edit all the bot\'s board/button/message text from a browser (Discord/Google login required, admin/dev only).',
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
  },
};
