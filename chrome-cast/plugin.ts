function init() {
  $ui.register((ctx) => {

    const getCastScript = () => `
(function () {
  'use strict';

  const LOG_PREFIX = '[Chrome Cast]';

  // ── State ──
  let button = null;
  let currentVideo = null;
  let observer = null;

  // ── Helpers ──

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  function err(...args) {
    console.error(LOG_PREFIX, ...args);
  }

  // ── Find the active <video> element ──

  function findVideo() {
    // Try common Seanime player selectors
    const selectors = [
      '[data-vc-element="video"]',
      '[data-player] video',
      '[data-video-player] video',
      '[data-media-player] video',
      '[data-watch-player] video',
      '[class*="VideoPlayer"] video',
      '[class*="video-player"] video',
      '[class*="MediaPlayer"] video',
      '[class*="media-player"] video',
      '[class*="WatchPlayer"] video',
      '[class*="watch-player"] video',
      'video[src]',
      'video',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.tagName === 'VIDEO') {
        return el;
      }
    }

    // Fallback: any visible video
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      if (v.offsetParent !== null || v.readyState > 0) {
        return v;
      }
    }

    return null;
  }

  // ── Find the player root (for button placement) ──

  function findPlayerRoot(video) {
    if (!video) return null;

    // Walk up to find a container with position:relative or a known player class
    let el = video.parentElement;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      if (
        style.position === 'relative' ||
        style.position === 'absolute' ||
        el.matches(
          '[class*="Player"], [class*="player"], [data-player], [data-video-player], [data-media-player]'
        )
      ) {
        return el;
      }
      el = el.parentElement;
    }

    // Last resort: video's parent
    return video.parentElement;
  }

  // ── Cast button ──

  function createCastButton() {
    const btn = document.createElement('button');
    btn.id = 'seanime-chromecast-button';
    btn.textContent = '📺 Cast';
    btn.title = 'Cast to Chromecast';

    Object.assign(btn.style, {
      position: 'absolute',
      top: '16px',
      right: '16px',
      zIndex: '2147483647',
      padding: '8px 14px',
      fontSize: '14px',
      fontWeight: '600',
      fontFamily: 'inherit',
      color: '#fff',
      background: 'rgba(0, 0, 0, 0.7)',
      border: '1px solid rgba(255, 255, 255, 0.3)',
      borderRadius: '8px',
      cursor: 'pointer',
      transition: 'background 0.2s, opacity 0.2s',
      opacity: '0.85',
      userSelect: 'none',
      lineHeight: '1.2',
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(0, 0, 0, 0.9)';
      btn.style.opacity = '1';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(0, 0, 0, 0.7)';
      btn.style.opacity = '0.85';
    });

    btn.addEventListener('click', handleCastClick);

    return btn;
  }

  // ── Cast action ──

  async function handleCastClick(event) {
    event.preventDefault();
    event.stopPropagation();

    log('Cast button clicked');

    const video = findVideo();
    if (!video) {
      warn('No active video found');
      return;
    }

    // Enable remote playback
    video.disableRemotePlayback = false;

    if (!video.remote) {
      warn('Remote Playback API unavailable');
      if (button) button.textContent = '📺 N/A';
      return;
    }

    try {
      log('Opening device picker');
      await video.remote.prompt();
    } catch (error) {
      // user cancelled or error
      if (error.name === 'NotFoundError') {
        log('User cancelled device selection');
      } else {
        err('Remote Playback error:', error);
      }
    }
  }

  // ── Update button state from remote events ──

  function setupRemoteListeners(video) {
    if (!video || !video.remote) return;

    video.remote.addEventListener('connecting', () => {
      log('Connecting...');
      if (button) button.textContent = '📺 Connexion...';
    });

    video.remote.addEventListener('connect', () => {
      log('Connected');
      if (button) button.textContent = '📺 Connecté';
    });

    video.remote.addEventListener('disconnect', () => {
      log('Disconnected');
      if (button) button.textContent = '📺 Cast';
    });
  }

  // ── Ensure button is in the DOM ──

  function ensureCastButton() {
    // Already exists?
    if (document.getElementById('seanime-chromecast-button')) {
      return;
    }

    const video = findVideo();
    if (!video) {
      warn('No video found, skipping button injection');
      return;
    }

    currentVideo = video;

    const root = findPlayerRoot(video);
    if (!root) {
      warn('Player root not found');
      return;
    }

    log('Player root detected');

    // Ensure root is position:relative for absolute button
    const rootStyle = getComputedStyle(root);
    if (rootStyle.position === 'static') {
      root.style.position = 'relative';
    }

    // Create and inject button
    button = createCastButton();
    root.appendChild(button);

    log('Cast button added');

    // Setup remote playback listeners
    video.disableRemotePlayback = false;
    setupRemoteListeners(video);
  }

  // ── Cleanup if video changes ──

  function cleanup() {
    const oldBtn = document.getElementById('seanime-chromecast-button');
    if (oldBtn) oldBtn.remove();
    button = null;
    currentVideo = null;
  }

  // ── Re-check on DOM mutations (SPA navigation) ──

  function startObserver() {
    if (observer) return;

    observer = new MutationObserver(() => {
      const video = findVideo();
      if (video !== currentVideo) {
        log('Video element changed, re-injecting button');
        cleanup();
        ensureCastButton();
      } else if (!document.getElementById('seanime-chromecast-button') && video) {
        // Button was removed (e.g. fullscreen toggle), re-add
        ensureCastButton();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    log('MutationObserver started');
  }

  // ── Init ──

  function main() {
    log('Plugin loaded');
    ensureCastButton();
    startObserver();
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }

})();
`;

    const injectCast = async () => {
      try {
        const head = await ctx.dom.queryOne('head');
        if (!head) {
          console.error('[Chrome Cast] <head> not found');
          return;
        }

        const script = await ctx.dom.createElement('script');
        script.setText(getCastScript());
        head.append(script);

        console.log('[Chrome Cast] Injecting runtime');

        // Script removal disabled — the IIFE runs immediately and the
        // MutationObserver must persist. Removing the <script> tag is safe
        // but pointless once the code has already executed.
        // setTimeout(async () => {
        //   try { script.remove(); } catch (_) {}
        // }, 300);
      } catch (err) {
        console.error('[Chrome Cast] Failed to inject runtime:', err);
      }
    };

    injectCast();
  });
}

init();
