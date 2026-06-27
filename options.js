const SIGNUP_URL = "https://open.gsa.gov/api/regulationsgov/#getting-started";

const input = document.getElementById("apiKey");
const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("save");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || "";
}
function setField(kind) {
  input.className = kind || "";
}

chrome.storage.sync.get("apiKey", ({ apiKey }) => {
  if (apiKey) {
    input.value = apiKey;
    setStatus("Saved key in use.", "ok");
    setField("ok");
  }
});

document.getElementById("getKey").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: SIGNUP_URL });
});

// Validate (and save on success) via the background worker.
function validateAndSave(key) {
  const k = key.trim();
  if (!k) {
    setStatus("", "");
    setField("");
    return;
  }
  setStatus("Checking…", "info");
  setField("");
  chrome.runtime.sendMessage({ type: "saveValidKey", key: k }, (res) => {
    if (chrome.runtime.lastError || !res) {
      setStatus("Couldn't reach the extension worker — try again.", "bad");
      return;
    }
    if (res.ok) {
      setStatus("✓ Key valid and saved.", "ok");
      setField("ok");
    } else {
      const map = {
        "bad-key": "✗ That key was rejected by the API.",
        empty: "",
        "rate-limit": "Key looks right but the API is rate-limiting — it's saved; try again shortly.",
        network: "✗ Network error — check your connection.",
      };
      // Even on rate-limit we can't confirm; only persist on a clean pass.
      setStatus(map[res.error] || `✗ ${res.error}`, "bad");
      setField("bad");
    }
  });
}

let debounce = null;
input.addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => validateAndSave(input.value), 700);
});
saveBtn.addEventListener("click", () => validateAndSave(input.value));
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    clearTimeout(debounce);
    validateAndSave(input.value);
  }
});

// If the signup-page capture saves a key while this page is open, reflect it.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.apiKey) {
    const v = changes.apiKey.newValue || "";
    input.value = v;
    if (v) {
      setStatus("✓ Key captured from the signup page and saved.", "ok");
      setField("ok");
    }
  }
});
