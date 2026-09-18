const DEFAULTS = {
  monitorEnabled: true,
  monitorShowIdle: false
};

const enabled = document.getElementById("enabled");
const showIdle = document.getElementById("showIdle");

async function load() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  enabled.checked = settings.monitorEnabled !== false;
  showIdle.checked = settings.monitorShowIdle === true;
}

enabled.addEventListener("change", () => {
  chrome.storage.local.set({ monitorEnabled: enabled.checked });
});

showIdle.addEventListener("change", () => {
  chrome.storage.local.set({ monitorShowIdle: showIdle.checked });
});

load();
