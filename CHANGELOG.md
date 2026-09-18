# Changelog

## 0.2.7

- Added persistent manual chat ordering by dragging rows with the reorder handle.
- Manual order is saved locally and reused across tabs, reloads and browser sessions.
- Pinned chats remain in the top group; manual ordering applies within pinned/unpinned groups.
- Added **Move up** and **Move down** to the chat menu as a non-drag alternative.
- Added **Reset chat order** in Chat data to return to automatic smart sorting.
- Changed **Done** from a timed state to an unread-style state: it stays green until the user visits that chat.
- Visiting a Done chat through the monitor, browser tab switching or window focus acknowledges it and returns it to Idle.
- If a chat is already active in the focused window when it finishes, it is considered seen immediately instead of remaining green.
- Removed the old configurable Done visibility timer.

## 0.2.6

- Reorganized the popup into compact collapsible sections for Sound alerts, Chat data, Recent activity and Shortcuts.
- Added **Reset position** for the floating monitor.
- Added controls to clear all local aliases or pins independently and restore hidden chats.
- Added configurable Done visibility: 30 seconds, 1 minute, 3 minutes or 5 minutes.
- Done visibility changes apply immediately to an already-finished chat.
- Added state-name hover tooltips to monitor LEDs.
- Increased visual separation between yellow **Retry needed** and orange **Needs attention** indicators.
- Tightened Compact mode further to 214 px, shortens the header label to Monitor and keeps chat-option buttons low-profile until hover/focus.

## 0.2.5

- Changed the default **Done** sound from Off to **Pop**.
- Active generation now takes priority over stale Retry/Error UI left behind after retrying.
- Navigation between conversations clears stale state before detecting the new conversation.
- Discarded or reloading ChatGPT tabs are reset from stale Working state instead of remaining active indefinitely.
- Added a short stabilization delay for Done audio; a late Retry/Attention/Error transition cancels the pending Pop to prevent duplicate alerts.
- Pending Done audio is also cancelled when a tab closes, navigates away or disappears from the registry.

## 0.2.4

- Added local sound alerts for **Done**, **Retry needed**, **Needs attention** and **Error**.
- Added the same sound library used by ChatGPT Completion Sound: Pop, Cash Register, Chan, Potion, Point and Page Turn.
- Added a global sound-alert toggle, per-state sound selectors, volume control and per-state test buttons.
- `Done` is off by default to avoid overlapping ChatGPT Completion Sound; Retry, Attention and Error use distinct defaults.
- Hidden chats do not emit sound alerts.
- Sound playback is event-driven only: no new polling loop was added.
- The offscreen audio document is created on demand and closes after a short idle period.

## 0.2.3

- Added the same **Support** button used by ChatGPT Completion Sound.
- Support opens `https://joelmomo.github.io/#support` in a new tab.
- The button is a static link and adds no background work or extra permissions.

## 0.2.2

- Added **Retry needed** for recoverable timeout, delivery, network and retry states.
- Recoverable errors can now override a recent **Done** when the error UI appears slightly later.
- Added explicit detection for Retry/Reintentar actions and timeout messages such as "Se ha agotado el tiempo...".
- Retry states use an amber/yellow indicator and count as attention in the extension badge.
- Compact mode now uses single-line rows, hides secondary status text and reduces panel dimensions and spacing further.

## 0.2.1

- Fixed aliases, pin and hide preferences colliding between different conversations inside the same GPT.
- Changed the pinned marker from `*` to `📌`.
- Moved chat options to a viewport-level floating menu so it does not expand or get clipped by the monitor list.
- Changed the default monitor shortcut from `Ctrl+Shift+M` to `Alt+Shift+M` to avoid ChatGPT's own shortcut.
- Restored the continuous lightweight Working pulse when animations are enabled.

## 0.2.0

- Added **Needs attention** and **Error** states.
- Added extension badge for working and attention states.
- Added pin, hide and local alias controls per chat.
- Added smart ordering and multi-window tab focusing.
- Added compact mode.
- Added optional one-shot state transition animation.
- Added 24-hour / 100-event local activity history.
- Added keyboard shortcuts for monitor visibility and chat navigation.
- Added popup controls for hidden chats and history.
- Improved detector efficiency with throttled mutation handling.
- Reduced broad fallback scans from every second to every five seconds.
- Removed continuous working animation.
- Paused timer repaint work in hidden tabs.
- Added conservative finish-time attention detection.

## 0.1.0

- Initial prototype.
- Shared state across ChatGPT tabs.
- Working, done, stopped and idle states.
- Live timers.
- Draggable and collapsible overlay.
- Click-to-focus navigation.
