# CONTEXT — QuickReload / snapback

> AI reference file. Read this first when resuming work on this project after any gap or crash.
> Last updated: May 11 2026

---

## Project Identity

| Key | Value |
|-----|-------|
| Extension display name | QuickReload |
| GitHub repo | https://github.com/vick2592/snapback |
| GitHub username | vick2592 |
| Local workspace root | `/Users/vickzmacbook/Documents/Sites/QuickReload/` |
| Extension source folder | `/Users/vickzmacbook/Documents/Sites/QuickReload/snapback/` |
| Manifest version | Chrome MV3 |
| Extension version | 1.0.0 |

The `QuickReload/` root directory is an **assets folder** (logos, branding, source artwork).  
All extension code lives inside `snapback/` (the cloned GitHub repo).

---

## What This Extension Does (Two Layers)

### Layer 1 — Public feature: QuickReload button (all websites)
- Toolbar popup with a single "⚡ Quick Reload" button
- On click: sends `{action: "quickReload"}` message to `content.js`
- `content.js` calls `history.back()`, then sends message to `background.js`
- `background.js` waits 200ms and calls `chrome.tabs.goForward(tabId)`
- Net effect: faster-feeling reload via back→forward instead of full refresh

### Layer 2 — Hidden feature: YouTube ad skip (YouTube only)
- `youtube.js` runs only on `*://*.youtube.com/*`
- Continuously tracks `video.currentTime` every 500ms → saves to `chrome.storage.session`
- Detects ads via `MutationObserver` on `#movie_player` (watching `.ad-showing` class) + 500ms polling fallback
- When ad detected (with 30s cooldown per tab):
  1. Tries clicking `.ytp-ad-skip-button` or `.ytp-ad-skip-button-modern` first (low-cost)
  2. If no skip button: sends `{action: "skipAd", youtubeUrl, videoId, timestamp}` to background
  3. Background navigates tab to `relay.html` (bundled internal page) — this is a REAL browser nav away from youtube.com origin
  4. After `relay.html` loads: background navigates tab back to `youtubeUrl?_qr_ts=<seconds>`
  5. `youtube.js` on reload reads `_qr_ts` param, cleans it from URL bar, seeks video to that timestamp

### Why relay.html is necessary
YouTube is a SPA. `history.back()` within YouTube does NOT leave the youtube.com origin — it soft-navigates within the SPA and does NOT reset ad state. To force a real browser navigation cycle, we navigate to our own bundled page (`relay.html`) and then navigate forward to the YouTube URL with the timestamp encoded in the URL.

---

## File Map

| File | Role |
|------|------|
| `manifest.json` | MV3 config. Permissions: `storage`, `tabs`, `activeTab`. Host permissions: `<all_urls>`. `relay.html` is in `web_accessible_resources`. |
| `background.js` | Service worker. Handles `quickReload` and `skipAd` messages. Maintains `skipCooldown` Map (30s per tab) and `pendingForward` Map. Listens to `chrome.tabs.onUpdated` to detect when `relay.html` finishes loading, then navigates forward to YouTube URL with `_qr_ts` param. Cleans up on `chrome.tabs.onRemoved`. |
| `content.js` | Runs on all URLs. Listens for `{action: "quickReload"}` → calls `history.back()` → sends `quickReload` to background. |
| `youtube.js` | Runs on YouTube only. IIFE. Hooks `history.pushState`, `history.replaceState`, and `popstate` for SPA nav detection. Functions: `startTracking`, `stopTracking`, `startAdObserver`, `stopAdObserver`, `startAdPolling`, `stopAdPolling`, `attemptSkip`, `waitForPlayer`, `restoreTimestamp`, `waitForSeekable`, `onYouTubeNavigate`. |
| `relay.html` | Minimal dark page (`background: #0f0f0f`), no JS. Used as navigation waypoint. |
| `popup.html` | Extension popup UI. Inline SVG icon (circular arrow + lightning bolt). Loads `popup.css` + `popup.js`. |
| `popup.css` | Dark theme (`#111827` bg, `#4f8ef7` brand blue). Responsive button with hover/active states. |
| `popup.js` | Queries active tab → sends `{action: "quickReload"}` to content script → falls back to `chrome.tabs.reload()` on chrome:// pages. |
| `icons/icon16.png` | 16×16 icon — generated via Python stdlib (no deps) |
| `icons/icon48.png` | 48×48 icon |
| `icons/icon128.png` | 128×128 icon |
| `.gitignore` | Ignores `.DS_Store`, `*.log` |
| `LICENSE` | MIT (pre-existing from GitHub repo init) |

