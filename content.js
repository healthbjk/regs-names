// Content script: finds comment cards on regulations.gov list/overview pages and
// injects the commenter's name. Handles the Ember SPA by re-scanning on DOM
// mutations (pagination, route changes) with debouncing.

const PROCESSED = "rgcnDone"; // dataset flag so we don't double-process an anchor
const ID_RE = /\/comment\/([A-Za-z0-9_.-]+)/;

function extractId(href) {
  if (!href) return null;
  const m = href.match(ID_RE);
  return m ? m[1] : null;
}

const MAX_TEXT = 320;

function truncate(s) {
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT).trimEnd() + "…" : s;
}

// Comment bodies come back with literal HTML (e.g. <br/>, &quot;). Decode
// entities and strip tags for a clean text preview. DOMParser documents are
// inert — no scripts run and no resources load — so this is safe for untrusted
// content.
function cleanText(s) {
  if (!s) return "";
  const html = s.replace(/<br\s*\/?>/gi, " ");
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

// A row holds the name line and a body line (document link[s] or comment text).
function makeRow() {
  const row = document.createElement("div");
  row.className = "rgcn-row";
  row.style.cssText = "margin:4px 0 2px;line-height:1.35";

  const name = document.createElement("div");
  name.className = "rgcn-name";
  name.style.cssText = [
    "font-weight:600",
    "font-size:0.95em",
    "color:#1b1b1b",
    "display:flex",
    "align-items:center",
    "gap:6px",
  ].join(";");

  const body = document.createElement("div");
  body.className = "rgcn-body";
  body.style.cssText = "font-size:0.9em;margin-top:2px";

  row.append(name, body);
  return { row, name, body };
}

function renderName(nameEl, res) {
  nameEl.innerHTML = "";
  if (res.name) {
    const tag = document.createElement("span");
    tag.textContent = res.kind === "org" ? "🏢" : res.kind === "person" ? "👤" : "•";
    const name = document.createElement("span");
    name.textContent = res.name;
    nameEl.append(tag, name);
  } else {
    nameEl.style.color = "#6b6b6b";
    nameEl.style.fontWeight = "400";
    nameEl.textContent = "— no name provided —";
  }
}

// If the submission has attachment(s), link the document(s); otherwise show the
// inline comment text.
function renderBody(bodyEl, res) {
  bodyEl.innerHTML = "";
  const attachments = Array.isArray(res.attachments) ? res.attachments : [];

  if (attachments.length) {
    const label = document.createElement("span");
    label.textContent = "📎 ";
    bodyEl.appendChild(label);
    attachments.forEach((att, i) => {
      const a = document.createElement("a");
      a.href = att.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.cssText = "color:#005ea2;text-decoration:underline";
      a.textContent = att.format ? `${att.title} (${att.format})` : att.title;
      bodyEl.appendChild(a);
      if (i < attachments.length - 1) bodyEl.appendChild(document.createTextNode(" · "));
    });
    return;
  }

  const text = cleanText(res.text || "");
  if (text) {
    bodyEl.style.color = "#3d3d3d";
    bodyEl.title = text;
    bodyEl.textContent = truncate(text);
  } else {
    bodyEl.remove();
  }
}

function renderResult(parts, res) {
  const { row, name, body } = parts;
  if (!res) {
    row.remove();
    return;
  }
  if (res.ok) {
    renderName(name, res);
    renderBody(body, res);
    if (res.org) {
      const more = makeOrgLink(res.org);
      more.style.cssText += ";display:inline-block;margin-top:2px";
      row.appendChild(more);
    }
    return;
  }
  // error states
  const messages = {
    "no-key": "⚠️ Set a regulations.gov API key (click the extension icon)",
    "rate-limit": "⏳ API rate limit hit — try again shortly",
    "bad-key": "⚠️ Invalid API key (click the extension icon)",
    "not-found": "",
    network: "⚠️ Network error",
  };
  const msg = messages[res.error] ?? `⚠️ ${res.error}`;
  if (!msg) {
    row.remove();
    return;
  }
  name.style.color = "#a4140a";
  name.style.fontWeight = "400";
  name.textContent = msg;
  if (res.error === "no-key" || res.error === "bad-key") {
    name.style.cursor = "pointer";
    name.style.textDecoration = "underline";
    name.title = "Open extension setup to add your API key";
    name.addEventListener("click", () => chrome.runtime.sendMessage({ type: "openOptions" }));
  }
  body.remove();
}

function processCards() {
  const anchors = document.querySelectorAll('a[href*="/comment/"]');
  anchors.forEach((a) => {
    if (a.dataset[PROCESSED]) return;
    if (a.closest("#rgcn-results")) return; // skip our own injected result cards
    const id = extractId(a.getAttribute("href"));
    if (!id) return;
    a.dataset[PROCESSED] = "1";

    const parts = makeRow();
    parts.name.textContent = "…";
    parts.name.style.color = "#6b6b6b";
    parts.name.style.fontWeight = "400";

    // Insert the row right after the comment's title link.
    a.insertAdjacentElement("afterend", parts.row);

    chrome.runtime.sendMessage({ type: "getCommenter", id }, (res) => {
      if (chrome.runtime.lastError) {
        parts.row.remove();
        return;
      }
      renderResult(parts, res);
    });
  });
}

// Debounced observer: the SPA re-renders the list on pagination and navigation.
let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    processCards();
    ensurePanel(); // re-inject the filter launcher if a route change removed it
  }, 250);
}

