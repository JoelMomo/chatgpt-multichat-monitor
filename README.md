<p align="center">
  <img src="assets/icons/icon128.png" width="96" alt="ChatGPT MultiChat Monitor icon">
</p>

<h1 align="center">ChatGPT MultiChat Monitor</h1>

<p align="center">
  Lightweight floating monitor for active ChatGPT conversations across browser tabs and windows.
</p>

<p align="center">
  <strong>Chrome / Edge · Manifest V3 · Local-first · No telemetry</strong>
</p>

<p align="center">
  <a href="https://github.com/JoelMomo/chatgpt-multichat-monitor/releases">
    <img src="https://img.shields.io/github/v/release/JoelMomo/chatgpt-multichat-monitor?style=flat-square" alt="Latest release">
  </a>
  <a href="https://joelmomo.github.io/">
    <img src="https://img.shields.io/badge/Apps%20%26%20tools-Browse-6F8F72?style=flat-square" alt="Browse apps and tools">
  </a>
</p>

## Preview

### Monitor

<p align="center">
  <img src="assets/screenshots/monitor-normal.png" width="410" alt="Normal ChatGPT MultiChat Monitor overlay">
</p>

<p align="center">
  <sub><strong>Normal view</strong> — live state, timers, unread Done and attention indicators.</sub>
</p>

### Compact mode

<p align="center">
  <img src="assets/screenshots/monitor-compact.png" width="300" alt="Compact ChatGPT MultiChat Monitor overlay">
</p>

<p align="center">
  <sub><strong>214 px compact view</strong> — the same information in single-line rows.</sub>
</p>

### Persistent chat order

<p align="center">
  <img src="assets/screenshots/drag-order.png" width="410" alt="Chat order drag and drop">
</p>

<p align="center">
  <sub>Drag a chat from its text area (name or status line), or use <strong>Move up / Move down</strong>. Separators are dragged directly by their line; chats inside each group keep smart state ordering.</sub>
</p>

### Settings

<p align="center">
  <img src="assets/screenshots/popup.png" width="340" alt="ChatGPT MultiChat Monitor settings popup">
</p>

<p align="center">
  <sub>Theme, opacity, sound alerts, compact mode, local chat data, recent activity and shortcuts.</sub>
</p>

## Live demos

<p align="center">
  <sub>Captured from the real extension UI using demo chat names and states.</sub>
</p>

### Floating and draggable

<p align="center">
  <img src="assets/demos/monitor-drag.gif" width="700" alt="ChatGPT MultiChat Monitor panel being dragged across the screen">
</p>

<p align="center">
  <sub>Drag the header to place the monitor anywhere on screen. Its position is saved locally.</sub>
</p>

### Working → Done

<p align="center">
  <img src="assets/demos/working-done.gif" width="430" alt="ChatGPT MultiChat Monitor Working state changing to Done">
</p>

<p align="center">
  <sub>The cyan <strong>Working</strong> LED pulses while ChatGPT is generating, then switches to lime <strong>Done</strong>.</sub>
</p>

## What's new in 0.4.0

- **Auto size + manual resize:** the monitor follows the number of visible chats by default, while a custom size remains available whenever you drag the resize handle. The footer's **Auto size** button returns to chat-driven sizing.
- **Appearance controls:** choose System, Dark or Light theme and adjust monitor opacity from the popup.
- **Smart priority order:** chats automatically move by priority: Error → Retry → Attention → Done → Pending → Working → Stopped → Draft → Idle. Manual drag order behaves as before without separators; inside separator blocks, state priority remains active.
- **Pending:** right-click an Idle LED to mark a chat for follow-up. Pending uses a distinct pink LED, pulses much more slowly than Working, and stays marked locally until you clear it. The invisible LED hit target is larger than the visible dot for easier interaction.
- **Section separators:** add a separator from the monitor header, drag it wherever you want, and the chats inside each resulting block continue to sort by state priority. Dragging now highlights the destination section and empty sections expose a temporary **Drop here** target.
- **Quieter counters:** Working, Done, Pending and Attention counts now use low-opacity tinted circles with the number itself in the state color.
- **Safer layout editing:** chat/separator layout changes show a short **Undo** action. **Reset layout** removes separators and manual ordering while keeping aliases, pins, Pending and other chat preferences.

<p align="center">
  <img src="assets/demos/pending.gif" width="430" alt="Real ChatGPT MultiChat Monitor UI showing a slowly pulsing Pending chat">
</p>

<p align="center">
  <sub>Captured from the real extension UI. <strong>Pending</strong> uses a slow pink pulse so it remains noticeable without looking active.</sub>
</p>

## What it does

ChatGPT MultiChat Monitor keeps a small floating panel on `chatgpt.com` and shares the status of your other open ChatGPT tabs.

- Live **Working** state with elapsed time.
- **Done** stays lime until you actually visit that chat.
- A non-empty prompt composer is shown as **Draft** instead of Idle; active generation still remains **Working** while you prepare the next prompt.
- Detects recoverable **Retry needed** states, likely **Needs attention** responses and visible **Errors**.
- Click any row to focus the correct tab and browser window.
- Pin, hide or locally rename chats.
- Without separators, manual drag order behaves as before. When separators are present, each block keeps automatic state-priority sorting while manual order is retained as the tie-breaker within the same state.
- Right-click an Idle LED to mark that conversation as **Pending**; right-click the pink Pending LED again to clear it.
- Auto-fitting overlay that follows the visible chats, while still supporting persistent manual resizing, compact mode and collapse.
- System / Dark / Light themes plus adjustable monitor opacity.
- Per-state local sound alerts with volume and test controls.
- Small local recent-activity history.
- Browser badge and keyboard shortcuts for fast navigation.
- Lightweight GitHub release checks can notify manual-install users when a newer stable version is available.

