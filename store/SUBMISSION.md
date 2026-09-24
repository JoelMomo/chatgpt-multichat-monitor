# Store submission pack

Prepared for **ChatGPT MultiChat Monitor v0.4.0**.

## Public URLs

- Project: https://github.com/JoelMomo/chatgpt-multichat-monitor
- Website: https://joelmomo.github.io/
- Privacy policy: https://joelmomo.github.io/privacy/chatgpt-multichat-monitor/
- Support / issue tracker: https://github.com/JoelMomo/chatgpt-multichat-monitor/issues
- Latest release: https://github.com/JoelMomo/chatgpt-multichat-monitor/releases/latest

## Single purpose

> Monitor the status of active ChatGPT conversations across open browser tabs and windows, surface chats that are working, completed or need attention, and let the user quickly switch to the relevant conversation.

All extension features are directly related to this purpose: status and visible-work-phase detection, reload-safe active timers, tab switching, local project/manual grouping, ordering/aliases/pins/Pending, layout locking, compact display, appearance controls, recent status history, local sound alerts and update notices.

## Short description

> Lightweight floating monitor for active ChatGPT conversations across browser tabs and windows.

This is also the current manifest description.

## Long description

ChatGPT MultiChat Monitor adds a small floating status panel to chatgpt.com so you can keep track of several conversations at once without repeatedly checking every tab.

The monitor shows when a conversation is Working, Done, Draft, Pending, waiting for attention, asking for a Retry, reporting an Error, Stopped or Idle. Working chats include a reload-safe elapsed timer and can show the visible ChatGPT phase as Analyzing, Searching or Executing (with Spanish equivalents when the interface is in Spanish). Unread Done chats stay highlighted until you visit them.

Chats are grouped by ChatGPT project by default, with Manual and None grouping modes also available. Project headers and manual separators can be reordered or collapsed, while chats can be reordered inside their current project without changing ChatGPT project membership. A layout lock prevents accidental structural edits and gives visual feedback when a blocked layout action is attempted.

Click any row to switch directly to that ChatGPT tab and browser window. Chats can also be pinned, hidden, locally renamed or marked Pending. Compact mode keeps the panel out of the way when screen space matters. System, Dark, Light, Cozy, Neon and Minimal themes are available, together with opacity and optional dim-when-inactive behavior.

Optional local sound alerts can be assigned to Done, Retry, Attention and Error states. A small recent-activity history is stored locally in the browser and contains only chat title, state and timestamp metadata.

The extension is designed to remain lightweight: it uses event-driven DOM observation rather than continuously scanning entire conversations, does not use telemetry or analytics, and does not send conversation text, prompts, chat titles or local activity history to a developer server.

For manual GitHub installations, the background service worker can check GitHub's public latest-release endpoint at most once every 24 hours so the popup can indicate when a newer stable version is available.

## Category

Recommended: **Productivity**.

## Search terms

Suggested Edge search terms, within Microsoft's current limits:

- ChatGPT tabs
- ChatGPT monitor
- multi chat
- productivity
- tab monitor
- AI workflow
- ChatGPT status

## Privacy policy URL

https://joelmomo.github.io/privacy/chatgpt-multichat-monitor/

## Permission justifications

### storage

Stores extension settings and local-only monitor metadata: sound settings, compact mode, panel position, aliases, pins, hidden-chat state, manual chat order, recent activity metadata, update-check timestamps and one-time What's new acknowledgement state. Active response timing metadata is kept only in extension session storage so reloads can restore an in-progress timer without turning it into long-term history.

### tabs

Required to discover open ChatGPT conversations across tabs/windows, read the ChatGPT tab URL/title metadata needed to identify them, focus the correct browser window and activate the selected conversation when the user clicks a monitor row.

### scripting

Required to reinject the content script into already-open chatgpt.com tabs after the extension is installed or reloaded. It is not used to inject into unrelated websites.

### offscreen

Required by Manifest V3 to play packaged local notification sounds without keeping a visible extension page open. The offscreen document is created on demand and closed after a short idle period.

### https://chatgpt.com/*

The extension's user-facing monitor operates on ChatGPT. Host access is restricted to chatgpt.com so the content script can observe visible ChatGPT interface state and render the floating monitor.

## Remote code

**No.**

The extension does not download or execute remotely hosted JavaScript, WebAssembly or other executable code. JavaScript, HTML and sound files are packaged with the extension. The GitHub update check is a JSON metadata request only and its response is not executed as code.

## Data handling disclosure

The extension handles data locally that can fall under browser-store definitions of user data:

- **Website content / user-generated content:** a short tail of the latest assistant response may be inspected locally once when generation finishes to classify Needs attention. Unsent prompt-box text is checked locally only to determine whether to show Draft.
- **Current tab / browsing metadata:** URL/title metadata for open ChatGPT tabs is used to identify and switch between conversations.
- **Local extension metadata:** settings, aliases, pins, hidden state, manual order and recent status metadata are stored in browser extension storage.