---

## Key Technical Decisions & Rationale

### Ad detection selectors (may need updating as YouTube changes)
```js
const AD_SELECTORS = [
  '#movie_player.ad-showing',
  '.ytp-ad-player-overlay',
  '.ytp-ad-module[data-layer]',
];
```
YouTube frequently renames classes. If detection breaks, inspect the YouTube player DOM when an ad is playing and update these selectors.

### Timestamp storage
- Uses `chrome.storage.session` (key: `yt_ts_<videoId>`)
- In-memory, tab-safe, inaccessible to the YouTube page
- Clears on browser restart (acceptable — timestamps only needed within a session)

### 30-second cooldown
- Prevents infinite skip loops if the navigation itself triggers the observer again
- Tracked in background.js `skipCooldown` Map (tabId → timestamp)
- Also tracked in `youtube.js` via `adSkipPending` flag (reset after 31s)

### Timestamp URL param: `_qr_ts`
- Background appends `?_qr_ts=<seconds>` to the YouTube URL before navigating back
- `youtube.js` reads this on load, seeks to it, then removes it from the URL bar via `history.replaceState`

### SPA navigation hooks
- `youtube.js` monkey-patches `history.pushState` and `history.replaceState`
- Also listens to `window.popstate`
- On each nav change: stops all watchers, resets state, restarts for the new video

### Icons generated without external deps
- Pure Python 3 stdlib (struct + zlib) to write raw PNG bytes
- Regenerate with the script in session memory if icons need updating

---

## Chrome Permissions Explained

| Permission | Why |
|---|---|
| `storage` | `chrome.storage.session` for timestamp persistence |
| `tabs` | `chrome.tabs.goForward()`, `chrome.tabs.update()`, `chrome.tabs.onUpdated`, `chrome.tabs.onRemoved` |
| `activeTab` | Allows popup to access the currently active tab's ID |
| `host_permissions: <all_urls>` | Required for `chrome.tabs.update` to work on any site and for content scripts |

---

## Testing Checklist

- [ ] Load unpacked from `chrome://extensions` pointing to `snapback/`
- [ ] QuickReload popup button works on non-YouTube page (e.g., GitHub)
- [ ] On YouTube: open DevTools console → navigate to a video → confirm `youtube.js` is running (no errors)
- [ ] Watch a video → wait for an ad → confirm skip fires
- [ ] After skip, confirm video resumes at or near the correct timestamp (within ~1s)
- [ ] Open a video in a brand-new tab → QuickReload popup still works

---

## Known Limitations / Future Work

1. **YouTube selector fragility** — Google changes class names regularly. Monitor `.ad-showing` and others.
2. **BFCache** — we don't rely on BFCache at all (relay.html approach is more reliable)
3. **YouTube Premium users** — extension loads but ad detection never fires (harmless)
4. **Pre-roll vs mid-roll** — both handled identically; timestamp saved before skip, restored after
5. **No UI for YouTube feature** — intentional, keeps it invisible

---

## Development Workflow

```bash
# Navigate to extension
cd /Users/vickzmacbook/Documents/Sites/QuickReload/snapback

# Make changes, then reload in Chrome:
# chrome://extensions → QuickReload → click the refresh icon

# Commit & push
git add .
git commit -m "fix: description of change"
git push origin main
```

After any code change: go to `chrome://extensions` and click the **reload icon** on the QuickReload card (or toggle it off/on). Then reload the YouTube/test tab.
