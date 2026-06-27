// Runs on the api.data.gov / regulations.gov signup pages. When the signup form
// issues a key, the 40-char token appears in the page. We detect it, validate it
// against the live API (so docs samples / partial tokens are ignored), and offer
// to save it to the extension — or save automatically if no key is set yet.

const KEY_RE = /^[A-Za-z0-9]{40}$/; // api.data.gov keys are 40 alphanumeric chars
const tried = new Set();
let barShown = false;

// Find a node whose entire trimmed text (or input value) is exactly a key token.
// Requiring an exact match avoids grabbing 40-char hashes embedded in prose.
function detectKey() {
  for (const el of document.querySelectorAll("input, textarea")) {
    const v = (el.value || "").trim();
    if (KEY_RE.test(v)) return v;
  }
  for (const el of document.querySelectorAll("code, pre, strong, b, span, p, td, div, h1, h2, h3")) {
    const t = (el.textContent || "").trim();
    if (t.length === 40 && KEY_RE.test(t)) return t;
  }
  return null;
}

function mask(key) {
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function removeBar() {
  const b = document.getElementById("rgcn-keybar");
  if (b) b.remove();
  barShown = false;
}

function showBar(message, actionLabel, onAction) {
  removeBar();
  barShown = true;
  const bar = document.createElement("div");
  bar.id = "rgcn-keybar";
  bar.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:22px",
    "transform:translateX(-50%)",
    "z-index:2147483647",
    "display:flex",
    "align-items:center",
    "gap:12px",
    "padding:12px 16px",
    "background:#1b1b1b",
    "color:#fff",
    "border-radius:10px",
    "box-shadow:0 4px 16px rgba(0,0,0,.35)",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    "font-size:13px",
    "max-width:90vw",
  ].join(";");

  const text = document.createElement("span");
  text.textContent = message;
  bar.appendChild(text);

  if (actionLabel) {
    const btn = document.createElement("button");
    btn.textContent = actionLabel;
    btn.style.cssText =
      "padding:6px 12px;font-size:12px;font-weight:600;color:#fff;background:#005ea2;border:none;border-radius:6px;cursor:pointer";
    btn.addEventListener("click", onAction);
    bar.appendChild(btn);
  }

  const close = document.createElement("button");
  close.textContent = "✕";
  close.style.cssText = "background:none;border:none;color:#bbb;font-size:15px;cursor:pointer;line-height:1";
  close.addEventListener("click", removeBar);
  bar.appendChild(close);

  document.body.appendChild(bar);
}

function handleCandidate(key) {
  if (tried.has(key)) return;
  tried.add(key);
  chrome.runtime.sendMessage({ type: "captureKey", key }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) return; // invalid / unreachable — stay quiet
    if (res.saved) {
      showBar(
        res.already
          ? "✓ This key is already saved to Regulations.gov Commenter Names."
          : "✓ Saved your new API key to Regulations.gov Commenter Names. You're all set!",
        null,
        null
      );
    } else if (res.conflict) {
      showBar(
        `Save this new key (${mask(key)}) to the extension, replacing the existing one?`,
        "Replace",
        () => {
          chrome.runtime.sendMessage({ type: "saveValidKey", key }, (r) => {
            if (r && r.ok) showBar("✓ Saved your new API key. You're all set!", null, null);
          });
        }
      );
    }
  });
}

let timer = null;
function scan() {
  if (barShown) return;
  const key = detectKey();
  if (key) handleCandidate(key);
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(scan, 300);
}

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});
scan();
