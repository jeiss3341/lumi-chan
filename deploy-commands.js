require('dotenv').config();

const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { clientId, guildId } = require('./config.json');

// Guild commands (as opposed to global) appear INSTANTLY. Global commands can
// take up to an hour to propagate, which is miserable while testing. Since this
// is a one-server event bot, guild registration is exactly what you want.
const commands = [
  new SlashCommandBuilder()
    .setName('deployrequestbounty')
    .setDescription('Set up bounty requests and post the request board (staff only).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('category')
        .setDescription('The category new bounty REQUEST ticket channels will be created under.')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName('board')
        .setDescription('The public channel where approved bounties are posted.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    // Optional: a role that can review/approve + gets pinged.
    .addUserOption((option) =>
      option
        .setName('staff_user')
        .setDescription('A specific person who can approve bounties and gets pinged. (Set a role and/or a person.)')
        .setRequired(false),
    )
    // Optional: a specific person that can review/approve + gets pinged.
    .addRoleOption((option) =>
      option
        .setName('staff_role')
        .setDescription('A role that can approve bounties and gets pinged. (Set a role and/or a person.)')
        .setRequired(false),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('allbounties')
    .setDescription('List bounties by status with who reviewed them and when (staff only).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('status')
        .setDescription('Which bounties to show (defaults to approved).')
        .addChoices(
          { name: 'Approved', value: 'approved' },
          { name: 'Pending', value: 'pending' },
          { name: 'Claimed', value: 'claimed' },
          { name: 'Denied', value: 'denied' },
          { name: 'All', value: 'all' },
        )
        .setRequired(false),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('readme')
    .setDescription('How the bounty system works (staff only).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('deployclaimbounty')
    .setDescription('Set up bounty claiming and post the claim board (staff only).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('category')
        .setDescription('The category new bounty CLAIM ticket channels will be created under.')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName('board')
        .setDescription('The public channel where finalized (approved) claims are posted.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName('archive_category')
        .setDescription('Category approved claim tickets get MOVED to (make this private/staff-only).')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true),
    )
    // Optional: a specific person that can review/approve claims + gets pinged.
    .addUserOption((option) =>
      option
        .setName('staff_user')
        .setDescription('A specific person who can review claims and gets pinged. (Set a role and/or a person.)')
        .setRequired(false),
    )
    // Optional: a role that can review/approve claims + gets pinged.
    .addRoleOption((option) =>
      option
        .setName('staff_role')
        .setDescription('A role that can review claims and gets pinged. (Set a role and/or a person.)')
        .setRequired(false),
    )
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
