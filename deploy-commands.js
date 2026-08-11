require('dotenv').config();

const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { clientId, guildIds } = require('./config.json');
const TEXT = require('./src/text');

// Guild-scoped, registered explicitly to every server in config.json's
// guildIds — appears instantly, and there's a small known list of private
// servers this bot is ever added to, so there's no real benefit to global
// commands here. (Global was tried briefly; turns out Discord shows a global
// command and a guild-scoped command with the same name as two separate
// entries in the picker instead of deduplicating, so mixing the two just
// produces confusing duplicates — guild-scoped only, consistently, avoids
// that entirely.) Adding a new server = add its id here and rerun this file.
const commands = [
  new SlashCommandBuilder()
    .setName('deployrequestbounty')
    .setDescription(TEXT.COMMANDS.deployRequestBounty.command)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('category')
        .setDescription(TEXT.COMMANDS.deployRequestBounty.category)
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName('board')
        .setDescription(TEXT.COMMANDS.deployRequestBounty.board)
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    // Optional: a role that can review/approve + gets pinged.
    .addUserOption((option) =>
      option
        .setName('staff_user')
        .setDescription(TEXT.COMMANDS.deployRequestBounty.staffUser)
        .setRequired(false),
    )
    // Optional: a specific person that can review/approve + gets pinged.
    .addRoleOption((option) =>
      option
        .setName('staff_role')
        .setDescription(TEXT.COMMANDS.deployRequestBounty.staffRole)
        .setRequired(false),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('allbounties')
    .setDescription(TEXT.COMMANDS.allBounties.command)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    // Required (Discord makes required options mandatory before the command
    // can even be run) so this is filled first — the closest thing Discord
    // has to "nothing else matters until this is picked."
    .addStringOption((option) =>
      option
        .setName('status')
        .setDescription(TEXT.COMMANDS.allBounties.status)
        .addChoices(
          { name: 'Approved', value: 'approved' },
          { name: 'Pending', value: 'pending' },
          { name: 'Claimed', value: 'claimed' },
          { name: 'Denied', value: 'denied' },
          { name: 'All', value: 'all' },
        )
        .setRequired(true),
    )
    // Always the actual sort — applied within each status group when
    // `filter` below is set, or across the whole list when it isn't. Its
    // choices never overlap with `filter`'s, so there's no combination of
    // the two that doesn't mean something.
    .addStringOption((option) =>
      option
        .setName('order')
        .setDescription(TEXT.COMMANDS.allBounties.order)
        .addChoices(
          { name: 'Newest First', value: 'newest' },
          { name: 'Oldest First', value: 'oldest' },
          { name: 'Alphabetical (A-Z)', value: 'alphabetical' },
        )
        .setRequired(false),
    )
    // Single choice (no "off" value, same idea as `export` below) — picking
    // it groups the results by status (Approved → Pending → Claimed →
    // Denied); leaving it out falls back to the old default (on for All,
    // off for a single status).
    .addStringOption((option) =>
      option
        .setName('filter')
        .setDescription(TEXT.COMMANDS.allBounties.filter)
        .addChoices({ name: 'By Status', value: 'by_status' })
        .setRequired(false),
    )
    // Independent of `status` — status is which review state to show,
    // claim_type is which of the two claim flows (one-shot vs ongoing
    // leaderboard) a bounty uses. Leaving it out shows both, same as today.
    .addStringOption((option) =>
      option
        .setName('claim_type')
        .setDescription(TEXT.COMMANDS.allBounties.claimType)
        .addChoices(
          { name: 'Claim', value: 'claim' },
          { name: 'Submissions', value: 'submissions' },
        )
        .setRequired(false),
    )
    // String (not Boolean) with a single choice, so there's no False to
    // pick — and it's defined last, so it's the last thing Discord ever
    // has left to suggest filling in.
    .addStringOption((option) =>
      option
        .setName('export')
        .setDescription(TEXT.COMMANDS.allBounties.export)
        .addChoices({ name: 'Yes', value: 'yes' })
        .setRequired(false),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('readme')
    .setDescription(TEXT.COMMANDS.readme.command)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('deployclaimbounty')
    .setDescription(TEXT.COMMANDS.deployClaimBounty.command)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    // Two separate active categories — which one a given bounty's claim
    // ticket opens in is decided per-bounty by staff during approval (see
    // the Claim Type field on the approve modal), not by this command.
    .addChannelOption((option) =>
      option
        .setName('claim_category')
        .setDescription(TEXT.COMMANDS.deployClaimBounty.claimCategory)
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName('submissions_category')
        .setDescription(TEXT.COMMANDS.deployClaimBounty.submissionsCategory)
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName('board')
        .setDescription(TEXT.COMMANDS.deployClaimBounty.board)
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    // Separate from `board` above — submissions-type bounties stay live and
    // get edited in place to show the current leader, rather than logging a
    // one-time finalized claim like `board` does.
    .addChannelOption((option) =>
      option
        .setName('submissions_board')
        .setDescription(TEXT.COMMANDS.deployClaimBounty.submissionsBoard)
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName('archive_category')
        .setDescription(TEXT.COMMANDS.deployClaimBounty.archiveCategory)
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true),
    )
    // Optional: a specific person that can review/approve claims + gets pinged.
    .addUserOption((option) =>
      option
        .setName('staff_user')
        .setDescription(TEXT.COMMANDS.deployClaimBounty.staffUser)
        .setRequired(false),
    )
    // Optional: a role that can review/approve claims + gets pinged.
    .addRoleOption((option) =>
      option
        .setName('staff_role')
        .setDescription(TEXT.COMMANDS.deployClaimBounty.staffRole)
        .setRequired(false),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('deployticket')
    .setDescription(TEXT.COMMANDS.deployTicket.command)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('category')
        .setDescription(TEXT.COMMANDS.deployTicket.category)
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true),
    )
    // Optional (unlike deployclaimbounty's required archive_category) — a
    // help ticket that never gets archived just deletes on close, same as
    // the original behavior, so there's no reason to force a choice here.
    .addChannelOption((option) =>
      option
        .setName('archive_category')
        .setDescription(TEXT.COMMANDS.deployTicket.archiveCategory)
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(false),
    )
    // Optional: a specific person that gets pinged on new tickets.
    .addUserOption((option) =>
      option
        .setName('staff_user')
        .setDescription(TEXT.COMMANDS.deployTicket.staffUser)
        .setRequired(false),
    )
    // Optional: a role that gets pinged on new tickets.
    .addRoleOption((option) =>
      option
        .setName('staff_role')
        .setDescription(TEXT.COMMANDS.deployTicket.staffRole)
        .setRequired(false),
    )
    .toJSON(),
  // Just posts the Q&A board — no category/staff to configure, since Q&A
  // never creates a ticket or touches staff at all.
  new SlashCommandBuilder()
    .setName('deployqanda')
    .setDescription(TEXT.COMMANDS.deployQandA.command)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  // Bulk-finalizes every submission bounty still pending public
  // announcement — see finalizeSubmissionBountyPrivately/
  // announceSubmissionBountyPublicly (index.js). Two-step confirmation
  // happens in the handler itself, not here.
  new SlashCommandBuilder()
    .setName('endsubmissions')
    .setDescription(TEXT.COMMANDS.endSubmissions.command)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
];

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

// Guarded so this file can also be `require()`'d (for `commands`/`clientId`)
// without re-triggering registration.
if (require.main === module) {
  (async () => {
    try {
      console.log('Clearing any leftover global commands (guild-scoped only, avoids duplicate entries)...');
      await rest.put(Routes.applicationCommands(clientId), { body: [] });

      for (const id of guildIds) {
        console.log(`Registering guild commands for ${id}...`);
        await rest.put(Routes.applicationGuildCommands(clientId, id), { body: commands });
      }
      console.log('Done. Guild commands appear instantly.');
    } catch (err) {
      console.error(err);
    }
  })();
}

module.exports = { commands, clientId };
