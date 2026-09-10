function init() {
    $ui.register((ctx) => {

        function getCastScript() {
            return `
(() => {

    const KEY = "__seanimeChromecast_2_4_7";

    if (window[KEY]) {
        console.log("[CAST-2.4.7] Runtime already loaded");
        return;
    }

    const runtime = window[KEY] = {
        castVideo: null,
        castSrc: "",
        connected: false,

        pendingVideo: null,
        pendingSrc: "",

        switching: false
    };

    console.log("[CAST-2.4.7] Runtime loaded");


    /*
     * ==========================================================
     * VIDEO HELPERS
     * ==========================================================
     */

    function getSrc(video) {

        if (!video) {
            return "";
        }

        try {
            if (video.currentSrc) {
                return video.currentSrc;
            }
        } catch (e) {}

        try {
            if (video.src) {
                return video.src;
            }
        } catch (e) {}

        try {

            const source =
                video.querySelector("source");

            if (source && source.src) {
                return source.src;
            }

        } catch (e) {}

        return "";
    }


    function getVideos() {

        try {

            return Array.from(
                document.querySelectorAll("video")
            );

        } catch (e) {

            return [];
        }
    }


    function findBestVideo() {

        const videos =
            getVideos();

        if (!videos.length) {
            return null;
        }


        /*
         * Priorité à un nouveau player en lecture.
         */
        const playing =
            videos.find(function(video) {

                return (
                    video !== runtime.castVideo &&
                    !video.paused &&
                    !video.ended &&
                    getSrc(video)
                );

            });

        if (playing) {
            return playing;
        }


        /*
         * Player en lecture, même si c'est celui casté.
         */
        const anyPlaying =
            videos.find(function(video) {

                return (
                    !video.paused &&
                    !video.ended &&
                    getSrc(video)
                );

            });

        if (anyPlaying) {
            return anyPlaying;
        }


        /*
         * Plus grand player visible.
         */
        const visible =
            videos
                .map(function(video) {

                    return {
                        video: video,
                        rect: video.getBoundingClientRect()
                    };

                })
                .filter(function(item) {

                    return (
                        item.rect.width > 100 &&
                        item.rect.height > 100 &&
                        getSrc(item.video)
                    );

                })
                .sort(function(a, b) {

                    return (
                        b.rect.width * b.rect.height -
                        a.rect.width * a.rect.height
                    );

                });


        if (visible.length) {
            return visible[0].video;
        }


        return videos.find(function(video) {
            return !!getSrc(video);
        }) || null;
    }



    /*
     * ==========================================================
     * REMOTE EVENTS
     * ==========================================================
     */

    function attachRemoteEvents(video) {

        if (
            !video ||
            !video.remote ||
            video.__cast247Events
        ) {
            return;
        }


        video.__cast247Events = true;


        video.remote.addEventListener(
            "connecting",
            function() {

                console.log(
                    "[CAST-2.4.7] Connecting"
                );

            }
        );


        video.remote.addEventListener(
            "connect",
            function() {

                runtime.castVideo =
                    video;

                runtime.castSrc =
                    getSrc(video);

                runtime.connected =
                    true;


                console.log(
                    "[CAST-2.4.7] Connected"
                );

                console.log(
                    "[CAST-2.4.7] Cast owner:",
                    runtime.castSrc
                );

            }
        );


        video.remote.addEventListener(
            "disconnect",
            function() {

                console.log(
                    "[CAST-2.4.7] Disconnected"
                );


                if (
                    runtime.castVideo === video
                ) {

                    runtime.connected =
                        false;

                    runtime.castVideo =
                        null;

                    runtime.castSrc =
                        "";

                }

            }
        );
    }



    /*
     * ==========================================================
     * CAST
     * ==========================================================
     */

    async function castVideo(video) {

        if (!video) {

            console.error(
                "[CAST-2.4.7] No video"
            );

            return;
        }


        const src =
            getSrc(video);


        if (!src) {

            console.error(
                "[CAST-2.4.7] No video source"
            );

            return;
        }


        console.log(
            "[CAST-2.4.7] Cast source:",
            src
        );


        try {

            video.disableRemotePlayback =
                false;

        } catch (e) {}


        if (!video.remote) {

            console.error(
                "[CAST-2.4.7] RemotePlayback unavailable"
            );

            return;
        }


        attachRemoteEvents(video);


        /*
         * Ce player est déjà connecté.
         */
        if (
            video.remote.state ===
            "connected"
        ) {

            runtime.castVideo =
                video;

            runtime.castSrc =
                src;

            runtime.connected =
                true;


            console.log(
                "[CAST-2.4.7] Already connected"
            );

            return;
        }


        if (
            video.remote.state ===
            "connecting"
        ) {

            console.log(
                "[CAST-2.4.7] Already connecting"
            );

            return;
        }


        try {

            console.log(
                "[CAST-2.4.7] Opening device picker"
            );


            await video.remote.prompt();


            console.log(
                "[CAST-2.4.7] Prompt completed"
            );

        } catch (error) {

            console.error(
                "[CAST-2.4.7] Prompt error:",
                error
            );

        }
    }



    /*
     * ==========================================================
     * ACTION DU BOUTON
     * ==========================================================
     */

    async function startCast() {

        /*
         * Si Seanime a déjà chargé l'épisode suivant,
         * le bouton caste directement ce nouvel épisode.
         */
        if (
            runtime.pendingVideo &&
            runtime.pendingSrc
        ) {

            console.log(
                "[CAST-2.4.7] Casting pending episode"
            );


            const video =
                runtime.pendingVideo;


            runtime.pendingVideo =
                null;

            runtime.pendingSrc =
                "";


            await castVideo(video);

            return;
        }


        const video =
            findBestVideo();


        await castVideo(video);
    }



    /*
     * ==========================================================
     * NOUVEL EPISODE
     * ==========================================================
     */

    function newEpisodeDetected(
        video,
        reason
    ) {

        if (
            !runtime.connected ||
            !runtime.castVideo
        ) {
            return;
        }


        if (!video) {
            return;
        }


        /*
         * Important :
         * le video RemotePlayback actuel n'est PAS
         * considéré comme un nouvel épisode.
         */
        if (
            video === runtime.castVideo
        ) {
            return;
        }


        const src =
            getSrc(video);


        if (!src) {
            return;
        }


        if (
            src === runtime.castSrc
        ) {
            return;
        }


        /*
         * Même épisode déjà détecté.
         */
        if (
            src === runtime.pendingSrc
        ) {

            /*
             * On s'assure quand même
             * qu'il ne joue pas localement.
             */
            try {

                if (!video.paused) {
                    video.pause();
                }

            } catch (e) {}


            return;
        }


        runtime.pendingVideo =
            video;

        runtime.pendingSrc =
            src;


        console.log(
            "[CAST-2.4.7] =================================="
        );

        console.log(
            "[CAST-2.4.7] NEW EPISODE"
        );

        console.log(
            "[CAST-2.4.7] Reason:",
            reason
        );

        console.log(
            "[CAST-2.4.7] Old:",
            runtime.castSrc
        );

        console.log(
            "[CAST-2.4.7] New:",
            src
        );


        /*
         * Ne pas laisser Seanime jouer
         * l'épisode 2 localement.
         */
        try {

            if (!video.paused) {

                console.log(
                    "[CAST-2.4.7] Pausing local new episode"
                );

                video.pause();

            }

        } catch (e) {}


        /*
         * EXPERIMENTATION :
         *
         * On vérifie si Chrome considère encore
         * l'ancien player RemotePlayback connecté.
         *
         * On ne change surtout PAS son src.
         */
        try {

            console.log(
                "[CAST-2.4.7] Existing remote state:",
                runtime.castVideo.remote.state
            );

        } catch (e) {}


        console.log(
            "[CAST-2.4.7] Next episode ready"
        );

        console.log(
            "[CAST-2.4.7] =================================="
        );
    }



    /*
     * ==========================================================
     * MEDIA EVENTS
     * ==========================================================
     */

    function mediaHandler(event) {

        const video =
            event.target;


        if (
            !video ||
            !video.tagName ||
            video.tagName.toLowerCase() !==
            "video"
        ) {

            return;
        }


        attachRemoteEvents(video);


        if (runtime.connected) {

            newEpisodeDetected(
                video,
                event.type
            );

        }
    }


    document.addEventListener(
        "play",
        mediaHandler,
        true
    );


    document.addEventListener(
        "playing",
        mediaHandler,
        true
    );


    document.addEventListener(
        "loadstart",
        mediaHandler,
        true
    );


    document.addEventListener(
        "loadedmetadata",
        mediaHandler,
        true
    );



    /*
     * ==========================================================
     * MUTATION OBSERVER
     * ==========================================================
     */

    const observer =
        new MutationObserver(
            function(mutations) {

                mutations.forEach(
                    function(mutation) {

                        if (
                            mutation.type ===
                            "childList"
                        ) {

                            mutation.addedNodes
                                .forEach(
                                    function(node) {

                                        if (!node) {
                                            return;
                                        }


                                        if (
                                            node.tagName &&
                                            node.tagName
                                                .toLowerCase() ===
                                            "video"
                                        ) {

                                            attachRemoteEvents(
                                                node
                                            );


                                            newEpisodeDetected(
                                                node,
                                                "new-video"
                                            );

                                        }


                                        if (
                                            node.querySelectorAll
                                        ) {

                                            const videos =
                                                node.querySelectorAll(
                                                    "video"
                                                );


                                            videos.forEach(
                                                function(video) {

                                                    attachRemoteEvents(
                                                        video
                                                    );


                                                    newEpisodeDetected(
                                                        video,
                                                        "new-player"
                                                    );

                                                }
                                            );

                                        }

                                    }
                                );

                        }


                        if (
                            mutation.type ===
                            "attributes"
                        ) {

                            const target =
                                mutation.target;


                            if (
                                target &&
                                target.tagName &&
                                target.tagName
                                    .toLowerCase() ===
                                "video"
                            ) {

                                newEpisodeDetected(
                                    target,
                                    "src-change"
                                );

                            }

                        }

                    }
                );

            }
        );


    observer.observe(
        document.documentElement,
        {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
                "src"
            ]
        }
    );



    /*
     * ==========================================================
     * POLLING DE SECOURS
     * ==========================================================
     */

    setInterval(
        function() {

            const videos =
                getVideos();


            videos.forEach(
                function(video) {

                    attachRemoteEvents(
                        video
                    );


                    if (
                        runtime.connected &&
                        video !==
                        runtime.castVideo
                    ) {

                        newEpisodeDetected(
                            video,
                            "poll"
                        );

                    }

                }
            );

        },
        500
    );



    /*
     * ==========================================================
     * UNIQUE EVENT LISTENER
     * ==========================================================
     */

    window.addEventListener(
        "seanime-cast-247",
        startCast
    );


    getVideos().forEach(
        function(video) {

            attachRemoteEvents(
                video
            );

        }
    );


})();
`;
        }



        async function injectRuntime() {

            try {

                console.log(
                    "[CAST-2.4.7] Plugin loaded"
                );


                const head =
                    await ctx.dom.queryOne(
                        "head"
                    );


                if (!head) {

                    console.error(
                        "[CAST-2.4.7] Head not found"
                    );

                    return;
                }


                const script =
                    await ctx.dom.createElement(
                        "script"
                    );


                script.setText(
                    getCastScript()
                );


                await head.append(
                    script
                );


                console.log(
                    "[CAST-2.4.7] Runtime injected"
                );

            } catch (error) {

                console.error(
                    "[CAST-2.4.7] Injection error:",
                    error
                );

            }
        }



        /*
         * Un seul dispatch par clic.
         */
        async function triggerCast() {

            try {

                const head =
                    await ctx.dom.queryOne(
                        "head"
                    );


                if (!head) {
                    return;
                }


                const script =
                    await ctx.dom.createElement(
                        "script"
                    );


                script.setText(
                    'window.dispatchEvent(new CustomEvent("seanime-cast-247"));'
                );


                await head.append(
                    script
                );

            } catch (error) {

                console.error(
                    "[CAST-2.4.7] Trigger error:",
                    error
                );

            }
        }



        /*
         * ==========================================================
         * TRAY
         * ==========================================================
         */

        const tray =
            ctx.newTray({

                tooltipText:
                    "Chromecast",

                iconUrl:
                    "https://raw.githubusercontent.com/Templarian/MaterialDesign/master/svg/cast.svg",

                withContent:
                    true

            });



        tray.render(
            () => {

                return tray.stack({

                    items: [

                        tray.text(
                            "📺 Chromecast"
                        ),

                        tray.button(
                            "📡 Caster",
                            {
                                onClick:
                                    "chromecast-247-start",

                                intent:
                                    "success"
                            }
                        )

                    ]

                });

            }
        );



        ctx.registerEventHandler(
            "chromecast-247-start",
            async () => {

                console.log(
                    "[CAST-2.4.7] Tray click"
                );


                await triggerCast();

            }
        );



        ctx.dom.onReady(
            async () => {

                await injectRuntime();

            }
        );

    });
}

init();
