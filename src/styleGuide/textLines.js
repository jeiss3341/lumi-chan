// Converts between text.js's line-array format (blank string = paragraph
// break, '> ' prefix = bullet) and a single newline-joined string suitable
// for a <textarea>. Shared by styleGuide.js (rendering/parsing form
// submissions), overrides.js (migrating old per-line saves), qandaTopics.js,
// and liveText.js.
function linesToText(lines) {
  return lines.join('\n');
}

function textToLines(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''));
}

module.exports = { linesToText, textToLines };
