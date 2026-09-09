function init() {
    $ui.register((ctx) => {

        const getCastScript = () => `
(function () {
    'use strict';

    const LOG_PREFIX = '[Chrome Cast]';
    const BUTTON_ID = 'seanime-chromecast-button';
    const RUNTIME_KEY = '__seanimeChromecastRuntime';

    if (window[RUNTIME_KEY]) {
        console.log(LOG_PREFIX, 'Runtime already loaded');
        return;
    }

    window[RUNTIME_KEY] = true;

    console.log(LOG_PREFIX, 'Runtime loaded');

    let button = null;
    let observer = null;
    let currentVideo = null;

    function findVideo() {
        const videos = Array.from(
            document.querySelectorAll('video')
        );

        if (!videos.length) {
            return null;
        }

        const playing = videos.find(function(video) {
            return !video.paused && !video.ended;
        });

        return playing || videos[0];
    }

    function setButtonText(text) {
        if (button) {
            button.textContent = text;
        }
    }

    async function castNow(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        console.log(LOG_PREFIX, 'Cast button clicked');

        const video = findVideo();

        if (!video) {
            console.log(LOG_PREFIX, 'No video found');
            return;
        }

        try {
            video.disableRemotePlayback = false;
        } catch (_) {}

        console.log(
            LOG_PREFIX,
            'Video src:',
            video.currentSrc || video.src
        );

        if (!video.remote) {
            console.log(
                LOG_PREFIX,
                'Remote Playback API unavailable'
            );

            setButtonText('❌ Cast indisponible');

            window.setTimeout(function() {
                setButtonText('📺 Cast');
            }, 2000);

            return;
        }

        try {
            console.log(
                LOG_PREFIX,
                'Opening device picker'
            );

            setButtonText('📺 Connexion...');

            await video.remote.prompt();

        } catch (error) {
            console.log(
                LOG_PREFIX,
                'Remote prompt error:',
                error
            );

            setButtonText('📺 Cast');
        }
    }

    function createButton() {
        let existing =
            document.getElementById(
                BUTTON_ID
            );

        if (existing) {
            button = existing;
            return existing;
        }

        const btn =
            document.createElement('button');

        btn.id =
            BUTTON_ID;

        btn.type =
            'button';

        btn.textContent =
            '📺 Cast';

        Object.assign(
            btn.style,
            {
                position: 'fixed',
                top: '20px',
                right: '20px',
                zIndex: '2147483647',

                padding: '10px 15px',

                background:
                    'rgba(0,0,0,.80)',

                color:
                    'white',

                border:
                    '1px solid rgba(255,255,255,.35)',

                borderRadius:
                    '8px',

                fontSize:
                    '14px',

                fontWeight:
                    '600',

                cursor:
                    'pointer',

                pointerEvents:
                    'auto'
            }
        );

        btn.addEventListener(
            'click',
            castNow
        );

        button = btn;

        return btn;
    }

    function installRemoteEvents(video) {
        if (
            !video ||
            !video.remote ||
            video.dataset.castEvents === '1'
        ) {
            return;
        }

        video.dataset.castEvents = '1';

        video.remote.addEventListener(
            'connecting',
            function() {
                console.log(
                    LOG_PREFIX,
                    'Connecting'
                );

                setButtonText(
                    '📺 Connexion...'
                );
            }
        );

        video.remote.addEventListener(
            'connect',
            function() {
                console.log(
                    LOG_PREFIX,
                    'Connected'
                );

                setButtonText(
                    '📺 Connecté'
                );
            }
        );

        video.remote.addEventListener(
            'disconnect',
            function() {
                console.log(
                    LOG_PREFIX,
                    'Disconnected'
                );

                setButtonText(
                    '📺 Cast'
                );
            }
        );
    }

    function refresh() {
        const video =
            findVideo();

        if (!video) {
            if (button) {
                button.style.display =
                    'none';
            }

            return;
        }

        if (video !== currentVideo) {
            currentVideo =
                video;

            console.log(
                LOG_PREFIX,
                'Video detected'
            );

            try {
                video.disableRemotePlayback =
                    false;
            } catch (_) {}

            installRemoteEvents(
                video
            );
        }

        const btn =
            createButton();

        btn.style.display =
            'block';

        const target =
            document.fullscreenElement ||
            document.body;

        if (
            btn.parentElement !==
            target
        ) {
            target.appendChild(
                btn
            );

            console.log(
                LOG_PREFIX,
                'Cast button attached'
            );
        }
    }

    function startObserver() {
        if (observer) {
            return;
        }

        observer =
            new MutationObserver(
                function() {
                    refresh();
                }
            );

        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true
            }
        );

        console.log(
            LOG_PREFIX,
            'Observer started'
        );
    }

    document.addEventListener(
        'fullscreenchange',
        function() {
            window.setTimeout(
                refresh,
                100
            );
        }
    );

    window.setInterval(
        refresh,
        1000
    );

    refresh();
    startObserver();

})();
`;

        async function injectCast() {
            try {

                console.log(
                    '[Chrome Cast] Injection requested'
                );

                const head =
                    await ctx.dom.queryOne(
                        'head'
                    );

                if (!head) {
                    console.error(
                        '[Chrome Cast] HEAD not found'
                    );

                    return;
                }

                const script =
                    await ctx.dom.createElement(
                        'script'
                    );

                script.setText(
                    getCastScript()
                );

                head.append(
                    script
                );

                console.log(
                    '[Chrome Cast] Script injected'
                );

            } catch (error) {

                console.error(
                    '[Chrome Cast] Injection error:',
                    error
                );
            }
        }

        ctx.dom.onReady(
            async () => {

                console.log(
                    '[Chrome Cast] DOM ready'
                );

                await injectCast();

                /*
                 * Deuxième tentative quand le lecteur existe.
                 */
                try {

                    const video =
                        await ctx.dom.queryOne(
                            "[data-vc-element='video']"
                        );

                    if (video) {

                        console.log(
                            '[Chrome Cast] Seanime video detected'
                        );

                        await injectCast();
                    }

                } catch (error) {

                    console.error(
                        '[Chrome Cast] Video detection error:',
                        error
                    );
                }
            }
        );

    });
}

init();
