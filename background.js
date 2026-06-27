// Background service worker: fetches commenter details from the regulations.gov
// API v4 and returns a display name. Runs here (not in the content script) so we
// can use host_permissions to bypass CORS, and so caching/throttling is shared
// across all tabs.

const API_BASE = "https://api.regulations.gov/v4/comments/";
const CACHE_PREFIX = "commenter:v2:"; // bumped: entries now include text + attachments
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// Simple concurrency-limited queue so we don't hammer the API (and trip the
// per-second rate limit) when a page has 25 cards.
const MAX_CONCURRENT = 4;
let active = 0;
const queue = [];

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    active++;
    job().finally(() => {
      active--;
      pump();
    });
  }
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    pump();
  });
}

async function getApiKey() {
  const { apiKey } = await chrome.storage.sync.get("apiKey");
  return (apiKey || "").trim();
}

async function readCache(id) {
  const key = CACHE_PREFIX + id;
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key];
  if (entry && Date.now() - entry.t < CACHE_TTL_MS) return entry;
  return null;
}

async function writeCache(id, payload) {
  const key = CACHE_PREFIX + id;
  await chrome.storage.local.set({ [key]: { ...payload, t: Date.now() } });
}

// Turn the comment attributes into a single display name + a kind hint.
function deriveName(attr) {
  if (!attr) return { name: null, kind: null };
  const org = (attr.organization || "").trim();
  const first = (attr.firstName || "").trim();
  const last = (attr.lastName || "").trim();
  const person = [first, last].filter(Boolean).join(" ");

  if (org && person) return { name: `${org} (${person})`, kind: "org" };
  if (org) return { name: org, kind: "org" };
  if (person) return { name: person, kind: "person" };
  return { name: null, kind: "anon" }; // e.g. "Anonymous Anonymous" stripped, or mass/bulk submissions
}

// Pull the inline comment text and any attachment (document) links out of the
// detail record. Attachments come back in the top-level `included` array when
// the request uses ?include=attachments.
function deriveContent(json) {
  const attr = (json && json.data && json.data.attributes) || {};
  const text = (attr.comment || "").trim();

  const included = Array.isArray(json && json.included) ? json.included : [];
  const attachments = [];
  for (const item of included) {
    if (item.type !== "attachments") continue;
    const a = item.attributes || {};
    const formats = Array.isArray(a.fileFormats) ? a.fileFormats : [];
    const file = formats.find((f) => f && f.fileUrl);
    if (file) {
      attachments.push({
        title: (a.title || "Attachment").trim(),
        url: file.fileUrl,
        format: (file.format || "").toUpperCase(),
      });
    }
  }
  return { text, attachments };
}

async function fetchCommenter(id) {
  const cached = await readCache(id);
  if (cached) {
    const { t, ...rest } = cached;
    return { ok: true, ...rest, cached: true };
  }

  const apiKey = await getApiKey();
  if (!apiKey) return { ok: false, error: "no-key" };

  const url =
    `${API_BASE}${encodeURIComponent(id)}` +
    `?include=attachments&api_key=${encodeURIComponent(apiKey)}`;

  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/vnd.api+json" } });
  } catch (e) {
    return { ok: false, error: "network" };
  }

  if (res.status === 429) return { ok: false, error: "rate-limit" };
  if (res.status === 403) return { ok: false, error: "bad-key" };
  if (res.status === 404) return { ok: false, error: "not-found" };
  if (!res.ok) return { ok: false, error: `http-${res.status}` };

  let json;
  try {
    json = await res.json();
  } catch (e) {
    return { ok: false, error: "parse" };
  }

  const attr = json && json.data && json.data.attributes;
  const { name, kind } = deriveName(attr);
  const { text, attachments } = deriveContent(json);
  const payload = { name, kind, text, attachments };
  await writeCache(id, payload);
  return { ok: true, ...payload, cached: false };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "getCommenter" && msg.id) {
    enqueue(() => fetchCommenter(msg.id)).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
});