const observer = new MutationObserver(schedule);
observer.observe(document.documentElement, { childList: true, subtree: true });

processCards();

// ===========================================================================
// Whole-docket filtering.
//
// The filter *controls* live inside the site's native "Refine Results" panel
// (so there's one obvious place to filter), and they drive a results drawer
// that loads every comment in the docket once via the background Port. The
// drawer lives under <body> so the Ember SPA's re-renders don't wipe it; the
// sidebar section is re-injected whenever Ember repaints the panel.
// ===========================================================================

const DOC_RE = /\/document\/([^/]+)\/comment/;

function currentDocId() {
  const m = location.pathname.match(DOC_RE);
  return m ? m[1] : null;
}

const state = {
  comments: null, // full comment array (incl. errored entries), or null until loaded
  total: 0, // number of comments enumerated for the docket
  truncated: false, // docket exceeded the 5,000-comment API cap
  loading: false,
  progressText: "", // transient status while loading the docket
  filterType: "all", // all | org | person | anon
  filterDoc: "all", // all | has | none
  sort: "posted", // posted | name-asc | name-desc
  org: null, // when set: { term, loading, progressText, results, capped, candidates } — cross-docket org lookup
};

let sidebarEls = null; // { countEl }

function hasDoc(c) {
  return Array.isArray(c.attachments) && c.attachments.length > 0;
}

function matchesFilter(c) {
  if (!c || c.error) return false;
  if (state.filterType === "org" && c.kind !== "org") return false;
  if (state.filterType === "person" && c.kind !== "person") return false;
  if (state.filterType === "anon" && !(c.kind === "anon" || !c.name)) return false;
  if (state.filterDoc === "has" && !hasDoc(c)) return false;
  if (state.filterDoc === "none" && hasDoc(c)) return false;
  return true;
}

// The takeover (our full-docket list replacing the native one) kicks in when any
// filter OR a non-default sort is chosen — sorting by submitter name has to act
// on the whole docket, which the native server-side list can't do.
function isTakeoverActive() {
  return (
    !!state.org ||
    state.filterType !== "all" ||
    state.filterDoc !== "all" ||
    state.sort !== "posted"
  );
}

// Sort matches by submitter name. "posted" keeps enumeration order (postedDate).
// Comments with no name always sort last.
function sortMatches(arr) {
  if (state.sort === "posted") return arr;
  const dir = state.sort === "name-desc" ? -1 : 1;
  return [...arr].sort((a, b) => {
    const an = (a.name || "").toLowerCase();
    const bn = (b.name || "").toLowerCase();
    if (!an && !bn) return 0;
    if (!an) return 1;
    if (!bn) return -1;
    return an < bn ? -dir : an > bn ? dir : 0;
  });
}

function summaryText() {
  if (state.loading) return state.progressText || "Loading…";
  if (!state.comments) return state.progressText || "";
  const loaded = state.comments.filter((c) => !c.error);
  const matches = loaded.filter(matchesFilter);
  const failed = state.total - loaded.length;
  return (
    `${matches.length} match · ${loaded.length}/${state.total} loaded` +
    (failed > 0 ? ` · ${failed} failed` : "") +
    (state.truncated ? " · capped at 5,000" : "")
  );
}

