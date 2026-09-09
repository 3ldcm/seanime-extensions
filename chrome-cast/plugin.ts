// ┌──────────────────────────────────────────────────────────────┐
// │  Chrome Cast — Plugin pour Seanime                            │
// │                                                                │
// │  Injecte un script dans la page Seanime pour :                 │
// │  1. Détecter la <video> du lecteur                            │
// │  2. Créer un bouton Cast flottant                             │
// │  3. Ouvrir le sélecteur Chromecast via la Remote Playback API  │
// └──────────────────────────────────────────────────────────────┘

const DevMode = true;
const originalLog = console.log;
console.log = (...args: any[]) => {
    if (DevMode) originalLog.apply(console, args);
};

function init() {
    $ui.register((ctx) => {

        const RUNTIME_ID = 'seanime-chromecast-runtime';

        // Le script injecté dans la vraie page Seanime
        const getCastScript = (): string => `
(function () {
    'use strict';

    if (window.__seanimeCastLoaded) return;
    window.__seanimeCastLoaded = true;

    const STATE = {
        IDLE: 'idle',
        SCANNING: 'scanning',
        CONNECTING: 'connecting',
        CONNECTED: 'connected',
        DISCONNECTED: 'disconnected',
        UNAVAILABLE: 'unavailable',
    };

    const currentState = {
        button: null,
        video: null,
        remote: null,
        state: STATE.IDLE,
        pollTimer: null,
    };

    const SELECTORS = [
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

    const PLAYER_SELECTORS = [
        '[data-vc-element="video-container"]',
        '[data-player]',
        '[data-video-player]',
        '[data-media-player]',
        '[data-watch-player]',
        '[class*="VideoPlayer"]',
        '[class*="video-player"]',
        '[class*="MediaPlayer"]',
        '[class*="media-player"]',
        '[class*="WatchPlayer"]',
        '[class*="watch-player"]',
        '[class*="Player"]',
        '[class*="player"]',
    ];

    // ─── Helpers ────────────────────────────────────────────────

    function log(...args) {
        console.log('[Chrome Cast]', ...args);
    }

    function warn(...args) {
        console.warn('[Chrome Cast]', ...args);
    }

    function err(...args) {
        console.error('[Chrome Cast]', ...args);
    }

    function findVideo() {
        for (const sel of SELECTORS) {
            const el = document.querySelector(sel);
            if (el && el.tagName === 'VIDEO') return el;
        }
        return null;
    }

    function findPlayerRoot(video) {
        if (!video) return null;

        // Walk up to find a container with position:relative/absolute
        // or matching a known player class
        let el = video.parentElement;
        let best = video.parentElement;
        while (el && el !== document.body) {
            const style = getComputedStyle(el);
            if (style.position === 'relative' || style.position === 'absolute') {
                best = el;
                break;
            }
            for (const sel of PLAYER_SELECTORS) {
                try {
                    if (el.matches(sel)) {
                        return el;
                    }
                } catch (_) {}
            }
            best = el;
            el = el.parentElement;
        }
        return best;
    }

    // ─── State management ───────────────────────────────────────

    function setState(newState) {
        currentState.state = newState;
        if (!currentState.button) return;

        switch (newState) {
            case STATE.IDLE:
                currentState.button.textContent = '📺 Cast';
                currentState.button.title = 'Cast to Chromecast';
                currentState.button.style.opacity = '0.85';
                currentState.button.disabled = false;
                break;
            case STATE.SCANNING:
                currentState.button.textContent = '📺 Scan...';
                currentState.button.style.opacity = '1';
                currentState.button.disabled = true;
                break;
            case STATE.CONNECTING:
                currentState.button.textContent = '📺 Connexion...';
                currentState.button.style.opacity = '1';
                currentState.button.disabled = true;
                break;
            case STATE.CONNECTED:
                currentState.button.textContent = '📺 Connecté';
                currentState.button.style.opacity = '1';
                currentState.button.disabled = false;
                currentState.button.title = 'Cliquer pour déconnecter';
                break;
            case STATE.DISCONNECTED:
                currentState.button.textContent = '📺 Cast';
                currentState.button.title = 'Cast to Chromecast';
                currentState.button.style.opacity = '0.85';
                currentState.button.disabled = false;
                break;
            case STATE.UNAVAILABLE:
                currentState.button.textContent = '📺 N/A';
                currentState.button.style.opacity = '0.5';
                currentState.button.disabled = true;
                currentState.button.title = 'Remote Playback API non disponible';
                break;
        }
    }

    // ─── Cast action ────────────────────────────────────────────

    async function handleCastClick(event) {
        event.preventDefault();
        event.stopPropagation();

        const video = findVideo();
        if (!video) {
            warn('No video found');
            return;
        }

        // Disable remote playback suppression
        video.disableRemotePlayback = false;

        if (!video.remote) {
            warn('Remote Playback API unavailable');
            setState(STATE.UNAVAILABLE);
            return;
        }

        // If already connected, disconnect
        if (currentState.remote && currentState.state === STATE.CONNECTED) {
            try {
                await video.remote.cancelWatchAvailability();
            } catch (_) {}
            return;
        }

        setState(STATE.SCANNING);
        log('Opening device picker');

        try {
            await video.remote.prompt();
        } catch (error) {
            if (error && error.name === 'NotFoundError') {
                log('User cancelled device selection');
                setState(STATE.IDLE);
            } else {
                err('Remote Playback error:', error);
                setState(STATE.IDLE);
            }
        }
    }

    function setupRemoteListeners(video) {
        // Cleanup old listeners
        if (currentState.remote) {
            try {
                currentState.remote.removeEventListener('connecting', () => {});
                currentState.remote.removeEventListener('connect', () => {});
                currentState.remote.removeEventListener('disconnect', () => {});
            } catch (_) {}
        }

        currentState.remote = video.remote;

        video.remote.addEventListener('connecting', () => {
            log('Connecting...');
            setState(STATE.CONNECTING);
        });

        video.remote.addEventListener('connect', () => {
            log('Connected');
            setState(STATE.CONNECTED);
        });

        video.remote.addEventListener('disconnect', () => {
            log('Disconnected');
            setState(STATE.DISCONNECTED);
            setTimeout(() => setState(STATE.IDLE), 2000);
        });
    }

    // ─── Button creation ────────────────────────────────────────

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
            background: 'rgba(0, 0, 0, 0.75)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            borderRadius: '8px',
            cursor: 'pointer',
            transition: 'background 0.2s, opacity 0.2s, transform 0.15s',
            opacity: '0.85',
            userSelect: 'none',
            lineHeight: '1.2',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        });

        btn.addEventListener('mouseenter', () => {
            if (!btn.disabled) {
                btn.style.background = 'rgba(0, 0, 0, 0.95)';
                btn.style.opacity = '1';
                btn.style.transform = 'scale(1.05)';
            }
        });

        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'rgba(0, 0, 0, 0.75)';
            btn.style.opacity = currentState.state === STATE.UNAVAILABLE ? '0.5' : '0.85';
            btn.style.transform = 'scale(1)';
        });

        btn.addEventListener('mousedown', () => {
            if (!btn.disabled) btn.style.transform = 'scale(0.95)';
        });

        btn.addEventListener('mouseup', () => {
            if (!btn.disabled) btn.style.transform = 'scale(1.05)';
        });

        btn.addEventListener('click', handleCastClick);

        return btn;
    }

    function ensureCastButton() {
        if (document.getElementById('seanime-chromecast-button')) {
            return true;
        }

        const video = findVideo();
        if (!video) return false;

        const root = findPlayerRoot(video);
        if (!root) return false;

        // Make sure root can host an absolute child
        const rootStyle = getComputedStyle(root);
        if (rootStyle.position === 'static') {
            root.style.position = 'relative';
        }

        currentState.video = video;
        currentState.button = createCastButton();
        root.appendChild(currentState.button);

        video.disableRemotePlayback = false;
        setupRemoteListeners(video);

        if (!video.remote) {
            setState(STATE.UNAVAILABLE);
        }

        log('Cast button injected');
        return true;
    }

    function cleanup() {
        if (currentState.button && currentState.button.parentNode) {
            currentState.button.parentNode.removeChild(currentState.button);
        }
        currentState.button = null;
        currentState.video = null;
        currentState.remote = null;
    }

    // ─── Main loop ──────────────────────────────────────────────

    function startPolling() {
        if (currentState.pollTimer) return;

        let lastVideo = null;
        currentState.pollTimer = setInterval(() => {
            const video = findVideo();

            if (video !== lastVideo) {
                // Video changed — rebuild button
                if (lastVideo) cleanup();
                lastVideo = video;
                if (video) {
                    ensureCastButton();
                }
            } else if (video && !currentState.button) {
                // Same video but button was removed (fullscreen toggle, etc.)
                ensureCastButton();
            } else if (!video && currentState.button) {
                // Video gone
                cleanup();
                lastVideo = null;
            }
        }, 1000);

        log('Polling started');
    }

    function main() {
        log('Runtime loaded');
        ensureCastButton();
        startPolling();
    }

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

                // Remove old runtime if present
                const existing = await ctx.dom.queryOne(`#${RUNTIME_ID}`);
                if (existing) {
                    try { existing.remove(); } catch (_) {}
                }

                const script = await ctx.dom.createElement('script');
                script.setId(RUNTIME_ID);
                script.setText(getCastScript());
                head.append(script);

                console.log('[Chrome Cast] Runtime injected');

                // No setTimeout cleanup — the IIFE has already executed
                // and the runtime must persist in the page context.
            } catch (error) {
                console.error('[Chrome Cast] Failed to inject runtime:', error);
            }
        };

        injectCast();
    });
}

init();
