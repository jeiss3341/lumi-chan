// Path to Glory · go-live announcements: one purple message per coach when
// they start streaming Eternal Return with [PTG] in the title, in the channel
// set by PTG_ANNOUNCE_CHANNEL_ID (Railway variable). Same look as the Coastal
// Clash announcements (src/coastalClash/embed.js postLiveAnnouncements).
const { EmbedBuilder } = require('discord.js');
const { VISUALS } = require('../text');

async function announceGoLive(client, started) {
  const channelId = process.env.PTG_ANNOUNCE_CHANNEL_ID;
  if (!channelId || !started.length) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) { console.error('[ptg] PTG_ANNOUNCE_CHANNEL_ID is not a text channel.'); return; }
    for (const { coach, stream } of started) {
      const embed = new EmbedBuilder()
        .setTitle(`🟣 ${coach.name || stream.user_name} is now live!`)
        .setColor(VISUALS.COLORS.twitch)
        .setURL(`https://twitch.tv/${stream.user_login}`)
        .setDescription(`Playing **${stream.game_name || 'Eternal Return'}**${stream.title ? `\n> ${stream.title.slice(0, 200)}` : ''}`);
      await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error('[ptg] go-live announcement failed:', err.message);
  }
}

module.exports = { announceGoLive };
