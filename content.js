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

function makeBadge() {
  const el = document.createElement("div");
  el.className = "rgcn-name";
  el.style.cssText = [
    "font-weight:600",
    "font-size:0.95em",
    "margin:4px 0 2px",
    "color:#1b1b1b",
    "line-height:1.3",
    "display:flex",
    "align-items:center",
    "gap:6px",
  ].join(";");
  el.textContent = "";
  return el;
}

function renderResult(badge, res) {
  badge.style.color = "#1b1b1b";
  if (!res) {
    badge.remove();
    return;
  }
  if (res.ok) {
    if (res.name) {
      badge.innerHTML = "";
      const tag = document.createElement("span");
      tag.textContent = res.kind === "org" ? "🏢" : res.kind === "person" ? "👤" : "•";
      const name = document.createElement("span");
      name.textContent = res.name;
      badge.append(tag, name);
    } else {
      badge.style.color = "#6b6b6b";
      badge.style.fontWeight = "400";
      badge.textContent = "— no name provided —";
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
  const text = messages[res.error] ?? `⚠️ ${res.error}`;
  if (!text) {
    badge.remove();
    return;
  }
  badge.style.color = "#a4140a";
  badge.style.fontWeight = "400";
  badge.textContent = text;
}

function processCards() {
  const anchors = document.querySelectorAll('a[href*="/comment/"]');
  anchors.forEach((a) => {
    if (a.dataset[PROCESSED]) return;
    const id = extractId(a.getAttribute("href"));
    if (!id) return;
    a.dataset[PROCESSED] = "1";

    const badge = makeBadge();
    badge.textContent = "…";
    badge.style.color = "#6b6b6b";
    badge.style.fontWeight = "400";

    // Insert the badge right after the comment's title link.
    a.insertAdjacentElement("afterend", badge);

    chrome.runtime.sendMessage({ type: "getCommenter", id }, (res) => {
      if (chrome.runtime.lastError) {
        badge.remove();
        return;
      }
      renderResult(badge, res);
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
