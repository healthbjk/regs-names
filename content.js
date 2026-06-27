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
    if (a.closest("#rgcn-drawer")) return; // skip links inside our own filter panel
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
  filterType: "all", // all | org | person | anon
  filterDoc: "all", // all | has | none
};

let drawerEls = null; // { drawer, statusEl, listEl }
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

// Write a transient status line to both the drawer and the sidebar count slot.
function setProgress(text) {
  if (drawerEls) drawerEls.statusEl.textContent = text;
  if (sidebarEls) sidebarEls.countEl.textContent = text;
}

function retryFailed() {
  if (!state.comments) return;
  const failedIds = state.comments.filter((c) => c.error).map((c) => c.id);
  if (!failedIds.length) return;
  setProgress(`Retrying ${failedIds.length} failed…`);
  let done = 0;
  failedIds.forEach((id) => {
    chrome.runtime.sendMessage({ type: "getCommenter", id }, (res) => {
      const idx = state.comments.findIndex((c) => c.id === id);
      if (idx >= 0) {
        state.comments[idx] = res && res.ok ? { id, ...res } : { id, error: (res && res.error) || "fail" };
      }
      if (++done === failedIds.length) renderResults();
    });
  });
}

// Render the drawer list and refresh the sidebar count from current state.
function renderResults() {
  const summary = (() => {
    if (!state.comments) return state.loading ? "Loading…" : "";
    const loaded = state.comments.filter((c) => !c.error);
    const matches = loaded.filter(matchesFilter);
    const failed = state.total - loaded.length;
    return (
      `${matches.length} match · ${loaded.length}/${state.total} loaded` +
      (failed > 0 ? ` · ${failed} failed` : "") +
      (state.truncated ? " · capped at 5,000" : "")
    );
  })();

  if (sidebarEls) sidebarEls.countEl.textContent = summary;

  if (!drawerEls) return;
  const { statusEl, listEl } = drawerEls;
  listEl.innerHTML = "";
  statusEl.innerHTML = "";
  if (state.loading || !state.comments) {
    statusEl.textContent = summary;
    return;
  }

  const loaded = state.comments.filter((c) => !c.error);
  const matches = loaded.filter(matchesFilter);
  const failed = state.total - loaded.length;

  const span = document.createElement("span");
  span.textContent = summary;
  statusEl.appendChild(span);
  if (failed > 0) {
    const retry = document.createElement("button");
    retry.textContent = "Retry failed";
    retry.style.cssText =
      "margin-left:8px;padding:3px 8px;font-size:11px;font-weight:600;color:#fff;background:#005ea2;border:none;border-radius:5px;cursor:pointer";
    retry.addEventListener("click", retryFailed);
    statusEl.appendChild(retry);
  }

  matches.forEach((c) => {
    const item = document.createElement("div");
    item.style.cssText = "padding:8px 4px;border-bottom:1px solid #f0f0f0;font-size:12.5px";

    const nameLine = document.createElement("div");
    nameLine.style.cssText = "font-weight:600;display:flex;gap:5px";
    const tag = document.createElement("span");
    tag.textContent = c.kind === "org" ? "🏢" : c.kind === "person" ? "👤" : "•";
    const link = document.createElement("a");
    link.href = `https://www.regulations.gov/comment/${c.id}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.cssText = "color:#005ea2;text-decoration:none";
    link.textContent = c.name || "(no name)";
    nameLine.append(tag, link);
    item.appendChild(nameLine);

    if (hasDoc(c)) {
      const docLine = document.createElement("div");
      docLine.style.cssText = "margin-top:2px";
      c.attachments.forEach((att, i) => {
        const a = document.createElement("a");
        a.href = att.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.style.cssText = "color:#005ea2";
        a.textContent = `📎 ${att.title}${att.format ? ` (${att.format})` : ""}`;
        docLine.appendChild(a);
        if (i < c.attachments.length - 1) docLine.appendChild(document.createTextNode(" · "));
      });
      item.appendChild(docLine);
    } else {
      const ctext = cleanText(c.text || "");
      if (ctext) {
        const t = document.createElement("div");
        t.style.cssText = "margin-top:2px;color:#3d3d3d";
        t.title = ctext;
        t.textContent = truncate(ctext);
        item.appendChild(t);
      }
    }
    listEl.appendChild(item);
  });
}

function loadDocket() {
  if (state.loading || state.comments) return;
  const docId = currentDocId();
  if (!docId) return;
  state.loading = true;
  setProgress("Resolving docket…");

  const port = chrome.runtime.connect({ name: "docket" });
  port.onMessage.addListener((m) => {
    if (m.type === "status" && m.phase === "enumerating") {
      setProgress("Finding all comments…");
    } else if (m.type === "progress") {
      setProgress(`Loading comments… ${m.loaded}/${m.total}`);
    } else if (m.type === "done") {
      state.loading = false;
      state.comments = m.comments; // keep errored entries so we can report + retry them
      state.total = m.comments.length;
      state.truncated = !!m.truncated;
      renderResults();
    } else if (m.type === "error") {
      state.loading = false;
      const map = {
        "no-key": "Set an API key (extension icon), then reload.",
        "rate-limit": "API rate limit hit — try again shortly.",
        "bad-key": "Invalid API key.",
      };
      setProgress(map[m.error] || `Error: ${m.error}`);
    }
  });
  port.onDisconnect.addListener(() => {
    if (state.loading) {
      state.loading = false;
      setProgress("Connection interrupted — try again.");
    }
  });
  port.postMessage({ docId });
}

// --- Results drawer (built once, lives under <body>) -------------------------

function buildDrawer() {
  if (drawerEls) return;
  const drawer = document.createElement("div");
  drawer.id = "rgcn-drawer";
  drawer.style.cssText = [
    "position:fixed",
    "top:0",
    "right:0",
    "width:360px",
    "max-width:92vw",
    "height:100vh",
    "z-index:2147483647",
    "background:#fff",
    "box-shadow:-2px 0 12px rgba(0,0,0,.2)",
    "display:none",
    "flex-direction:column",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    "color:#1b1b1b",
  ].join(";");
  drawer.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #e0e0e0">
      <strong style="font-size:14px">Matching comments</strong>
      <button id="rgcn-close" style="border:none;background:none;font-size:18px;cursor:pointer;line-height:1">✕</button>
    </div>
    <div id="rgcn-status" style="padding:10px 14px;font-size:12px;color:#4a4a4a;border-bottom:1px solid #e0e0e0"></div>
    <div id="rgcn-list" style="flex:1;overflow:auto;padding:6px 10px"></div>
  `;
  document.body.appendChild(drawer);
  drawer.querySelector("#rgcn-close").addEventListener("click", closeDrawer);
  drawerEls = {
    drawer,
    statusEl: drawer.querySelector("#rgcn-status"),
    listEl: drawer.querySelector("#rgcn-list"),
  };
}

function openDrawer() {
  buildDrawer();
  drawerEls.drawer.style.display = "flex";
  loadDocket();
  renderResults();
}
function closeDrawer() {
  if (drawerEls) drawerEls.drawer.style.display = "none";
}

// --- Sidebar controls (injected into the native "Refine Results" panel) ------

function styleNativeSelect(el) {
  el.style.cssText =
    "padding:6px 8px;font-size:13px;border:1px solid #919191;border-radius:0;background:#fff;width:100%;box-sizing:border-box";
}

// Locate the "Refine Results" heading so we can append our section to its panel.
function findRefinePanel() {
  const els = document.querySelectorAll("h1,h2,h3,h4,h5,h6,legend,strong,span,div");
  for (const el of els) {
    const t = (el.textContent || "").trim();
    if (/refine results/i.test(t) && t.length < 40) return el.parentElement;
  }
  return null;
}

function ensureSidebar() {
  if (document.getElementById("rgcn-refine-section")) return;
  const panel = findRefinePanel();
  if (!panel) return;

  const section = document.createElement("div");
  section.id = "rgcn-refine-section";
  section.style.cssText = "border-top:1px solid #dfe1e2;padding:14px 0 6px;margin-top:8px";
  section.innerHTML = `
    <div style="font-weight:700;font-size:15px;margin-bottom:10px">Commenter <span style="font-weight:400;font-size:11px;color:#71767a">(extension)</span></div>
    <label style="display:block;font-size:13px;font-weight:600;margin:0 0 4px">Submitter type</label>
    <select id="rgcn-f-type"></select>
    <label style="display:block;font-size:13px;font-weight:600;margin:12px 0 4px">Submission format</label>
    <select id="rgcn-f-doc"></select>
    <button id="rgcn-show" style="margin-top:12px;width:100%;padding:8px;font-size:13px;font-weight:600;color:#fff;background:#005ea2;border:none;cursor:pointer">Show matching comments →</button>
    <div id="rgcn-count" style="font-size:12px;color:#4a4a4a;margin-top:8px;min-height:15px"></div>
  `;
  panel.appendChild(section);

  const typeSel = section.querySelector("#rgcn-f-type");
  const docSel = section.querySelector("#rgcn-f-doc");
  typeSel.innerHTML = `
    <option value="all">All</option>
    <option value="org">🏢 Organizations</option>
    <option value="person">👤 Individuals</option>
    <option value="anon">Anonymous / no name</option>`;
  docSel.innerHTML = `
    <option value="all">All</option>
    <option value="has">📎 Has document</option>
    <option value="none">Inline text only</option>`;
  styleNativeSelect(typeSel);
  styleNativeSelect(docSel);
  typeSel.value = state.filterType; // restore selections after an Ember repaint
  docSel.value = state.filterDoc;

  sidebarEls = { countEl: section.querySelector("#rgcn-count") };

  typeSel.addEventListener("change", () => {
    state.filterType = typeSel.value;
    renderResults();
  });
  docSel.addEventListener("change", () => {
    state.filterDoc = docSel.value;
    renderResults();
  });
  section.querySelector("#rgcn-show").addEventListener("click", openDrawer);

  renderResults(); // reflect any already-loaded data in the fresh count slot
}

// (Re)inject on navigation; the debounced observer (schedule) also calls this.
function ensurePanel() {
  if (!currentDocId()) return;
  ensureSidebar();
}
ensurePanel();
