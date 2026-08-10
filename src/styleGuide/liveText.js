// The one place every bot-facing module (panel.js, modal.js, ticket.js,
// bountyCard.js, qanda.js, index.js) resolves copy through — checks a saved
// override first, falls back to text.js's own default. Without this, saved
// edits only ever affected the style-guide page's own preview, never what
// the bot actually posts to Discord.
const TEXT = require('../text');
const overrides = require('./overrides');

function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function resolveText(path) {
  return overrides.get(path, getByPath(TEXT, path));
}

function resolveLines(path) {
  const defaultLines = getByPath(TEXT, path);
  return overrides.get(path, defaultLines.join('\n')).split('\n');
}

// Sets a button's emoji ONLY if there actually is one. discord.js's
// setEmoji() throws on an empty string ("Expected the value to not be
// null"), and since every emoji here is editable copy — text.js by hand, or
// a saved override — a blanked-out emoji would otherwise throw while
// BUILDING the button, taking down whichever flow that button belongs to
// (e.g. blanking TICKET.closeEmoji breaks the whole Request Bounty preview,
// not just that one icon). Leaving an emoji blank is a legitimate choice,
// so treat it as "no emoji" instead of an error.
function applyEmoji(button, path) {
  const emoji = String(resolveText(path) ?? '').trim();
  if (emoji) button.setEmoji(emoji);
  return button;
}

module.exports = { resolveText, resolveLines, applyEmoji, getByPath };
