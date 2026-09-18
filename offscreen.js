const queue = [];
let playing = false;
let idleTimer = null;

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleIdleClose() {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    chrome.runtime.sendMessage({ type: "offscreen-audio-idle" }).catch(() => {});
  }, 8000);
}

function finishCurrent() {
  playing = false;
  if (queue.length > 0) playNext();
  else scheduleIdleClose();
}

async function playNext() {
  if (playing || queue.length === 0) return;
  clearIdleTimer();
  playing = true;

  const item = queue.shift();
  const audio = new Audio(chrome.runtime.getURL("sounds/" + item.sound + ".wav"));
  const volume = Number(item.volume);
  audio.volume = Number.isFinite(volume)
    ? Math.max(0, Math.min(1, volume))
    : 0.8;

  audio.addEventListener("ended", finishCurrent, { once: true });
  audio.addEventListener("error", finishCurrent, { once: true });

  try {
    await audio.play();
  } catch {
    finishCurrent();
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== "offscreen" || message?.type !== "play") return;
  queue.push({
    sound: message.sound,
    volume: message.volume
  });
  playNext();
});
