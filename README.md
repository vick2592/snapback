# QuickReload ⚡

A lightning-fast Chrome extension that reloads any page instantly using back → forward browser navigation instead of a full refresh.

## Features

- **One-click Quick Reload** — click the toolbar button on any webpage for an instant back→forward reload
- **Smart reload** — uses browser history navigation, which is significantly faster than a full page reload on most sites
- **Works everywhere** — all websites, all pages

## Installation (Developer Mode)

1. Clone the repo:
   ```bash
   git clone https://github.com/vick2592/snapback.git
   ```
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `snapback/` folder
5. The QuickReload icon will appear in your Chrome toolbar

## Usage

Click the **QuickReload** icon in your toolbar, then press **⚡ Quick Reload**.

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (no frameworks, no build step)
- `chrome.storage.session` for in-memory state
- `chrome.tabs` API for navigation

## Project Structure

```
snapback/
├── manifest.json     # MV3 extension config
├── background.js     # Service worker: navigation orchestration
├── content.js        # Content script: runs on all pages
├── youtube.js        # Content script: runs on YouTube
├── relay.html        # Internal navigation waypoint
├── popup.html        # Toolbar popup UI
├── popup.css         # Popup styles
├── popup.js          # Popup logic
└── icons/            # Extension icons (16, 48, 128px)
```

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Persist page state across navigations |
| `tabs` | Navigate tabs back and forward |
| `activeTab` | Access the current active tab |

## License

MIT — see [LICENSE](LICENSE)
