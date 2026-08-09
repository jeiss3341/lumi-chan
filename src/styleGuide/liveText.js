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

module.exports = { resolveText, resolveLines, getByPath };
