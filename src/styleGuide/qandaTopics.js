// Turns TEXT.QANDA.topics (a fixed object in text.js) into an editable
// collection: topics can be added or removed through the style-guide page
// without ever touching text.js. Which topics currently exist, and in what
// order, is itself saved state — a JSON-encoded array of topic ids under
// one sentinel override key. Each topic's actual content reuses the same
// per-path override pattern every other field on the page already uses.
const TEXT = require('../text');
const overrides = require('./overrides');
const { linesToText, textToLines } = require('./textLines');

const ORDER_KEY = 'QANDA.topics.__order__';
// Discord's select-menu hard cap (already relied on elsewhere in this
// codebase — see index.js's claim-bounty dropdown pagination).
const MAX_TOPICS = 25;

const defaultOrder = () => Object.keys(TEXT.QANDA.topics);

function getTopicOrder() {
  const raw = overrides.get(ORDER_KEY, null);
  if (!raw) return defaultOrder();
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.every((x) => typeof x === 'string') ? arr : defaultOrder();
  } catch {
    return defaultOrder();
  }
}

function setTopicOrder(ids) {
  return overrides.setMany([[ORDER_KEY, JSON.stringify(ids)]]);
}

// A default topic (one that still exists in text.js) falls back to its
// text.js value when nothing's been saved for it. A user-added topic has no
// text.js entry, so its saved override values are the only source — always
// present, since addTopic() writes all 4 fields immediately.
function getTopic(id) {
  const def = TEXT.QANDA.topics[id];
  return {
    id,
    label: overrides.get(`QANDA.topics.${id}.label`, def?.label ?? ''),
    description: overrides.get(`QANDA.topics.${id}.description`, def?.description ?? ''),
    title: overrides.get(`QANDA.topics.${id}.title`, def?.title ?? ''),
    body: textToLines(overrides.get(`QANDA.topics.${id}.body`, linesToText(def?.body ?? []))),
  };
}

function getAllTopics() {
  return getTopicOrder().map(getTopic);
}

function slugifyTopicId(label) {
  return String(label)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 30)
    .replace(/^-+|-+$/g, '');
}

function generateTopicId(label) {
  const existing = getTopicOrder();
  const base = slugifyTopicId(label) || `topic-${Math.random().toString(36).slice(2, 8)}`;
  let id = base;
  let n = 2;
  while (existing.includes(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

// `body` is already \n-joined textarea text (same shape overrides.js stores
// for every other multi-line field).
async function addTopic({ label, description, title, body }) {
  const order = getTopicOrder();
  if (order.length >= MAX_TOPICS) {
    throw new Error(`Q&A is capped at ${MAX_TOPICS} topics (Discord's dropdown limit).`);
  }
  const id = generateTopicId(label);
  await overrides.setMany([
    [`QANDA.topics.${id}.label`, label],
    [`QANDA.topics.${id}.description`, description],
    [`QANDA.topics.${id}.title`, title],
    [`QANDA.topics.${id}.body`, body],
  ]);
  await setTopicOrder([...order, id]);
  return id;
}

// Removing a topic just drops it from the order list — text.js is never
// touched (a default topic just goes back to being "not currently shown"),
// and leftover per-field override rows for a removed custom topic are
// harmless orphans, same as everywhere else in this override store.
async function removeTopic(id) {
  const order = getTopicOrder();
  const next = order.filter((x) => x !== id);
  if (next.length === order.length) return false;
  await setTopicOrder(next);
  return true;
}

module.exports = { getTopicOrder, getTopic, getAllTopics, generateTopicId, addTopic, removeTopic, MAX_TOPICS };
