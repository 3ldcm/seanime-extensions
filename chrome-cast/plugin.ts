function init() {
    $ui.register((ctx) => {

        function getCastScript() {
            return `
(() => {

    const KEY = "__seanimeCastAutoEpisode";

    if (window[KEY]) {
        console.log("[Chrome Cast] Runtime already loaded");
        return;
    }

    window[KEY] = {
        lastSrc: "",
        sdkReady: false,
        castContext: null
    };

    const runtime = window[KEY];

    console.log("[Chrome Cast] Runtime loaded");


    function findVideo() {

        const videos = Array.from(
            document.querySelectorAll("video")
        );

        if (!videos.length) {
            return null;
        }

        const playing = videos.find(video =>
            !video.paused &&
            !video.ended
        );

        if (playing) {
            return playing;
        }

        const visible = videos
            .map(video => ({
                video,
                rect: video.getBoundingClientRect()
            }))
            .filter(item =>
                item.rect.width > 100 &&
                item.rect.height > 100
            )
            .sort((a, b) =>
                (b.rect.width * b.rect.height) -
                (a.rect.width * a.rect.height)
            );

        if (visible.length) {
            return visible[0].video;
        }

        return videos[0];
    }


    function getSrc(video) {

        if (!video) {
            return "";
        }

        return (
            video.currentSrc ||
            video.src ||
            video.querySelector("source")?.src ||
            ""
        );
    }


    /*
     * REMOTE PLAYBACK
     *
     * Sert uniquement au premier Cast
     * puisque cette méthode fonctionne déjà chez toi.
     */
    async function startRemoteCast() {

        const video = findVideo();

        if (!video) {
            console.error("[Chrome Cast] No video found");
            return;
        }

        const src = getSrc(video);

        console.log("[Chrome Cast] First Cast src:", src);

        runtime.lastSrc = src;

        try {
            video.disableRemotePlayback = false;
        } catch (e) {}

        if (!video.remote) {
            console.error(
                "[Chrome Cast] Remote Playback unavailable"
            );
            return;
        }

        if (
            video.remote.state === "connected" ||
            video.remote.state === "connecting"
        ) {
            console.log(
                "[Chrome Cast] Remote already connected"
            );
            return;
        }

        try {

            console.log(
                "[Chrome Cast] Opening device picker"
            );

            await video.remote.prompt();

            console.log(
                "[Chrome Cast] Remote prompt completed"
            );

        } catch (error) {

            console.error(
                "[Chrome Cast] Remote prompt error:",
                error
            );
        }
    }


    /*
     * GOOGLE CAST SDK
     *
     * Utilisé pour récupérer la session active
     * et remplacer le média sans déconnexion.
     */
    function initCastSdk() {

        try {

            if (
                typeof cast === "undefined" ||
                !cast.framework
            ) {
                return false;
            }

            const castContext =
                cast.framework.CastContext.getInstance();

            castContext.setOptions({
                receiverApplicationId:
                    chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,

                autoJoinPolicy:
                    chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
            });

            runtime.castContext = castContext;
            runtime.sdkReady = true;

            console.log(
                "[Chrome Cast SDK] Ready"
            );

            return true;

        } catch (error) {

            console.error(
                "[Chrome Cast SDK] Init error:",
                error
            );

            return false;
        }
    }


    window.__onGCastApiAvailable =
        function(isAvailable) {

            console.log(
                "[Chrome Cast SDK] API available:",
                isAvailable
            );

            if (isAvailable) {
                initCastSdk();
            }
        };


    /*
     * Charge le SDK officiel Google.
     */
    if (
        !document.querySelector(
            "script[data-seanime-google-cast-sdk]"
        )
    ) {

        const sdk =
            document.createElement("script");

        sdk.src =
            "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

        sdk.async = true;

        sdk.setAttribute(
            "data-seanime-google-cast-sdk",
            "1"
        );

        sdk.onload = function() {

            console.log(
                "[Chrome Cast SDK] Script loaded"
            );

            /*
             * Fallback au cas où le callback Google
             * ne serait pas déclenché.
             */
            setTimeout(
                function() {

                    if (!runtime.sdkReady) {
                        initCastSdk();
                    }

                },
                500
            );
        };

        sdk.onerror = function(error) {

            console.error(
                "[Chrome Cast SDK] Script loading failed:",
                error
            );
        };

        document.head.appendChild(sdk);
    }


    /*
     * Charge une nouvelle vidéo dans
     * une session Cast déjà active.
     */
    async function loadOnExistingCast(src) {

        if (
            !runtime.sdkReady ||
            !runtime.castContext
        ) {

            console.log(
                "[Chrome Cast SDK] SDK not ready"
            );

            return false;
        }


        const session =
            runtime.castContext.getCurrentSession();

        if (!session) {

            console.log(
                "[Chrome Cast SDK] No active session"
            );

            return false;
        }


        console.log(
            "[Chrome Cast SDK] Existing session found"
        );


        try {

            const type =
                src.indexOf(".m3u8") !== -1
                ? "application/x-mpegURL"
                : "video/mp4";


            const mediaInfo =
                new chrome.cast.media.MediaInfo(
                    src,
                    type
                );


            const request =
                new chrome.cast.media.LoadRequest(
                    mediaInfo
                );


            request.autoplay = true;


            console.log(
                "[Chrome Cast SDK] Loading new episode:",
                src
            );


            await session.loadMedia(request);


            console.log(
                "[Chrome Cast SDK] New episode loaded"
            );


            runtime.lastSrc = src;


            return true;

        } catch (error) {

            console.error(
                "[Chrome Cast SDK] loadMedia error:",
                error
            );


            return false;
        }
    }


    /*
     * Clic sur l'icône Cast.
     */
    window.addEventListener(
        "seanime-cast-start",
        async function() {

            const video =
                findVideo();

            if (!video) {
                return;
            }


            const src =
                getSrc(video);


            /*
             * Si on a déjà une CastSession,
             * on l'utilise directement.
             */
            if (
                runtime.sdkReady &&
                runtime.castContext &&
                runtime.castContext.getCurrentSession()
            ) {

                console.log(
                    "[Chrome Cast] Existing Cast session"
                );


                const loaded =
                    await loadOnExistingCast(src);


                if (loaded) {

                    try {
                        video.pause();
                    } catch (e) {}

                    return;
                }
            }


            /*
             * Sinon premier Cast classique.
             */
            await startRemoteCast();

        }
    );


    /*
     * Surveillance des changements d'épisode.
     */
    setInterval(
        async function() {

            const video =
                findVideo();

            if (!video) {
                return;
            }


            const src =
                getSrc(video);

            if (!src) {
                return;
            }


            /*
             * Première détection
             */
            if (!runtime.lastSrc) {
                runtime.lastSrc = src;
                return;
            }


            /*
             * Pas de changement
             */
            if (src === runtime.lastSrc) {
                return;
            }


            console.log(
                "[Chrome Cast] New episode detected"
            );

            console.log(
                "[Chrome Cast] Old:",
                runtime.lastSrc
            );

            console.log(
                "[Chrome Cast] New:",
                src
            );


            /*
             * Très important :
             * on vérifie d'abord si une vraie
             * session Cast est toujours active.
             */
            if (
                runtime.sdkReady &&
                runtime.castContext
            ) {

                const session =
                    runtime.castContext.getCurrentSession();


                if (session) {

                    console.log(
                        "[Chrome Cast] Cast session still connected"
                    );


                    /*
                     * Stop lecture locale.
                     */
                    try {
                        video.pause();
                    } catch (e) {}


                    const success =
                        await loadOnExistingCast(src);


                    if (success) {
                        return;
                    }
                }
            }


            /*
             * Pas de session Cast trouvée.
             *
             * On mémorise la nouvelle source,
             * mais on ne relance PAS automatiquement
             * le picker.
             */
            console.log(
                "[Chrome Cast] No existing Cast session"
            );


            runtime.lastSrc = src;

        },
        1000
    );

})();
`;
        }


        async function injectRuntime() {

            try {

                const head =
                    await ctx.dom.queryOne("head");

                if (!head) {
                    return;
                }


                const script =
                    await ctx.dom.createElement("script");


                script.setText(
                    getCastScript()
                );


                await head.append(script);


                console.log(
                    "[Chrome Cast] Runtime injected"
                );

            } catch (error) {

                console.error(
                    "[Chrome Cast] Runtime injection error:",
                    error
                );
            }
        }


        async function triggerCast() {

            const head =
                await ctx.dom.queryOne("head");

            if (!head) {
                return;
            }


            const script =
                await ctx.dom.createElement("script");


            script.setText(`
                window.dispatchEvent(
                    new CustomEvent(
                        "seanime-cast-start"
                    )
                );
            `);


            await head.append(script);
        }


        /*
         * TRAY
         */
        const tray = ctx.newTray({

            tooltipText: "Chromecast",

            iconUrl:
                "https://raw.githubusercontent.com/Templarian/MaterialDesign/master/svg/cast.svg",

            withContent: true

        });


        tray.render(() => {

            return tray.stack({

                items: [

                    tray.text(
                        "📺 Chromecast"
                    ),

                    tray.button(
                        "📡 Caster",
                        {
                            onClick:
                                "chromecast-start",

                            intent:
                                "success"
                        }
                    )

                ]

            });

        });


        ctx.registerEventHandler(
            "chromecast-start",
            async () => {

                console.log(
                    "[Chrome Cast] Tray event"
                );


                await triggerCast();
            }
        );


        ctx.dom.onReady(
            async () => {

                console.log(
                    "[Chrome Cast] Plugin loaded"
                );


                await injectRuntime();
            }
        );

    });
}

init();