function retryFailed() {
  if (!state.comments) return;
  const failedIds = state.comments.filter((c) => c.error).map((c) => c.id);
  if (!failedIds.length) return;
  state.progressText = `Retrying ${failedIds.length} failed…`;
  if (sidebarEls) sidebarEls.countEl.textContent = state.progressText;
  let done = 0;
  failedIds.forEach((id) => {
    chrome.runtime.sendMessage({ type: "getCommenter", id }, (res) => {
      const idx = state.comments.findIndex((c) => c.id === id);
      if (idx >= 0) {
        state.comments[idx] = res && res.ok ? { id, ...res } : { id, error: (res && res.error) || "fail" };
      }
      if (++done === failedIds.length) {
        state.progressText = "";
        renderMain();
      }
    });
  });
}

// --- Rendering filtered cards into the main column ---------------------------

// Build a card that reuses the site's own card classes, so the existing
// stylesheet renders it identically to a native comment card.
function buildCard(c, opts) {
  const card = document.createElement("div");
  card.className = "card card-type-comment";
  card.style.marginBottom = "12px";
  const block = document.createElement("div");
  block.className = "card-block";

  const sub = document.createElement("p");
  sub.className = "card-subtitle d-inline-block";
  sub.textContent = "Public Submission";
  block.appendChild(sub);

  const h = document.createElement("h3");
  h.className = "h4 card-title";
  const icon = document.createElement("span");
  icon.textContent = c.kind === "org" ? "🏢 " : c.kind === "person" ? "👤 " : "";
  const a = document.createElement("a");
  a.href = `https://www.regulations.gov/comment/${c.id}`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = c.name || "(no name provided)";
  h.append(icon, a);
  block.appendChild(h);

  if (hasDoc(c)) {
    const docLine = document.createElement("div");
    docLine.style.cssText = "margin:4px 0";
    c.attachments.forEach((att, i) => {
      const link = document.createElement("a");
      link.href = att.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.style.cssText = "color:#005ea2";
      link.textContent = `📎 ${att.title}${att.format ? ` (${att.format})` : ""}`;
      docLine.appendChild(link);
      if (i < c.attachments.length - 1) docLine.appendChild(document.createTextNode(" · "));
    });
    block.appendChild(docLine);
  } else {
    const ctext = cleanText(c.text || "");
    if (ctext) {
      const t = document.createElement("div");
      t.style.cssText = "margin:4px 0;color:#3d3d3d";
      t.textContent = truncate(ctext);
      block.appendChild(t);
    }
  }

  const meta = document.createElement("div");
  meta.className = "card-metadata";
  meta.style.cssText = "margin-top:4px;font-size:12px;color:#71767a";
  meta.textContent = `ID ${c.id}`;
  if (c.docId) {
    meta.appendChild(document.createTextNode(" · on "));
    const dl = document.createElement("a");
    dl.href = `https://www.regulations.gov/document/${c.docId}`;
    dl.target = "_blank";
    dl.rel = "noopener noreferrer";
    dl.style.cssText = "color:#005ea2";
    dl.textContent = c.docId;
    meta.appendChild(dl);
  }
  block.appendChild(meta);

  // "More from this organization" — only for org submissions with a raw org name.
  if (c.org && !(opts && opts.hideOrgLink)) {
    const more = makeOrgLink(c.org);
    more.style.marginTop = "4px";
    more.style.display = "inline-block";
    block.appendChild(more);
  }

  card.appendChild(block);
  return card;
}

// A link that runs a cross-docket lookup for an organization's other comments.
function makeOrgLink(org) {
  const a = document.createElement("a");
  a.href = "#";
  a.textContent = "↪ More comments from this organization";
  a.style.cssText = "color:#005ea2;font-size:0.85em";
  a.addEventListener("click", (e) => {
    e.preventDefault();
    startOrgSearch(org);
  });
  return a;
}

const ORG_BATCH = 20; // verify candidates in small batches to stay gentle on rate limits

const normOrg = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function orgMatches(candidateOrg, term) {
  if (!candidateOrg) return false;
  const have = normOrg(candidateOrg);
  const want = normOrg(term);
  return have === want || have.includes(want) || want.includes(have);
}

