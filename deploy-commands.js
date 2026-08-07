require('dotenv').config();

const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { clientId, guildId } = require('./config.json');

// Guild commands (as opposed to global) appear INSTANTLY. Global commands can
// take up to an hour to propagate, which is miserable while testing. Since this
// is a one-server event bot, guild registration is exactly what you want.
const commands = [
  new SlashCommandBuilder()
    .setName('deploy')
    .setDescription('Set the category, staff role, and board channel, then post the panel (staff only).')
    // Only members who can Manage Server see/use this command.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    // Required: which category new ticket channels get created under.
    .addChannelOption((option) =>
      option
        .setName('category')
        .setDescription('The category new bounty ticket channels will be created under.')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true),
    )
    // Required: which role can review, approve, and deny bounties.
    .addRoleOption((option) =>
      option
        .setName('staff')
        .setDescription('The role allowed to review and approve bounties.')
        .setRequired(true),
    )
    // Required: which channel approved bounties get posted to for players to browse.
    .addChannelOption((option) =>
      option
        .setName('board')
        .setDescription('The public channel where approved bounties are posted.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
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
          { name: 'Denied', value: 'denied' },
          { name: 'All', value: 'all' },
        )
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