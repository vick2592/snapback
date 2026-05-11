// youtube.js — QuickReload YouTube content script

(function () {
  'use strict';

  // ─── Ad Detection ─────────────────────────────────────────────────────────────
  // ONLY trust the ad-showing / ad-interrupting class on #movie_player.
  // These are set by YouTube itself and are the most reliable signal.
  // We deliberately do NOT use subtree/childList mutation watching because
  // that fires hundreds of times per second and causes false positives on
  // the main video.

  function getPlayer()  { return document.querySelector('#movie_player'); }
  function getVideo()   { return document.querySelector('video'); }
  function getVideoId() {
    try { return new URLSearchParams(location.search).get('v') || null; }
    catch { return null; }
  }

  function isAdPlaying() {
    const player = getPlayer();
    if (!player) return false;
    return player.classList.contains('ad-showing') ||
           player.classList.contains('ad-interrupting');
  }

  function getSkipButton() {
    return document.querySelector(
      '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button'
    );
  }

  // ─── Skip Logic ───────────────────────────────────────────────────────────────
  // Two safe tiers only. No 16x speed (fires on real video if detection wrong).
  // No relay navigation (YouTube serves new pre-roll on fresh page load).

  let skipLock = false;

  function attemptSkip() {
    if (skipLock || !isAdPlaying()) return;
    skipLock = true;
    console.log('[QuickReload] Ad detected, attempting skip');

    // Tier 1 — click the native skip button (skippable ads)
    const skipBtn = getSkipButton();
    if (skipBtn) {
      skipBtn.click();
      console.log('[QuickReload] Clicked skip button');
      setTimeout(() => { skipLock = false; }, 2000);
      return;
    }

    // Tier 2 — seek the ad video to its end (non-skippable ads)
    const video = getVideo();
    if (video && isFinite(video.duration) && video.duration > 0) {
      console.log('[QuickReload] Seeking ad to end (duration:', video.duration, ')');
      try {
        video.currentTime = video.duration;
      } catch (e) {
        console.log('[QuickReload] Seek blocked:', e.message);
      }
    }

    // Release lock after 3s — allow re-try if the ad is still running
    setTimeout(() => { skipLock = false; }, 3000);
  }

  // ─── Observer — watch ONLY #movie_player class attribute ──────────────────────
  // Narrow scope: only the player element, only class attribute, no subtree.
  // This fires when YouTube adds/removes ad-showing — not on every DOM mutation.

  let observer = null;

  function startObserver() {
    const player = getPlayer();
    if (!player || observer) return;

    observer = new MutationObserver(() => {
      if (isAdPlaying()) attemptSkip();
    });

    observer.observe(player, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: false,
      childList: false,
    });
    console.log('[QuickReload] Observer attached to #movie_player');
  }

  function stopObserver() {
    if (observer) { observer.disconnect(); observer = null; }
  }

  // ─── Polling fallback ──────────────────────────────────────────────────────────
  // Catches pre-roll ads that appear before observer attaches,
  // and mid-rolls YouTube injects without a class mutation event.

  let pollTimer = null;

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (isAdPlaying()) attemptSkip();
    }, 700);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ─── Timestamp restoration ─────────────────────────────────────────────────────

  function restoreTimestamp() {
    const ts = parseFloat(new URLSearchParams(location.search).get('_qr_ts'));
    if (!ts || ts < 1) return;

    const clean = new URL(location.href);
    clean.searchParams.delete('_qr_ts');
    history.replaceState(null, '', clean.toString());

    waitForSeekable(ts);
  }

  function waitForSeekable(t, n) {
    n = n || 0;
    if (n > 40) return;
    const v = getVideo();
    if (v && v.readyState >= 1 && v.duration > t) {
      v.currentTime = Math.max(0, t - 1);
      return;
    }
    setTimeout(function() { waitForSeekable(t, n + 1); }, 250);
  }

  // ─── Init & SPA navigation ────────────────────────────────────────────────────

  function start() {
    if (!getPlayer() || !getVideo()) {
      setTimeout(start, 300);
      return;
    }
    startObserver();
    startPolling();
    console.log('[QuickReload] Active on', location.href);
  }

  function teardown() {
    stopObserver();
    stopPolling();
    skipLock = false;
  }

  var currentVideoId = getVideoId();

  function onNavigate() {
    var newId = getVideoId();
    if (newId === currentVideoId) return;
    currentVideoId = newId;
    teardown();
    start();
    restoreTimestamp();
  }

  var _push    = history.pushState.bind(history);
  var _replace = history.replaceState.bind(history);

  history.pushState    = function() { _push.apply(history, arguments);    setTimeout(onNavigate, 150); };
  history.replaceState = function() { _replace.apply(history, arguments); setTimeout(onNavigate, 150); };
  window.addEventListener('popstate', function() { setTimeout(onNavigate, 150); });

  // ─── Manual QuickReload message ───────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(function(msg, _sender, sendResponse) {
    if (msg.action !== 'quickReload') return;
    chrome.runtime.sendMessage({
      action: 'manualReloadYT',
      youtubeUrl: location.href,
      videoId: getVideoId(),
      timestamp: (getVideo() || {}).currentTime || 0,
    });
    sendResponse({ ok: true });
    return true;
  });

  // ─── Boot ─────────────────────────────────────────────────────────────────────

  restoreTimestamp();
  start();

  window.addEventListener('pagehide', teardown);

})();
