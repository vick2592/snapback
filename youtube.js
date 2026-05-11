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
  // Background appends ?_qr_ts=<seconds> when navigating back after a relay skip.

  function restoreTimestamp() {
    const params = new URLSearchParams(window.location.search);
    const qrTs = parseFloat(params.get('_qr_ts'));
    if (!qrTs || qrTs < 1) return;

    // Remove the param from the URL bar (cosmetic cleanup) without a reload
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('_qr_ts');
    window.history.replaceState(null, '', cleanUrl.toString());

    // Grace period: suppress ad detection for 6s after relay navigation lands.
    // Without this, YouTube's new pre-roll ad triggers another skip → infinite loop.
    adSkipPending = true;
    setTimeout(() => { adSkipPending = false; }, 6000);

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
  // Four tiers, least invasive first. Only tier 4 causes a page navigation —
  // which is what was creating the infinite ad loop.

  let adSkipPending = false;
  let fastForwardInterval = null;

  function stopFastForward() {
    if (fastForwardInterval) {
      clearInterval(fastForwardInterval);
      fastForwardInterval = null;
    }
    const video = getVideoEl();
    if (video) {
      video.muted = false;
      video.playbackRate = 1;
    }
  }

  function attemptSkip() {
    if (adSkipPending) return;

    const video = getVideoEl();
    const videoId = getVideoId();
    const timestamp = video?.currentTime ?? 0;

    // Safety: don't interfere if main video is nearly over
    if (video && video.duration && video.duration - timestamp < 5 && !isAdPlaying()) return;

    adSkipPending = true;

    // ── Tier 1: native YouTube skip button ───────────────────────────────────
    const skipBtn = document.querySelector(
      '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button'
    );
    if (skipBtn) {
      skipBtn.click();
      setTimeout(() => { adSkipPending = false; }, 1500);
      return;
    }

    // ── Tier 2: jump ad video to its end (force natural ad completion) ───────
    // Works on non-skippable ads — sets the ad <video> currentTime to duration.
    if (video && video.duration && isFinite(video.duration) && video.duration > 0) {
      try {
        video.currentTime = video.duration;
        setTimeout(() => {
          if (!isAdPlaying()) {
            adSkipPending = false;
            return;
          }
          // Didn't clear — escalate to tier 3
          adSkipPending = false;
          attemptSkip();
        }, 800);
        return;
      } catch {
        // Seek was blocked — fall through to tier 3
      }
    }

    // ── Tier 3: mute + 16× speed (silent fast-forward) ───────────────────────
    // Ad plays 16× faster silently. No navigation, no new ad served by YouTube.
    if (video) {
      try {
        video.muted = true;
        video.playbackRate = 16;

        fastForwardInterval = setInterval(() => {
          if (!isAdPlaying()) {
            stopFastForward();
            adSkipPending = false;
          }
        }, 300);

        // Hard timeout: if still in ad after 15s at 16× something is wrong
        setTimeout(() => {
          if (fastForwardInterval) {
            stopFastForward();
            adSkipPending = false;
            // Escalate to tier 4 only after tier 3 fails
            attemptSkip();
          }
        }, 15000);
        return;
      } catch {
        // Fall through to tier 4
      }
    }

    // ── Tier 4: relay navigation (last resort — can cause YouTube to serve new ads) ─
    chrome.runtime.sendMessage({
      action: 'skipAd',
      youtubeUrl: window.location.href,
      videoId,
      timestamp,
    });

    // adSkipPending stays true — restoreTimestamp() will apply the grace period
    // which resets it after 6s once we land back on YouTube
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
    stopFastForward();
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
    stopFastForward();
  });
})();
