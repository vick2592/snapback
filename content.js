// content.js — QuickReload general content script (runs on all pages)
// Handles the QuickReload button action: history.back() → background triggers goForward()
// On YouTube, youtube.js handles this instead (timestamp-aware).

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== 'quickReload') return;

  // Delegate to youtube.js on YouTube — it preserves the video timestamp
  if (window.location.hostname.includes('youtube.com')) {
    sendResponse({ ok: true, delegated: true });
    return true;
  }

  // All other sites: standard back → forward reload
  history.back();
  chrome.runtime.sendMessage({ action: 'quickReload' });
  sendResponse({ ok: true });
  return true;
});
