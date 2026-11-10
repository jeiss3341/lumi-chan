// Path to Glory · coaches' "Live now" board in Discord.
// One message in the channel set by PTG_LIVE_CHANNEL_ID (Railway variable),
// edited in place after every tracker pass: each coach live in Eternal Return
// with [PTG] in their title, with a link to watch. No database needed — on
// start it finds its own earlier message in the channel and keeps editing it.
const { EmbedBuilder } = require('discord.js');

const TITLE = 'Live now';
const OLD_TITLES = ['[PTG] Live now'];   // earlier name: keep editing that same message
let messageRef = null;   // the board message, once found or posted
let lastShown = null;    // skip edits when nothing changed

async function findBoard(channel, botId) {
  const recent = await channel.messages.fetch({ limit: 50 });
  return recent.find((m) => m.author.id === botId && m.embeds[0] && (m.embeds[0].title === TITLE || OLD_TITLES.includes(m.embeds[0].title))) || null;
}

// The stream title without the [PTG] tag, as plain text (no link, no markdown).
const cleanTitle = (t) => String(t || '').replace(/\[\s*ptg\s*\]/gi, '').replace(/\s{2,}/g, ' ').trim().replace(/([*_`~|>\\])/g, '\\$1').slice(0, 120);

function buildEmbed(live) {
  const embed = new EmbedBuilder().setTitle(TITLE).setColor(0xd6403a);
  if (!live.length) return embed.setDescription('No coaches are live right now.');
  const sorted = live.slice().sort((a, b) => String(a.coach.name || '').localeCompare(String(b.coach.name || '')));
  return embed
    .setDescription(sorted.map(({ coach, stream }) => {
      const since = Math.floor(new Date(stream.started_at).getTime() / 1000);
      const title = cleanTitle(stream.title);
      return `🔴 **${coach.name || stream.user_name}** · live <t:${since}:R>` +
        (title ? `\n${title}` : '') +
        `\n[Watch on Twitch ↗](https://twitch.tv/${stream.user_login})`;
    }).join('\n\n'))
    .setFooter({ text: `${live.length} coach${live.length === 1 ? '' : 'es'} live` });
}

async function updateLiveBoard(client, live) {
  const channelId = process.env.PTG_LIVE_CHANNEL_ID;
  if (!channelId) return;   // board off until a channel is set
  const key = live.map((x) => `${x.coach.id}:${x.stream.id}:${x.stream.title}`).sort().join('|');
  if (key === lastShown && messageRef) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) { console.error('[ptg] PTG_LIVE_CHANNEL_ID is not a text channel.'); return; }
    if (!messageRef) messageRef = await findBoard(channel, client.user.id);
    const payload = { embeds: [buildEmbed(live)] };
    if (messageRef) {
      try { await messageRef.edit(payload); }
      catch (err) { messageRef = await channel.send(payload); }   // deleted by someone: post a fresh one
    } else {
      messageRef = await channel.send(payload);
    }
    lastShown = key;
  } catch (err) {
    console.error('[ptg] live board update failed:', err.message);
  }
}

module.exports = { updateLiveBoard, buildEmbed };
