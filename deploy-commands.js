require('dotenv').config();

const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { clientId, guildId } = require('./config.json');
const TEXT = require('./src/text');

// Guild commands (as opposed to global) appear INSTANTLY. Global commands can
// take up to an hour to propagate, which is miserable while testing. Since this
// is a one-server event bot, guild registration is exactly what you want.
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
        .setRequired(false),
    )
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
    .addChannelOption((option) =>
      option
        .setName('category')
        .setDescription(TEXT.COMMANDS.deployClaimBounty.category)
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
    console.log('Registering guild commands...');
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log('Done. Guild commands appear instantly.');
  } catch (err) {
    console.error(err);
  }
})();
