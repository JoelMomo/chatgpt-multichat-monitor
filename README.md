<p align="center">
  <img src="assets/icons/icon128.png" width="96" alt="ChatGPT MultiChat Monitor icon">
</p>

<h1 align="center">ChatGPT MultiChat Monitor</h1>

<p align="center">
  Lightweight floating monitor for active ChatGPT conversations across browser tabs and windows.
</p>

<p align="center">
  <strong>Chrome / Edge · Manifest V3 · Local-first · No external service</strong>
</p>

## Preview

<table>
  <tr>
    <td width="58%">
      <img src="assets/screenshots/monitor-normal.png" alt="Normal ChatGPT MultiChat Monitor overlay">
      <br><sub><strong>Normal view</strong> — live state, timers and attention indicators.</sub>
    </td>
    <td width="42%">
      <img src="assets/screenshots/monitor-compact.png" alt="Compact ChatGPT MultiChat Monitor overlay">
      <br><sub><strong>Compact view</strong> — single-line rows in a 214 px panel.</sub>
    </td>
  </tr>
  <tr>
    <td>
      <img src="assets/screenshots/drag-order.png" alt="Chat order drag and drop">
      <br><sub><strong>Persistent manual order</strong> — drag the handle or use Move up / Move down.</sub>
    </td>
    <td>
      <img src="assets/screenshots/popup.png" alt="ChatGPT MultiChat Monitor settings popup">
      <br><sub><strong>Settings</strong> — sounds, compact mode, local data and shortcuts.</sub>
    </td>
  </tr>
</table>

## What it does

ChatGPT MultiChat Monitor keeps a small floating panel on `chatgpt.com` and shares the status of your other open ChatGPT tabs.

- Live **Working** state with elapsed time.
- **Done** stays green until you actually visit that chat.
- Detects recoverable **Retry needed** states, likely **Needs attention** responses and visible **Errors**.
- Click any row to focus the correct tab and browser window.
- Pin, hide or locally rename chats.
- Drag rows to create a persistent manual order; pinned chats remain grouped at the top.
- Compact and collapsible overlay with saved position.
- Per-state local sound alerts with volume and test controls.
- Small local recent-activity history.
- Browser badge and keyboard shortcuts for fast navigation.

## State legend

| State | LED | Meaning |
| --- | --- | --- |
| **Working** | Cyan, pulsing | ChatGPT is currently generating. |
| **Done** | Green | Generation finished normally and has not been visited yet. |
| **Retry needed** | Yellow | A recoverable timeout, delivery/network problem or Retry action was detected. |
| **Needs attention** | Orange | The response likely ended with a question or request for user input. |
| **Error** | Red | A visible non-recoverable ChatGPT error was detected. |
| **Stopped** | Amber | Generation was manually stopped. |
| **Idle** | Gray | No current or unread activity. Hidden by default unless requested or pinned. |

A normal **Done** keeps only a short late-error grace window for detection; after that it remains green without continuing error scans until you visit it.

## Multi-chat controls

- **Click** a row to switch to that conversation.
- **Drag `⋮⋮`** to reorder chats.
- **Right-click** a row or use **...** for:
  - Set / rename alias
  - Pin / unpin
  - Clear alias
  - Move up / Move down
  - Hide
- **Reset chat order** returns to automatic smart sorting.
- Pinned chats stay in the top group.

## Sound alerts

Included local sounds:

- Pop
- Cash Register
- Chan
- Potion
- Point
- Page Turn
- Off

Default mapping:

| State | Default |
| --- | --- |
| Done | **Pop** |
| Retry needed | Potion |
| Needs attention | Point |
| Error | Chan |

Sound playback is event-driven. An offscreen audio document is created only when needed and closes after a short idle period.

## Browser badge

The extension icon stays quiet when nothing needs attention.

- A number shows how many chats are currently working.
- **!** means at least one chat needs attention, retry or error handling.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+Shift+M` | Show / hide the monitor on the active ChatGPT tab |
| `Ctrl+Shift+1` | Focus the next working chat |
| `Ctrl+Shift+2` | Focus the next attention or unread Done chat |

Browser shortcut conflicts can be changed from the browser's extension shortcut settings.

## Lightweight design

The monitor is designed to stay open all day without continuously scanning conversation content.

- `MutationObserver` reacts to relevant DOM changes.
- Observer-triggered checks are throttled.
- The fast path checks ChatGPT's direct Stop signal.
- The broad button fallback runs only every 5 seconds.
- Retry/error detection checks capped sets of relevant visible elements only while useful.
- The **Needs attention** heuristic reads only the tail of the latest assistant response once when generation finishes.
- Live timer text updates only in visible browser tabs.
- Working animation uses a small opacity/transform pulse and can be disabled.
- Rows are updated in place instead of rebuilding the full overlay.
- No external polling service and no telemetry.

## Recent activity

The popup keeps a small local history:

- Maximum 100 events
- Maximum age 24 hours
- Title, state and timestamp only
- No response or conversation text stored

## Install for testing

1. Clone or download this repository.
2. Open `edge://extensions/` or `chrome://extensions/`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository folder.
6. Reload existing ChatGPT tabs if required.

The extension also attempts to reinject itself into already-open ChatGPT tabs after an extension reload.

## Settings

The popup lets you:

- Enable / disable the floating monitor
- Show / hide idle chats
- Enable Compact mode
- Disable state animations
- Reset the floating monitor position
- Restore hidden chats
- Clear local aliases or pins independently
- Reset manual chat order
- View or clear recent activity
- Configure and test per-state sound alerts
- Open the **Support** page

## Privacy

The extension runs only on `https://chatgpt.com/*`.

It does not send conversation data to an external server. To detect activity it observes ChatGPT interface state. For the optional **Needs attention** classification, it reads only the end of the latest assistant response at the moment generation finishes. That text is not saved or transmitted.

Stored data is limited to:

- Extension settings
- Local aliases / pin / hidden preferences
- Manual chat order
- Recent activity metadata

## Limitations

ChatGPT does not expose a public browser API for conversation generation state. Activity is inferred from the visible interface, so a future ChatGPT frontend change may require detector updates.

**Needs attention** is intentionally conservative and heuristic. A response ending in a question can be classified as attention even when a reply is not strictly required.

## Development

Static checks:

```powershell
node --check background.js
node --check content.js
node --check popup.js
node --check offscreen.js
Get-Content -Raw manifest.json | ConvertFrom-Json
git diff --check
```

## Support

Support the project from the same page used by the extension:

https://joelmomo.github.io/#support

## License

MIT
