// content.js — QuickReload general content script (runs on all pages)
// Handles the QuickReload button action: history.back() → background triggers goForward()

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== 'quickReload') return;

  // Step 1: go back in browser history
  history.back();

  // Step 2: tell the background to fire goForward() after a short delay
  chrome.runtime.sendMessage({ action: 'quickReload' });

  sendResponse({ ok: true });
});
