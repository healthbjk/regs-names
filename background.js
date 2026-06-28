// Background service worker: fetches commenter details from the regulations.gov
// API v4 and returns a display name. Runs here (not in the content script) so we
// can use host_permissions to bypass CORS, and so caching/throttling is shared
// across all tabs.

const API_BASE = "https://api.regulations.gov/v4/comments/";
const CACHE_PREFIX = "commenter:v5:"; // bumped: entries now include category/agency/location context
const DOC_CACHE_PREFIX = "doctitle:v1:"; // cache of document id -> rule title
const ORG_ENUM_CAP = 300; // max candidate ids to page through for an org search
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// A transparent, static client identifier sent on every API request (no user
// data). It identifies the software, not the user — like a User-Agent (which
// fetch() forbids setting). Purpose: give GSA a traceable footprint in their
// api.data.gov logs, so the demand for "show the submitter name on the comment
// list" is visible and could nudge them to add it natively.
const CLIENT_HEADER = "X-Regs-Names-Client";
const CLIENT_VALUE = `regs-names-extension/${chrome.runtime.getManifest().version} (+https://github.com/healthbjk/regs-names)`;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch with exponential backoff on HTTP 429, so a burst of detail requests
// (e.g. loading a whole docket) rides out short-term rate limits instead of
// dropping comments. Returns { netErr } or { res }.
async function fetchWithRetry(url, headers, attempts = 4) {
  const merged = { ...headers, [CLIENT_HEADER]: CLIENT_VALUE };
  let delay = 700;
  for (let i = 0; i < attempts; i++) {
    let res;
    try {
      res = await fetch(url, { headers: merged });
    } catch (e) {
      return { netErr: true };
    }
    if (res.status !== 429 || i === attempts - 1) return { res };
    await sleep(delay);
    delay = Math.round(delay * 2.2);
  }
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

// Org-like keywords used to guess whether a title-derived name is an
// organization or an individual.
const ORG_KEYWORDS =
  /\b(inc|incorporated|corp|corporation|llc|llp|lp|ltd|co|company|companies|association|assn|coalition|alliance|federation|union|society|foundation|institute|institutes|center|centre|council|committee|board|group|partners|partnership|systems|technologies|solutions|health|healthcare|hospital|hospitals|clinic|university|college|school|department|agency|bureau|office|network|organization|organisation|chamber|fund|trust|services|laboratories|labs|pharmaceuticals|pharma|industries|holdings)\b/i;

// Many comments (especially attachment-based or agency-posted ones) leave the
// structured organization/name fields null and carry the submitter identity only
// in an auto-generated title like "Comment Submitted by Epic Systems Corporation".
// Recover the name from such titles; ignore the generic "Comment on <docid>" form.
function parseTitleName(title) {
  const t = (title || "").trim();
  const m = t.match(/^comment\s+(?:submitted\s+by|on\s+behalf\s+of|from|of|by)\s+(.+)$/i);
  if (!m) return "";
  return m[1].replace(/\s+/g, " ").trim();
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

  // Fall back to the comment title when the structured fields are empty.
  const titleName = parseTitleName(attr.title);
  if (titleName) return { name: titleName, kind: ORG_KEYWORDS.test(titleName) ? "org" : "person" };

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

  const attempt = await fetchWithRetry(url, { Accept: "application/vnd.api+json" });
  if (attempt.netErr) return { ok: false, error: "network" };
  const res = attempt.res;

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
  const org = attr && attr.organization ? String(attr.organization).trim() : "";
  const docId = (attr && attr.commentOnDocumentId) || null;
  const payload = {
    name,
    kind,
    text,
    attachments,
    org,
    docId,
    category: (attr && attr.category) || null,
    agencyId: (attr && attr.agencyId) || null,
    postedDate: (attr && attr.postedDate) || null,
    city: (attr && attr.city) || null,
    state: (attr && attr.stateProvinceRegion) || null,
    country: (attr && attr.country) || null,
    duplicates: (attr && attr.duplicateComments) || 0,
  };
  await writeCache(id, payload);
  return { ok: true, ...payload, cached: false };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "getCommenter" && msg.id) {
    enqueue(() => fetchCommenter(msg.id)).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
  if (msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    return false;
  }
  if (msg.type === "validateKey") {
    validateKey(msg.key).then(sendResponse);
    return true;
  }
  if (msg.type === "saveValidKey") {
    saveValidKey(msg.key).then(sendResponse);
    return true;
  }
  if (msg.type === "getDocTitle" && msg.docId) {
    fetchDocTitle(msg.docId).then(sendResponse);
    return true;
  }
  if (msg.type === "orgEnumerate" && msg.term) {
    (async () => {
      const apiKey = await getApiKey();
      if (!apiKey) return sendResponse({ ok: false, error: "no-key" });
      const en = await enumerateBySearchTerm(String(msg.term).trim(), apiKey, ORG_ENUM_CAP);
      sendResponse(
        en.ok
          ? { ok: true, ids: en.ids, total: en.totalCandidates, capped: en.capped }
          : { ok: false, error: en.error }
      );
    })();
    return true;
  }
});