## State legend

| State | LED | Meaning |
| --- | --- | --- |
| **Working** | Cyan, pulsing | ChatGPT is currently generating. |
| **Done** | Lime | Generation finished normally and has not been visited yet. |
| **Retry needed** | Yellow | A recoverable timeout, delivery/network problem or Retry action was detected. |
| **Needs attention** | Orange | The response likely ended with a question or request for user input. |
| **Error** | Red | A visible non-recoverable ChatGPT error was detected. |
| **Stopped** | Amber | Generation was manually stopped. |
| **Draft** | Violet | The prompt box contains unsent text and no higher-priority state is active. |
| **Pending** | Pink | Manually marked for follow-up. Right-click the LED to clear it. |
| **Idle** | Gray | No current or unread activity. Right-click its LED to mark it Pending. Hidden by default unless requested or pinned. |

A normal **Done** keeps only a short late-error grace window for detection; after that it remains lime without continuing error scans until you visit it.

## Multi-chat controls

- **Click** a row to switch to that conversation.
- **Drag anywhere in the chat text area** (name or status line) to reorder or move a conversation between sections.
- Use the **separator** icon in the header to add a divider, then drag the divider line itself to split or regroup chats. The destination section is highlighted while dragging, and empty sections show **Drop here**. Remove a divider with its × control.
- **Right-click** a row or use **...** for:
  - Set / rename alias
  - Pin / unpin
  - Clear alias
  - Move up / Move down
  - Hide
- **Reset chat order** clears manual chat ordering. **Reset layout** also removes all separators and section assignments without clearing aliases, pins, Pending or hidden-chat preferences.
- Automatic smart sorting prioritizes Error → Retry → Attention → Done → Pending → Working → Stopped → Draft → Idle.
- Pinned chats stay at the top of their section, or the overall list when no separators are used.

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
- **↑** means a newer stable GitHub release is available. Chat activity always takes priority over the update badge.

## Update notifications

For manual installations, the background service worker checks GitHub's public releases API at most once every 24 hours.

- Only stable, non-draft releases are considered.
- A newer version shows an **Update available** card in the popup.
- **View release** opens the corresponding GitHub release.
- **Dismiss** hides that specific version; a later version can notify again.
- After the extension itself is updated, a one-time **What's new** card links to that version's release notes.
- No conversation text, chat titles or activity history is included in the GitHub request.

Store-installed extensions can still use the browser's own automatic update mechanism; the built-in notice is primarily useful for manual GitHub installs.

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
- Prompt-box input events update **Draft** immediately without scanning conversation content.
- The fast path checks ChatGPT's direct Stop signal.
- The broad button fallback runs only every 5 seconds.
- Retry/error detection checks capped sets of relevant visible elements only while useful.
- The **Needs attention** heuristic reads only the tail of the latest assistant response once when generation finishes.
- Live timer text updates only in visible browser tabs.
- Working animation uses a small opacity/transform pulse and can be disabled.
- Rows are updated in place instead of rebuilding the full overlay.
- No continuous external polling and no telemetry.
- Update checks are opportunistic and throttled to at most one public GitHub releases request every 24 hours.

## Recent activity

The popup keeps a small local history:

- Maximum 100 events
- Maximum age 24 hours
- Title, state and timestamp only
- No response or conversation text stored

## Install

1. Open the latest GitHub release and download the `chatgpt-multichat-monitor-vX.Y.Z.zip` asset.
2. Extract the ZIP to a permanent folder.
3. Open `edge://extensions/` or `chrome://extensions/`.
4. Enable **Developer mode**.
5. Choose **Load unpacked**.
6. Select the extracted extension folder.
7. Reload existing ChatGPT tabs if required.

For development, clone this repository and load the repository root instead.

The extension also attempts to reinject itself into already-open ChatGPT tabs after an extension reload.

## Settings

The popup lets you:

- Enable / disable the floating monitor
- Show / hide idle chats
- Enable Compact mode
- Choose System, Dark or Light theme
- Adjust floating monitor opacity from 35% to 100%
- Disable state animations
- Reset the floating monitor position or custom size
- Restore hidden chats
- Clear local aliases or pins independently
- Reset manual chat order
- View or clear recent activity
- Configure and test per-state sound alerts
- Open the **Support** page

## Privacy

Public privacy policy: https://joelmomo.github.io/privacy/chatgpt-multichat-monitor/

The content script runs only on `https://chatgpt.com/*`.

It does not send conversation data to an external server. To detect activity it observes ChatGPT interface state. For the optional **Needs attention** classification, it reads only the end of the latest assistant response at the moment generation finishes. That text is not saved or transmitted.

The background service worker can make one public request to GitHub's releases API at most every 24 hours to discover the latest stable version. That request contains no conversation data or telemetry.

Stored data is limited to:

- Extension settings
- Local aliases / pin / hidden preferences
- Manual chat order
- Separator positions and per-chat section assignment
- Recent activity metadata
- Update-check timestamps, latest known release version and dismissed-version state
- One-time What's new acknowledgement state

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

## Support development

These projects are free to use and developed in my spare time. If they've been useful to you, you can help support future development.

<p>
  <a href="https://github.com/sponsors/JoelMomo">
    <img src="https://img.shields.io/badge/GitHub%20Sponsors-Sponsor-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub">
  </a>
  <a href="https://ko-fi.com/joelmomodev">
    <img src="https://img.shields.io/badge/Ko--fi-One--time%20tip-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white" alt="Leave a tip on Ko-fi">
  </a>
</p>

<sub>All projects remain free regardless of support.</sub>

## License

MIT
