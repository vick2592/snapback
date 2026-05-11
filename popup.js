// popup.js — QuickReload popup script

document.getElementById('reloadBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const btn = document.getElementById('reloadBtn');

  // Send message to content.js on the active tab
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'quickReload' });
  } catch {
    // Content script may not be injected on chrome:// pages — fall back to reload
    chrome.tabs.reload(tab.id);
  }

  // Brief visual feedback
  btn.textContent = '✓ Reloading…';
  btn.classList.add('fired');
  setTimeout(() => window.close(), 600);
});