The extension does **not** send conversation text, prompt text, chat titles, aliases, activity history or browsing metadata to the developer.

The only developer-selected external request is an HTTPS request to GitHub's public latest-release endpoint, at most once every 24 hours. It contains no conversation or monitor data. GitHub may receive ordinary connection metadata such as IP address and user agent as part of serving the request.

No analytics, advertising SDK, telemetry backend, data broker or developer-operated collection server is used.

## Chrome Web Store privacy form

Use the dashboard labels that are actually presented at submission time. Based on the current behavior, disclose the categories that cover:

- Website content / user-generated content
- Form data, if the dashboard treats unsent prompt-composer text as form data
- Web browsing activity or tab URL/title metadata, if the dashboard offers that category

Do **not** declare collection of authentication, financial, health, precise location, contacts or payment data.

Certifications:
- Data is used only for the extension's disclosed single purpose.
- User data is not sold.
- User data is not used or transferred for personalized advertising.
- User data is not used for creditworthiness or lending.
- Humans are not given access to user data collected through the extension.
- Data is not transferred except for the disclosed GitHub release-check request, which contains no conversation/monitor payload.

If the Chrome dashboard wording changes, choose the more transparent disclosure rather than trying to minimize the checkbox count.

## Microsoft Edge privacy form

### Single purpose

> Monitor active ChatGPT conversations across open browser tabs and windows, show their current status, and let the user quickly navigate to the relevant conversation.

### Personal information / user data

Select **Yes** if Partner Center asks whether the extension accesses personal information, website content or browsing information. The extension can locally access ChatGPT page content and open-tab metadata even though it does not transmit that content to the developer.

Use the privacy policy URL above.

### Remote code

**No remote code.**

### Data usage

Disclose local access to website content / prompt-composer content and current ChatGPT tab metadata. State that the information is processed for the monitor's user-facing functionality and is not sent to the developer.

## Reviewer notes

> ChatGPT MultiChat Monitor runs only on https://chatgpt.com/*.
>
> To test:
> 1. Open two or more ChatGPT conversations in separate tabs.
> 2. Start generating a response in one tab. The floating monitor should show that conversation as Working with a continuous elapsed timer and, when ChatGPT exposes one, a visible phase such as Analyzing / Searching / Executing.
> 3. Reload the generating conversation while it is still active. The current response timer should resume instead of restarting from zero.
> 4. When generation finishes in a background tab, it becomes Done and remains highlighted until that tab is visited.
> 5. Type text into a ChatGPT prompt box without sending it. If no higher-priority state is active, the monitor shows Draft.
> 6. If the chats belong to ChatGPT projects, the monitor groups them under project headers. Drag a chat within its current project to persist its monitor order; this does not move the underlying ChatGPT conversation to another project.
> 7. Lock the layout from the monitor header and try a layout edit. The action is blocked and the lock gives brief visual feedback; normal chat activation remains available.
> 8. Open the extension popup to test Compact mode, grouping, themes/opacity, reset controls and local sound-alert settings.
>
> The extension contains no remote executable code. The only periodic external request is an HTTPS JSON request to GitHub's public latest-release endpoint, throttled to at most once every 24 hours.
>
> Needs attention is an intentionally conservative heuristic. It inspects only a short tail of the latest assistant response locally after generation finishes. That text is not stored or transmitted.

## Assets

All store assets are in `store/assets/`. The existing screenshot set remains valid for the core monitor/popup flows; v0.4.0 listing text should be updated to describe project grouping, active phases/timers, layout lock and new appearance controls.

### Shared screenshots

- `shot-1-overview.png` — 1280x800
- `shot-2-working-done.png` — 1280x800
- `shot-3-compact.png` — 1280x800
- `shot-4-order.png` — 1280x800
- `shot-5-settings.png` — 1280x800

These satisfy Chrome's current 1280x800 screenshot format and Edge's 1280x800 screenshot option.

### Promotional assets

- `promo-small.png` — 440x280
- `promo-marquee.png` — 1400x560

The small promo tile is required by the current Chrome Web Store listing flow and optional for Edge. The 1400x560 marquee/large tile is optional on both.

### Logos

- `icon-128.png` — 128x128
- `logo-300.png` — 300x300, convenient for Edge's recommended listing-logo size

## Current official references

- Chrome listing: https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- Chrome screenshots / promo images: https://developer.chrome.com/docs/webstore/images
- Chrome privacy fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Chrome user data policy: https://developer.chrome.com/docs/webstore/user_data
- Edge publishing: https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension
- Edge developer policies: https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies

Requirements can change, so re-check the current dashboards before future submissions.
