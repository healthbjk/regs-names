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

  const text = (res.text || "").trim();
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
  body.remove();
}

function processCards() {
  const anchors = document.querySelectorAll('a[href*="/comment/"]');
  anchors.forEach((a) => {
    if (a.dataset[PROCESSED]) return;
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
  timer = setTimeout(processCards, 250);
}

const observer = new MutationObserver(schedule);
observer.observe(document.documentElement, { childList: true, subtree: true });

processCards();
