function init() {
    $ui.register((ctx) => {

        function getCastScript() {
            return `
(() => {

    const KEY = "__seanimeGoogleCastRuntimeV2";

    if (window[KEY]) {
        console.log("[Chrome Cast SDK] Runtime already loaded");
        return;
    }

    window[KEY] = {
        ready: false,
        context: null,
        lastSrc: "",
        casting: false
    };

    const runtime = window[KEY];

    console.log("[Chrome Cast SDK] Runtime starting");


    function findVideo() {

        const videos = Array.from(
            document.querySelectorAll("video")
        );

        if (!videos.length) {
            return null;
        }


        const playing = videos.find(v =>
            !v.paused &&
            !v.ended &&
            v.readyState > 1
        );

        if (playing) {
            return playing;
        }


        const visible = videos
            .map(video => ({
                video: video,
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



    function getVideoSource(video) {

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



    async function loadCurrentVideo(force) {

        if (!runtime.ready || !runtime.context) {
            console.log(
                "[Chrome Cast SDK] Cast not ready"
            );
            return;
        }


        const session =
            runtime.context.getCurrentSession();

        if (!session) {
            return;
        }


        const video = findVideo();

        if (!video) {
            console.log(
                "[Chrome Cast SDK] No video found"
            );
            return;
        }


        const src = getVideoSource(video);

        if (!src) {
            return;
        }


        if (
            !force &&
            src === runtime.lastSrc
        ) {
            return;
        }


        console.log(
            "[Chrome Cast SDK] New media:",
            src
        );


        runtime.lastSrc = src;


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


            if (
                force &&
                Number.isFinite(video.currentTime) &&
                video.currentTime > 1
            ) {
                request.currentTime =
                    video.currentTime;
            }


            console.log(
                "[Chrome Cast SDK] Loading media"
            );


            await session.loadMedia(
                request
            );


            console.log(
                "[Chrome Cast SDK] Media loaded"
            );


            runtime.casting = true;


            /*
             * Empêche le nouvel épisode
             * de continuer localement.
             */
            try {
                video.pause();
            } catch (e) {}


        } catch (error) {

            console.error(
                "[Chrome Cast SDK] loadMedia error:",
                error
            );

        }

    }



    function initializeCast() {

        try {

            console.log(
                "[Chrome Cast SDK] Initializing"
            );


            const context =
                cast.framework.CastContext.getInstance();


            context.setOptions({

                receiverApplicationId:
                    chrome.cast.media
                        .DEFAULT_MEDIA_RECEIVER_APP_ID,

                autoJoinPolicy:
                    chrome.cast.AutoJoinPolicy
                        .ORIGIN_SCOPED

            });


            runtime.context = context;
            runtime.ready = true;


            console.log(
                "[Chrome Cast SDK] Ready"
            );


            context.addEventListener(

                cast.framework
                    .CastContextEventType
                    .SESSION_STATE_CHANGED,

                function(event) {

                    console.log(
                        "[Chrome Cast SDK] Session:",
                        event.sessionState
                    );


                    if (
                        event.sessionState ===
                        cast.framework.SessionState
                            .SESSION_STARTED ||
                        event.sessionState ===
                        cast.framework.SessionState
                            .SESSION_RESUMED
                    ) {

                        console.log(
                            "[Chrome Cast SDK] Connected"
                        );


                        runtime.casting = true;


                        setTimeout(
                            function() {
                                loadCurrentVideo(true);
                            },
                            300
                        );

                    }


                    if (
                        event.sessionState ===
                        cast.framework.SessionState
                            .SESSION_ENDED
                    ) {

                        console.log(
                            "[Chrome Cast SDK] Disconnected"
                        );


                        runtime.casting = false;
                        runtime.lastSrc = "";

                    }

                }

            );


        } catch (error) {

            console.error(
                "[Chrome Cast SDK] Init error:",
                error
            );

        }

    }



    /*
     * IMPORTANT :
     * Google demande que ce callback
     * existe AVANT de charger le SDK.
     */
    window["__onGCastApiAvailable"] =
        function(isAvailable) {

            console.log(
                "[Chrome Cast SDK] API available:",
                isAvailable
            );


            if (isAvailable) {
                initializeCast();
            }

        };



    /*
     * Charge le SDK seulement après
     * avoir créé le callback.
     */
    if (
        typeof cast !== "undefined" &&
        cast.framework
    ) {

        console.log(
            "[Chrome Cast SDK] SDK already present"
        );

        initializeCast();

    } else {

        console.log(
            "[Chrome Cast SDK] Loading SDK"
        );


        const existing =
            document.querySelector(
                "script[data-seanime-cast-sdk]"
            );


        if (!existing) {

            const script =
                document.createElement("script");


            script.src =
                "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";


            script.async = true;


            script.setAttribute(
                "data-seanime-cast-sdk",
                "1"
            );


            script.onload = function() {

                console.log(
                    "[Chrome Cast SDK] Script loaded"
                );

                /*
                 * Certains environnements
                 * ne rappellent pas toujours
                 * le callback comme prévu.
                 */
                setTimeout(function() {

                    if (
                        !runtime.ready &&
                        typeof cast !== "undefined" &&
                        cast.framework
                    ) {

                        console.log(
                            "[Chrome Cast SDK] Manual initialization"
                        );

                        initializeCast();

                    }

                }, 500);

            };


            script.onerror = function(error) {

                console.error(
                    "[Chrome Cast SDK] SDK loading error:",
                    error
                );

            };


            document.head.appendChild(
                script
            );

        }

    }



    /*
     * Bouton du Tray
     */
    window.addEventListener(
        "seanime-cast-sdk-start",
        async function() {

            console.log(
                "[Chrome Cast SDK] Tray click"
            );


            if (
                !runtime.ready ||
                !runtime.context
            ) {

                console.error(
                    "[Chrome Cast SDK] SDK not ready"
                );

                return;
            }


            const session =
                runtime.context
                    .getCurrentSession();


            /*
             * Déjà connecté :
             * recharge simplement
             * la vidéo actuelle.
             */
            if (session) {

                console.log(
                    "[Chrome Cast SDK] Existing session"
                );

                await loadCurrentVideo(true);

                return;
            }


            try {

                console.log(
                    "[Chrome Cast SDK] Opening device picker"
                );


                await runtime.context
                    .requestSession();


            } catch (error) {

                console.error(
                    "[Chrome Cast SDK] requestSession:",
                    error
                );

            }

        }
    );



    /*
     * SURVEILLANCE DES ÉPISODES
     *
     * Toutes les secondes on regarde
     * si Seanime a changé la source.
     */
    setInterval(
        function() {

            if (
                !runtime.casting ||
                !runtime.context
            ) {
                return;
            }


            const session =
                runtime.context
                    .getCurrentSession();


            if (!session) {
                return;
            }


            const video =
                findVideo();


            const src =
                getVideoSource(video);


            if (
                src &&
                src !== runtime.lastSrc
            ) {

                console.log(
                    "[Chrome Cast SDK] Episode/source changed"
                );


                /*
                 * Seanime démarre parfois
                 * le nouvel épisode localement.
                 */
                try {
                    video.pause();
                } catch (e) {}


                /*
                 * Petite attente pour laisser
                 * Seanime finaliser le nouveau src.
                 */
                setTimeout(
                    function() {

                        loadCurrentVideo(false);

                    },
                    400
                );

            }

        },
        1000
    );

})();
`;
        }



        async function injectRuntime() {

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
                "[Chrome Cast SDK] Runtime injected"
            );
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
                        "seanime-cast-sdk-start"
                    )
                );
            `);


            await head.append(script);
        }



        const tray = ctx.newTray({

            tooltipText: "Chromecast",

            iconUrl:
                "https://raw.githubusercontent.com/Templarian/MaterialDesign/master/svg/cast.svg",

            withContent: true,

        });



        tray.render(() => {

            return tray.stack({

                items: [

                    tray.text(
                        "📺 Chromecast"
                    ),

                    tray.text(
                        "La lecture suivra automatiquement les épisodes."
                    ),

                    tray.button(
                        "📺 Caster",
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
                    "[Chrome Cast SDK] Tray event"
                );


                await triggerCast();

            }
        );



        ctx.dom.onReady(
            async () => {

                console.log(
                    "[Chrome Cast SDK] Plugin loaded"
                );


                await injectRuntime();

            }
        );

    });
}

init();
