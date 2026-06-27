const input = document.getElementById("apiKey");
const status = document.getElementById("status");

chrome.storage.sync.get("apiKey", ({ apiKey }) => {
  if (apiKey) input.value = apiKey;
});

document.getElementById("save").addEventListener("click", () => {
  const apiKey = input.value.trim();
  chrome.storage.sync.set({ apiKey }, () => {
    status.textContent = apiKey ? "Saved ✓" : "Cleared";
    setTimeout(() => (status.textContent = ""), 2000);
  });
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("save").click();
});