// Look up an organization's comments across all of Regulations.gov: full-text
// search for the name (cheap, one round-trip), then verify candidates against
// their organization field in batches of 20 — the user pulls more on demand
// rather than firing one big burst. (Attachment-only submissions whose text
// lacks the name can't be found; surfaced as a caveat in the results.)
function startOrgSearch(org) {
  state.org = {
    term: org,
    loading: true,
    progressText: "Searching Regulations.gov…",
    ids: [],
    cursor: 0,
    total: 0,
    capped: false,
    results: [],
    error: "",
  };
  renderMain();
  try {
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    /* ignore */
  }

  chrome.runtime.sendMessage({ type: "orgEnumerate", term: org }, (res) => {
    if (!state.org) return;
    if (chrome.runtime.lastError || !res) {
      state.org.loading = false;
      state.org.error = "Couldn't reach the extension worker — try again.";
      renderMain();
      return;
    }
    if (!res.ok) {
      state.org.loading = false;
      const map = {
        "no-key": "Set an API key (extension icon), then reload.",
        "rate-limit": "API rate limit hit — try again shortly.",
        "bad-key": "Invalid API key.",
      };
      state.org.error = map[res.error] || `Error: ${res.error}`;
      renderMain();
      return;
    }
    state.org.ids = res.ids || [];
    state.org.total = res.total || state.org.ids.length;
    state.org.capped = !!res.capped;
    verifyNextBatch();
  });
}

// Verify the next batch of candidates against their organization field.
function verifyNextBatch() {
  const o = state.org;
  if (!o) return;
  const batch = o.ids.slice(o.cursor, o.cursor + ORG_BATCH);
  if (!batch.length) {
    o.loading = false;
    renderMain();
    return;
  }
  o.loading = true;
  o.progressText = `Checking ${o.cursor + 1}–${o.cursor + batch.length} of ${o.ids.length} candidates…`;
  renderMain();

  let done = 0;
  batch.forEach((id) => {
    chrome.runtime.sendMessage({ type: "getCommenter", id }, (res) => {
      if (!state.org) return;
      if (res && res.ok && orgMatches(res.org, o.term)) o.results.push({ id, ...res });
      if (++done === batch.length) {
        o.cursor += batch.length;
        o.loading = false;
        o.progressText = "";
        renderMain();
      }
    });
  });
}

function exitOrgSearch() {
  state.org = null;
  renderMain();
}

function infoCard(text) {
  const card = document.createElement("div");
  card.className = "card card-type-comment";
  card.style.marginBottom = "12px";
  const block = document.createElement("div");
  block.className = "card-block";
  block.style.color = "#4a4a4a";
  block.textContent = text;
  card.appendChild(block);
  return card;
}

// The native comment list is a `.row` inside `.results-container`; locate it
// excluding our own injected results.
function nativeCardsRow() {
  const rc = document.querySelector(".results-container");
  if (!rc) return null;
  const card = [...rc.querySelectorAll(".card-type-comment")].find((c) => !c.closest("#rgcn-results"));
  return card ? card.closest(".row") : null;
}

function resetFilters() {
  state.filterType = "all";
  state.filterDoc = "all";
  const t = document.getElementById("rgcn-f-type");
  const d = document.getElementById("rgcn-f-doc");
  if (t) t.value = "all";
  if (d) d.value = "all";
  renderMain();
}

// When a filter is active, hide the native list/pager and render the filtered
// full-docket matches in their place; otherwise restore the native list.
function orgSummaryText() {
  const o = state.org;
  if (!o) return "";
  if (o.loading) return o.progressText || "Searching…";
  const n = o.results ? o.results.length : 0;
  return `${n} by “${o.term}”`;
}

function renderMain() {
  if (sidebarEls) sidebarEls.countEl.textContent = state.org ? orgSummaryText() : summaryText();

  const rc = document.querySelector(".results-container");
  if (!rc) return;
  const cardsRow = nativeCardsRow();
  const pagerRow = rc.querySelector(".pagination-container");
  let mine = document.getElementById("rgcn-results");

  if (!isTakeoverActive()) {
    if (mine) mine.remove();
    if (cardsRow) cardsRow.style.display = "";
    if (pagerRow) pagerRow.style.display = "";
    return;
  }

  if (!state.comments && !state.loading) loadDocket();
  if (cardsRow) cardsRow.style.display = "none";
  if (pagerRow) pagerRow.style.display = "none";

  if (!mine) {
    mine = document.createElement("div");
    mine.id = "rgcn-results";
    mine.className = "row";
    rc.insertBefore(mine, cardsRow || pagerRow || null);
  }
  mine.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "col-md-12";
  mine.appendChild(wrap);

  if (state.org) {
    renderOrgResults(wrap);
    return;
  }

  // Summary bar: count, clear-filters, and a retry if any loads failed.
  const bar = document.createElement("div");
  bar.style.cssText =
    "padding:6px 0 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px";
  const label = document.createElement("strong");
  label.textContent = summaryText() || "Loading…";
  bar.appendChild(label);
  const clear = document.createElement("a");
  clear.href = "#";
  clear.textContent = "Clear filters";
  clear.style.cssText = "color:#005ea2;font-size:12px";
  clear.addEventListener("click", (e) => {
    e.preventDefault();
    resetFilters();
  });
  bar.appendChild(clear);
  const loaded = state.comments ? state.comments.filter((c) => !c.error) : [];
  if (state.comments && state.total - loaded.length > 0) {
    const retry = document.createElement("button");
    retry.textContent = "Retry failed";
    retry.style.cssText =
      "padding:3px 8px;font-size:11px;font-weight:600;color:#fff;background:#005ea2;border:none;border-radius:5px;cursor:pointer";
    retry.addEventListener("click", retryFailed);
    bar.appendChild(retry);
  }
  wrap.appendChild(bar);

  if (!state.comments) {
    wrap.appendChild(infoCard(state.progressText || "Loading all comments…"));
    return;
  }
  const matches = sortMatches(loaded.filter(matchesFilter));
  if (!matches.length) {
    wrap.appendChild(infoCard("No comments match these filters."));
    return;
  }
  matches.forEach((c) => wrap.appendChild(buildCard(c)));
}