// --- API key validation ------------------------------------------------------

// A live API call is the only reliable way to tell a good key from a typo or a
// docs sample. We use a tiny documents query.
async function validateKey(key) {
  const k = (key || "").trim();
  if (!k) return { ok: false, error: "empty" };
  const url = `https://api.regulations.gov/v4/documents?page[size]=5&api_key=${encodeURIComponent(k)}`;
  const r = await apiGetJson(url);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

async function saveValidKey(key) {
  const v = await validateKey(key);
  if (!v.ok) return v;
  await chrome.storage.sync.set({ apiKey: (key || "").trim() });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Whole-docket load (for the "filter all comments" panel).
//
// The site paginates 25 comments/page server-side and the API has no
// organization/attachment facet, so to filter across the entire docket we must
// (1) enumerate every comment id, then (2) fetch each detail record (cached +
// throttled, same as the per-card path). Progress streams back over a Port.
// ---------------------------------------------------------------------------

async function apiGetJson(url) {
  const attempt = await fetchWithRetry(url, { Accept: "application/vnd.api+json" });
  if (attempt.netErr) return { ok: false, error: "network" };
  const res = attempt.res;
  if (res.status === 429) return { ok: false, error: "rate-limit" };
  if (res.status === 403) return { ok: false, error: "bad-key" };
  if (!res.ok) return { ok: false, error: `http-${res.status}` };
  try {
    return { ok: true, json: await res.json() };
  } catch (e) {
    return { ok: false, error: "parse" };
  }
}

// Fetch (and cache) a document's title — the human-readable rule name — so
// cross-rule result lists can show what each comment pertains to.
async function fetchDocTitle(docId) {
  const key = DOC_CACHE_PREFIX + docId;
  const stored = await chrome.storage.local.get(key);
  if (stored[key] !== undefined) return { ok: true, title: stored[key] };
  const apiKey = await getApiKey();
  if (!apiKey) return { ok: false, error: "no-key" };
  const url =
    `https://api.regulations.gov/v4/documents/${encodeURIComponent(docId)}` +
    `?api_key=${encodeURIComponent(apiKey)}`;
  const r = await apiGetJson(url);
  if (!r.ok) return r;
  const title = (r.json && r.json.data && r.json.data.attributes && r.json.data.attributes.title) || null;
  await chrome.storage.local.set({ [key]: title });
  return { ok: true, title };
}

// The comments API filters by the document's numeric objectId, not its friendly
// id (CMS-2026-1255-0001), so resolve it first.
async function resolveObjectId(docId, apiKey) {
  const url =
    `https://api.regulations.gov/v4/documents/${encodeURIComponent(docId)}` +
    `?api_key=${encodeURIComponent(apiKey)}`;
  const r = await apiGetJson(url);
  if (!r.ok) return r;
  const objectId = r.json && r.json.data && r.json.data.attributes && r.json.data.attributes.objectId;
  return objectId ? { ok: true, objectId } : { ok: false, error: "no-object-id" };
}

async function enumerateCommentIds(objectId, apiKey) {
  const ids = [];
  let page = 1;
  let hasNext = false;
  do {
    const url =
      `https://api.regulations.gov/v4/comments?filter[commentOnId]=${encodeURIComponent(objectId)}` +
      `&page[size]=250&page[number]=${page}&sort=postedDate&api_key=${encodeURIComponent(apiKey)}`;
    const r = await apiGetJson(url);
    if (!r.ok) return r;
    const data = r.json && Array.isArray(r.json.data) ? r.json.data : [];
    for (const d of data) if (d && d.id) ids.push(d.id);

    // v4 exposes meta.hasNextPage; fall back to totalPages, or to a full-page
    // heuristic if neither field is present. (The earlier meta.pageCount field
    // didn't exist, so the loop stopped after page 1.)
    const meta = (r.json && r.json.meta) || {};
    hasNext =
      meta.hasNextPage === true ||
      (typeof meta.totalPages === "number" && page < meta.totalPages) ||
      data.length >= 250;
    page++;
  } while (hasNext && page <= 20); // API caps page[number] at 20 (5000 comments)
  return { ok: true, ids, truncated: hasNext && page > 20 };
}

// Full-text search across all dockets for a term (used for org lookup). The API
// has no organization field to filter on, so this is the only cross-docket
// lever — the client then verifies each candidate's organization, in batches.
async function enumerateBySearchTerm(term, apiKey, cap) {
  const ids = [];
  let page = 1;
  let hasNext = false;
  let totalCandidates = 0;
  const q = `"${String(term).replace(/"/g, "")}"`; // quoted phrase
  do {
    const url =
      `https://api.regulations.gov/v4/comments?filter[searchTerm]=${encodeURIComponent(q)}` +
      `&page[size]=250&page[number]=${page}&sort=postedDate&api_key=${encodeURIComponent(apiKey)}`;
    const r = await apiGetJson(url);
    if (!r.ok) return r;
    const data = r.json && Array.isArray(r.json.data) ? r.json.data : [];
    for (const d of data) if (d && d.id) ids.push(d.id);
    const meta = (r.json && r.json.meta) || {};
    totalCandidates = meta.totalElements || ids.length;
    hasNext = meta.hasNextPage === true || data.length >= 250;
    page++;
  } while (hasNext && page <= 20 && ids.length < cap);
  return { ok: true, ids: ids.slice(0, cap), totalCandidates, capped: totalCandidates > cap };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "docket") return;
  let alive = true;
  port.onDisconnect.addListener(() => (alive = false));
  const send = (m) => {
    if (alive) {
      try {
        port.postMessage(m);
      } catch (e) {
        alive = false;
      }
    }
  };

  port.onMessage.addListener(async (msg) => {
    const docId = msg && msg.docId;
    if (!docId) return send({ type: "error", error: "no-doc-id" });

    const apiKey = await getApiKey();
    if (!apiKey) return send({ type: "error", error: "no-key" });

    const obj = await resolveObjectId(docId, apiKey);
    if (!obj.ok) return send({ type: "error", error: obj.error });

    send({ type: "status", phase: "enumerating" });
    const en = await enumerateCommentIds(obj.objectId, apiKey);
    if (!en.ok) return send({ type: "error", error: en.error });

    const ids = en.ids;
    const total = ids.length;
    send({ type: "progress", loaded: 0, total });

    const comments = new Array(total);
    let loaded = 0;
    await Promise.all(
      ids.map((id, i) =>
        enqueue(() => fetchCommenter(id)).then((res) => {
          comments[i] = res && res.ok ? { id, ...res } : { id, error: (res && res.error) || "fail" };
          loaded++;
          if (loaded % 10 === 0 || loaded === total) send({ type: "progress", loaded, total });
        })
      )
    );

    send({ type: "done", comments, truncated: !!en.truncated });
  });
});
