require('dotenv').config();

const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { clientId, guildId } = require('./config.json');
const TEXT = require('./src/text');

// Global commands (as opposed to guild-scoped) show up in every server the
// bot is invited to, automatically — no per-server registration needed as
// the bot spreads to more servers. Trade-off: Discord caches global commands
// and can take up to ~1 hour to propagate a change, unlike guild commands
// (instant) — annoying while iterating, but the right call once this isn't
// a single-server bot anymore. `guildId` is kept around only to clear out
// the old guild-scoped commands below, so they don't sit there as dupes.
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
];

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Clearing old guild-scoped commands (avoids dupes now that commands are global)...');
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });

    console.log('Registering global commands...');
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('Done. Global commands can take up to ~1 hour to show up in every server — guild-scoped ones just cleared instantly, so there may be a gap where commands are briefly missing in the old server.');
  } catch (err) {
    console.error(err);
  }
})();
