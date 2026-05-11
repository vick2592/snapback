// youtube.js — QuickReload YouTube content script
// Responsibilities:
//   1. Detect ads via MutationObserver + polling fallback
//   2. On ad detected → notify background to navigate away & back
//   3. On page load → check for saved timestamp (_qr_ts param) and seek

(function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────

  const POLL_INTERVAL_MS = 500;
  const AD_SELECTORS = [
    '#movie_player.ad-showing',
    '.ytp-ad-player-overlay',
    '.ytp-ad-module[data-layer]',
  ];

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function getVideoEl() {
    return document.querySelector('video');
  }

  function getVideoId() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('v') || null;
    } catch {
      return null;
    }
  }

  function isAdPlaying() {
    return AD_SELECTORS.some((sel) => document.querySelector(sel) !== null);
  }

  // ─── 1. Timestamp Restoration ────────────────────────────────────────────────
  // Background appends ?_qr_ts=<seconds> when navigating back after a skip.

  function restoreTimestamp() {
    const params = new URLSearchParams(window.location.search);
    const qrTs = parseFloat(params.get('_qr_ts'));
    if (!qrTs || qrTs < 1) return;

    // Remove the param from the URL bar (cosmetic cleanup) without a reload
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('_qr_ts');
    window.history.replaceState(null, '', cleanUrl.toString());

    // Wait for the <video> element and for it to have loaded enough data to seek
    waitForSeekable(qrTs);
  }

  function waitForSeekable(targetTime, attempts = 0) {
    if (attempts > 40) return; // give up after ~10s

    const video = getVideoEl();
    if (video && video.readyState >= 1 && video.duration > targetTime) {
      // Seek slightly before to give a moment of context
      video.currentTime = Math.max(0, targetTime - 1);
      return;
    }

    setTimeout(() => waitForSeekable(targetTime, attempts + 1), 250);
  }

  // ─── 2. Ad Detection & Skip ──────────────────────────────────────────────────

  let adSkipPending = false;

  function attemptSkip() {
    if (adSkipPending) return;

    const videoId = getVideoId();
    const video = getVideoEl();
    const timestamp = video?.currentTime ?? 0;

    // Safety: don't skip if video is nearly over (< 5s remaining)
    if (video && video.duration && video.duration - timestamp < 5) return;

    adSkipPending = true;

    // Try clicking the native YouTube skip button first (low-cost path)
    const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern');
    if (skipBtn) {
      skipBtn.click();
      // Give YouTube 1s to clear the ad naturally before heavier intervention
      setTimeout(() => {
        adSkipPending = false;
      }, 1500);
      return;
    }

    // Heavy path: tell background to navigate away & back (resets ad state)
    chrome.runtime.sendMessage({
      action: 'skipAd',
      youtubeUrl: window.location.href,
      videoId,
      timestamp,
    });

    // Reset flag after cooldown (background enforces 30s tab-level cooldown too)
    setTimeout(() => {
      adSkipPending = false;
    }, 31000);
  }

  // MutationObserver watching for the ad-showing class on #movie_player
  let adObserver = null;

  function startAdObserver() {
    const player = document.querySelector('#movie_player');
    if (!player || adObserver) return;

    adObserver = new MutationObserver(() => {
      if (isAdPlaying()) attemptSkip();
    });

    adObserver.observe(player, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: false,
    });
  }

  function stopAdObserver() {
    if (adObserver) {
      adObserver.disconnect();
      adObserver = null;
    }
  }

  // Polling fallback — catches cases where MutationObserver misses a class change
  let adPollInterval = null;

  function startAdPolling() {
    if (adPollInterval) return;
    adPollInterval = setInterval(() => {
      if (isAdPlaying()) attemptSkip();
    }, POLL_INTERVAL_MS);
  }

  function stopAdPolling() {
    if (adPollInterval) {
      clearInterval(adPollInterval);
      adPollInterval = null;
    }
  }

  // ─── 3. Player Ready Wait ────────────────────────────────────────────────────
  // YouTube SPA: the player may not exist yet on initial load. Poll until ready.

  function waitForPlayer(attempts = 0) {
    if (attempts > 60) return; // give up after ~15s

    const player = document.querySelector('#movie_player');
    const video = getVideoEl();

    if (player && video) {
      startAdObserver();
      startAdPolling();
      return;
    }

    setTimeout(() => waitForPlayer(attempts + 1), 250);
  }

  // ─── 4. YouTube SPA Navigation Handling ─────────────────────────────────────
  // YouTube changes pages via pushState/replaceState without full reloads.
  // We hook into these to reset & reinitialise on each "page" change.

  let currentVideoId = getVideoId();

  function onYouTubeNavigate() {
    const newVideoId = getVideoId();
    if (newVideoId === currentVideoId) return; // same video, no reset needed

    currentVideoId = newVideoId;

    // Tear down existing monitors
    stopAdObserver();
    stopAdPolling();
    adSkipPending = false;

    // Restart for the new video
    waitForPlayer();
    restoreTimestamp();
  }

  // Intercept history API calls YouTube uses for SPA navigation
  const _pushState = history.pushState.bind(history);
  const _replaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    _pushState(...args);
    setTimeout(onYouTubeNavigate, 100);
  };

  history.replaceState = function (...args) {
    _replaceState(...args);
    setTimeout(onYouTubeNavigate, 100);
  };

  window.addEventListener('popstate', () => setTimeout(onYouTubeNavigate, 100));
  // ─── Manual QuickReload handler (timestamp-aware) ──────────────────────────
  // content.js delegates quickReload to us on YouTube so we can preserve position.

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action !== 'quickReload') return;

    const video = getVideoEl();
    const timestamp = video?.currentTime ?? 0;
    const videoId = getVideoId();

    chrome.runtime.sendMessage({
      action: 'manualReloadYT',
      youtubeUrl: window.location.href,
      videoId,
      timestamp,
    });

    sendResponse({ ok: true });
    return true;
  });
  // ─── Init ────────────────────────────────────────────────────────────────────

  restoreTimestamp();
  waitForPlayer();

  // Cleanup on tab unload
  window.addEventListener('pagehide', () => {
    stopAdObserver();
    stopAdPolling();
  });
})();