// Render the cross-docket "this organization's other comments" view.
function renderOrgResults(wrap) {
  const o = state.org;

  const bar = document.createElement("div");
  bar.style.cssText =
    "padding:6px 0 10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px";
  const n = o.results.length;
  const label = document.createElement("strong");
  label.textContent = `${n} comment${n === 1 ? "" : "s"} by “${o.term}” so far`;
  bar.appendChild(label);
  const back = document.createElement("a");
  back.href = "#";
  back.textContent = "← Back to docket";
  back.style.cssText = "color:#005ea2;font-size:12px";
  back.addEventListener("click", (e) => {
    e.preventDefault();
    exitOrgSearch();
  });
  bar.appendChild(back);
  wrap.appendChild(bar);

  if (o.error) {
    wrap.appendChild(infoCard(o.error));
    return;
  }

  o.results.forEach((c) => wrap.appendChild(buildCard(c, { hideOrgLink: true })));

  if (o.loading) {
    wrap.appendChild(infoCard(o.progressText || "Checking candidates…"));
    return;
  }

  const checked = Math.min(o.cursor, o.ids.length);
  const note = document.createElement("div");
  note.style.cssText = "font-size:12px;color:#71767a;margin:10px 0";
  note.textContent =
    `Verified ${checked} of ${o.ids.length}${o.capped ? "+" : ""} candidates (full-text search). ` +
    "Attachment-only submissions whose text omits the name may be missing.";
  wrap.appendChild(note);

  if (o.cursor < o.ids.length) {
    const remaining = o.ids.length - o.cursor;
    const btn = document.createElement("button");
    btn.textContent = `Check next ${Math.min(ORG_BATCH, remaining)} (${remaining} remaining)`;
    btn.style.cssText =
      "padding:8px 14px;font-size:13px;font-weight:600;color:#fff;background:#005ea2;border:none;border-radius:5px;cursor:pointer";
    btn.addEventListener("click", verifyNextBatch);
    wrap.appendChild(btn);
  } else if (!o.results.length) {
    wrap.appendChild(
      infoCard(
        "No verified submissions found among the candidates. Full-text search can miss attachment-only submissions whose text doesn't include the name."
      )
    );
  }
}

// Re-apply the takeover only if Ember disturbed it (avoids render loops from the
// mutation observer when nothing changed).
function reapplyIfNeeded() {
  if (!isTakeoverActive()) return;
  const mine = document.getElementById("rgcn-results");
  const cardsRow = nativeCardsRow();
  if (!mine || (cardsRow && cardsRow.style.display !== "none")) renderMain();
}

function loadDocket() {
  if (state.loading || state.comments) return;
  const docId = currentDocId();
  if (!docId) return;
  state.loading = true;
  state.progressText = "Resolving docket…";
  renderMain();

  const port = chrome.runtime.connect({ name: "docket" });
  port.onMessage.addListener((m) => {
    if (m.type === "status" && m.phase === "enumerating") {
      state.progressText = "Finding all comments…";
    } else if (m.type === "progress") {
      state.progressText = `Loading comments… ${m.loaded}/${m.total}`;
    } else if (m.type === "done") {
      state.loading = false;
      state.progressText = "";
      state.comments = m.comments; // keep errored entries so we can report + retry them
      state.total = m.comments.length;
      state.truncated = !!m.truncated;
    } else if (m.type === "error") {
      state.loading = false;
      const map = {
        "no-key": "Set an API key (click the extension icon), then reload.",
        "rate-limit": "API rate limit hit — try again shortly.",
        "bad-key": "Invalid API key.",
      };
      state.progressText = map[m.error] || `Error: ${m.error}`;
    }
    renderMain();
  });
  port.onDisconnect.addListener(() => {
    if (state.loading) {
      state.loading = false;
      state.progressText = "Connection interrupted — change a filter to retry.";
      renderMain();
    }
  });
  port.postMessage({ docId });
}

