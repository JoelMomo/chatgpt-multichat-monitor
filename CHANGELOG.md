# Changelog

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
