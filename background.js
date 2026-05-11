// background.js — QuickReload service worker
// Handles navigation orchestration and per-tab cooldown for YouTube skip logic.

// Cooldown map: tabId → timestamp of last skip attempt (ms)
const skipCooldown = new Map();
const COOLDOWN_MS = 30000; // 30 seconds between skip attempts per tab

// Pending forward navigations: tabId → { youtubeUrl, videoId }
const pendingForward = new Map();

// ─── Message Router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'quickReload') {
    handleQuickReload(sender.tab?.id);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'skipAd') {
    handleSkipAd(msg, sender.tab?.id);
    sendResponse({ ok: true });
    return true;
  }
});

// ─── Quick Reload (all sites) ──────────────────────────────────────────────────

function handleQuickReload(tabId) {
  if (!tabId) return;

  // Content script already called history.back(); we just wait then go forward.
  setTimeout(() => {
    chrome.tabs.goForward(tabId, () => {
      // Suppress expected "No forward history" errors on brand-new tabs
      void chrome.runtime.lastError;
    });
  }, 200);
}

// ─── YouTube Ad Skip ──────────────────────────────────────────────────────────

function handleSkipAd(msg, tabId) {
  if (!tabId) return;

  const now = Date.now();
  const lastSkip = skipCooldown.get(tabId) ?? 0;
  if (now - lastSkip < COOLDOWN_MS) return; // still in cooldown

  skipCooldown.set(tabId, now);

  const { youtubeUrl, videoId, timestamp } = msg;

  // Save the return target so we know where to go forward to after relay
  pendingForward.set(tabId, { youtubeUrl, videoId, timestamp });

  // Navigate tab to the bundled relay page — this is a *real* browser navigation
  // away from youtube.com, which is required for BFCache to take effect on the
  // subsequent goForward() call back to YouTube.
  const relayUrl = chrome.runtime.getURL('relay.html');
  chrome.tabs.update(tabId, { url: relayUrl }, () => {
    void chrome.runtime.lastError;
  });
}

// ─── Forward Navigation After Relay ──────────────────────────────────────────
// Listen for the relay page completing its load, then go forward back to YouTube.

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;

  const relayUrl = chrome.runtime.getURL('relay.html');

  if (tab.url === relayUrl && pendingForward.has(tabId)) {
    const { youtubeUrl, videoId, timestamp } = pendingForward.get(tabId);
    pendingForward.delete(tabId);

    // Short delay to let relay.html fully settle before navigating forward
    setTimeout(() => {
      // Navigate directly back to the YouTube URL (reliable fallback vs goForward)
      const target = new URL(youtubeUrl);
      // Preserve the video ID and timestamp via URL so youtube.js can restore it
      target.searchParams.set('_qr_ts', Math.floor(timestamp));
      chrome.tabs.update(tabId, { url: target.toString() }, () => {
        void chrome.runtime.lastError;
      });
    }, 150);
  }
});

// ─── Cleanup cooldown when tab is closed ─────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  skipCooldown.delete(tabId);
  pendingForward.delete(tabId);
});
