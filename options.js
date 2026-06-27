const SIGNUP_URL = "https://open.gsa.gov/api/regulationsgov/#getting-started";

const input = document.getElementById("apiKey");
const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("save");

// Turn the "Tell GSA" link into a ready-to-send email to the Regulations.gov
// Help Desk (lower friction than the form + reCAPTCHA). Falls back to the
// /support URL in the HTML if the mail client can't be opened.
(() => {
  const tell = document.getElementById("tellGsa");
  if (!tell) return;
  const subject = "Feature request: show commenter name on the comment list";
  const body = [
    "Hello,",
    "",
    "On a document's comment list, each comment shows only a generic title and ID. To see who submitted it (the organization or individual), you have to open each comment one at a time — even though that information is already in the comment detail API.",
    "",
    "Please consider:",
    "1) Show the submitter's name/organization on each comment card in the list.",
    "2) Add a filter for submitter type (organization vs. individual) and for whether a submission includes an attachment.",
    "",
    "Thank you for considering it.",
  ].join("\n");
  tell.href = `mailto:regulationshelpdesk@gsa.gov?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  tell.removeAttribute("target");
  tell.removeAttribute("rel");
})();

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
