# ChatGPT MultiChat Monitor

A lightweight Chrome/Edge extension that adds a floating monitor to ChatGPT and shows what your other ChatGPT tabs are doing.

## Current prototype

The first version includes:

- Shared state across all open `chatgpt.com` tabs.
- Working, finished, stopped and idle states.
- Live elapsed-time counters for active chats.
- Recently finished chats remain visible for three minutes.
- Click any row to focus that browser tab.
- Draggable overlay with saved position.
- Collapsible overlay with saved state.
- Optional idle-chat visibility.
- DOM updates are patched row by row instead of rebuilding the full panel, reducing flicker.
- Re-injection into already open ChatGPT tabs after extension reload.

## How it works

Each ChatGPT tab runs a small content script that watches the page for the response Stop button and relevant DOM changes. It reports only status metadata to the extension service worker:

- tab id;
- chat title;
- page URL;
- state;
- start/finish timestamps.

The background worker combines those reports and broadcasts one shared snapshot back to every ChatGPT tab. The floating UI is rendered inside a Shadow DOM so ChatGPT styles do not leak into the monitor.

## Install for testing

1. Clone or download this repository.
2. Open `edge://extensions/` or `chrome://extensions/`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select this repository folder.
6. Reload any ChatGPT tabs that were already open.

The extension also tries to re-inject itself into already open ChatGPT tabs when the extension is reloaded.

## Settings

Click the extension button to:

- enable/disable the floating monitor;
- show/hide idle ChatGPT tabs.

Overlay position and collapsed state are stored locally.

## Privacy

The extension runs only on `https://chatgpt.com/*`.

It does not read or transmit conversation text. The monitor uses the page title, URL and response state needed to identify and switch between browser tabs. Settings stay in local browser storage.

## Limitations

ChatGPT does not expose a public browser API that directly reports whether a conversation is currently generating. The extension therefore infers activity from visible interface state. If ChatGPT changes its frontend, the detector may require an update.

This prototype intentionally keeps detection simple before adding more speculative states such as "waiting for user" or detailed error classification.

## Development

Syntax checks:

```powershell
node --check background.js
node --check content.js
node --check popup.js
Get-Content -Raw manifest.json | ConvertFrom-Json
```

## License

MIT