// --- Sidebar controls (injected into the native "Refine Results" panel) ------

function styleNativeSelect(el) {
  el.style.cssText =
    "padding:6px 8px;font-size:13px;border:1px solid #919191;border-radius:0;background:#fff;width:100%;box-sizing:border-box";
}

// The native filter sections live inside #collapse-filter (the Bootstrap
// collapse that holds "Posted" etc.), within the .col-md-3 sidebar column. We
// append our section there so it sits alongside the site's own filters and
// inherits its show/hide behavior. (Both ids/classes are stable; matching the
// "Refine Results" heading text is not — it renders with a double space.)
function findRefinePanel() {
  return document.getElementById("collapse-filter") || document.querySelector("div.col-md-3");
}

function ensureSidebar() {
  if (document.getElementById("rgcn-refine-section")) return;
  const panel = findRefinePanel();
  if (!panel) return;

  const section = document.createElement("div");
  section.id = "rgcn-refine-section";
  section.style.cssText = "border-top:1px solid #dfe1e2;padding:14px 0 6px;margin-top:8px";
  section.innerHTML = `
    <div style="font-weight:700;font-size:15px;margin-bottom:4px">Commenter <span style="font-weight:400;font-size:11px;color:#71767a">(extension)</span></div>
    <div style="font-size:11px;color:#71767a;margin-bottom:10px">Filters the full docket in the list at right.</div>
    <label style="display:block;font-size:13px;font-weight:600;margin:0 0 4px">Submitter type</label>
    <select id="rgcn-f-type"></select>
    <label style="display:block;font-size:13px;font-weight:600;margin:12px 0 4px">Submission format</label>
    <select id="rgcn-f-doc"></select>
    <label style="display:block;font-size:13px;font-weight:600;margin:12px 0 4px">Sort by</label>
    <select id="rgcn-sort"></select>
    <div id="rgcn-count" style="font-size:12px;color:#4a4a4a;margin-top:10px;min-height:15px"></div>
  `;
  panel.appendChild(section);

  const typeSel = section.querySelector("#rgcn-f-type");
  const docSel = section.querySelector("#rgcn-f-doc");
  const sortSel = section.querySelector("#rgcn-sort");
  typeSel.innerHTML = `
    <option value="all">All</option>
    <option value="org">🏢 Organizations</option>
    <option value="person">👤 Individuals</option>
    <option value="anon">Anonymous / no name</option>`;
  docSel.innerHTML = `
    <option value="all">All</option>
    <option value="has">📎 Has document</option>
    <option value="none">Inline text only</option>`;
  sortSel.innerHTML = `
    <option value="posted">Posted (default)</option>
    <option value="name-asc">Submitter name (A–Z)</option>
    <option value="name-desc">Submitter name (Z–A)</option>`;
  styleNativeSelect(typeSel);
  styleNativeSelect(docSel);
  styleNativeSelect(sortSel);
  typeSel.value = state.filterType; // restore selections after an Ember repaint
  docSel.value = state.filterDoc;
  sortSel.value = state.sort;

  sidebarEls = { countEl: section.querySelector("#rgcn-count") };

  typeSel.addEventListener("change", () => {
    state.org = null; // a docket filter exits the cross-docket org view
    state.filterType = typeSel.value;
    renderMain();
  });
  docSel.addEventListener("change", () => {
    state.org = null;
    state.filterDoc = docSel.value;
    renderMain();
  });
  sortSel.addEventListener("change", () => {
    state.org = null;
    state.sort = sortSel.value;
    renderMain();
  });

  // Reflect current state in the freshly injected controls/count.
  renderMain();
}

// (Re)inject on navigation; the debounced observer (schedule) also calls this.
function ensurePanel() {
  if (!currentDocId()) return;
  ensureSidebar();
  reapplyIfNeeded();
}
ensurePanel();
