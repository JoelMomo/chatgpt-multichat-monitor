# ChatGPT MultiChat Monitor

A lightweight Chrome/Edge extension that adds a floating monitor to ChatGPT and shows what your other ChatGPT tabs are doing.

## v0.2.3

The monitor is designed to stay open all day without continuously scanning conversation content.

### Monitor states

- **Working** - ChatGPT is currently generating.
- **Retry needed** - a recoverable timeout, delivery/network issue or visible Retry/Reintentar action was detected.
- **Needs attention** - the response finished with a likely question or explicit request for user input.
- **Error** - a non-recoverable visible ChatGPT error state was detected.
- **Done** - generation finished normally.
- **Stopped** - generation was manually stopped.
- **Idle** - no current or recent activity.

### Multi-chat controls

- Shared status across all open `chatgpt.com` tabs.
- Live elapsed time for working chats.
- Recently finished/stopped chats remain visible briefly.
- Click a row to focus the correct tab and browser window.
- Pin important chats.
- Hide chats you do not want to monitor.
- Give chats local aliases without changing their real ChatGPT title.
- Right-click a row or use its **...** menu for chat options.
- Smart ordering prioritizes pinned chats and states requiring attention.
- Compact mode with single-line rows and no secondary status text.
- Draggable and collapsible overlay with saved position.

### Browser badge

The extension icon stays quiet when nothing needs attention.

- A number shows how many chats are working.
- **!** means at least one chat needs attention or has an error.

### Keyboard shortcuts

- `Alt+Shift+M` - show/hide the monitor on the active ChatGPT tab.
- `Ctrl+Shift+1` - focus the next working chat.
- `Ctrl+Shift+2` - focus the next attention/recent chat.

Browser shortcut conflicts can be changed from the browser's extension shortcut settings.

### Recent activity

The popup keeps a small local history of state changes:

- maximum 100 events;
- maximum age 24 hours;
- title, state and timestamp only;
- no response or conversation text is stored.

## Lightweight design

v0.2.x reduces continuous work compared with the prototype:

- `MutationObserver` reacts to relevant DOM changes.
- Observer-triggered checks are throttled.
- The fast path checks ChatGPT's direct Stop signal.
- The broad button fallback runs only every 5 seconds.
- Retry/error detection inspects visible alert/error elements and a capped set of visible buttons only while a chat is active or recently finished.
- The "Needs attention" heuristic reads only the tail of the latest assistant response once when generation finishes.
- Live timer text is updated only in visible browser tabs.
- The Working indicator uses a small opacity/transform pulse and can be disabled from the popup.
- State-change animation is one short optional highlight.
- Rows are updated in place instead of rebuilding the full overlay.

There are no external network requests and no background polling service.

## Install for testing

1. Clone or download this repository.
2. Open `edge://extensions/` or `chrome://extensions/`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select this repository folder.
6. Reload any ChatGPT tabs that were already open if required.

The extension also tries to inject itself into already open ChatGPT tabs after an extension reload.

## Settings

The popup lets you:

- enable/disable the floating monitor;
- show/hide idle chats;
- enable compact mode;
- disable the short state-change animation;
- restore all hidden chats;
- view or clear recent activity;
- open the same **Support** page used by ChatGPT Completion Sound.

Per-chat alias, pinned and hidden preferences are stored locally.

## Privacy

The extension runs only on `https://chatgpt.com/*`.

It does not send data to an external server.

To detect activity it observes ChatGPT interface state. For the optional **Needs attention** classification, it reads only the end of the latest assistant response at the moment generation finishes. That response text is not saved to storage or sent anywhere.

Stored data is limited to settings, local chat preferences and the small activity history described above.

## Limitations

ChatGPT does not expose a public browser API that reports whether a conversation is generating. Activity is inferred from the visible interface, so a future ChatGPT frontend change may require detector updates.

"Needs attention" is intentionally conservative and heuristic. A response ending in a question can be classified as attention even when no reply is strictly required.

## Development

Static checks:

```powershell
node --check background.js
node --check content.js
node --check popup.js
Get-Content -Raw manifest.json | ConvertFrom-Json
git diff --check
```

## License

MIT
