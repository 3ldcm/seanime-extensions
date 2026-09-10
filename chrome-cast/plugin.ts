function init() {
    $ui.register((ctx) => {

        function getCastScript() {
            return `
(() => {

    const KEY = "__seanimeChromecast_2_4_6";

    if (window[KEY]) {
        console.log("[CAST-2.4.6] Runtime already loaded");
        return;
    }

    const runtime = window[KEY] = {
        castVideo: null,
        castSrc: "",
        casting: false,
        connected: false,
        lastSeenSrc: "",
        lastNewEpisodeSrc: ""
    };

    console.log("[CAST-2.4.6] Runtime loaded");


    /*
     * ----------------------------------------------------------
     * VIDEO HELPERS
     * ----------------------------------------------------------
     */

    function getVideoSrc(video) {
        if (!video) {
            return "";
        }

        try {
            if (
                video.currentSrc &&
                video.currentSrc.length > 5
            ) {
                return video.currentSrc;
            }
        } catch (e) {}

        try {
            if (
                video.src &&
                video.src.length > 5
            ) {
                return video.src;
            }
        } catch (e) {}

        try {
            const source =
                video.querySelector("source");

            if (
                source &&
                source.src &&
                source.src.length > 5
            ) {
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

        const videos = getVideos();

        if (!videos.length) {
            return null;
        }


        /*
         * Priorité au player actuellement en lecture.
         */
        const playing = videos.find(function(video) {

            const src = getVideoSrc(video);

            return (
                src &&
                !video.paused &&
                !video.ended
            );

        });

        if (playing) {
            return playing;
        }


        /*
         * Ensuite plus grand player visible.
         */
        const visible = videos
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
                    getVideoSrc(item.video)
                );

            })
            .sort(function(a, b) {

                return (
                    (b.rect.width * b.rect.height) -
                    (a.rect.width * a.rect.height)
                );

            });


        if (visible.length) {
            return visible[0].video;
        }


        /*
         * Dernier recours.
         */
        return videos.find(function(video) {
            return !!getVideoSrc(video);
        }) || null;
    }



    /*
     * ----------------------------------------------------------
     * REMOTE PLAYBACK EVENTS
     * ----------------------------------------------------------
     */

    function attachRemoteEvents(video) {

        if (
            !video ||
            !video.remote ||
            video.__seanimeCast246Events
        ) {
            return;
        }

        video.__seanimeCast246Events = true;

        console.log(
            "[CAST-2.4.6] Remote events attached:",
            getVideoSrc(video)
        );


        video.remote.addEventListener(
            "connecting",
            function() {

                console.log(
                    "[CAST-2.4.6] Connecting"
                );

                runtime.casting = true;
            }
        );


        video.remote.addEventListener(
            "connect",
            function() {

                runtime.castVideo = video;
                runtime.castSrc = getVideoSrc(video);
                runtime.lastSeenSrc = runtime.castSrc;
                runtime.connected = true;
                runtime.casting = false;

                console.log(
                    "[CAST-2.4.6] Connected"
                );

                console.log(
                    "[CAST-2.4.6] Cast video stored:",
                    runtime.castSrc
                );
            }
        );


        video.remote.addEventListener(
            "disconnect",
            function() {

                console.log(
                    "[CAST-2.4.6] Disconnected"
                );

                if (runtime.castVideo === video) {

                    runtime.castVideo = null;
                    runtime.castSrc = "";
                    runtime.connected = false;
                    runtime.casting = false;

                }
            }
        );
    }



    /*
     * ----------------------------------------------------------
     * PREMIER CAST
     * ----------------------------------------------------------
     */

    async function startCast() {

        console.log(
            "[CAST-2.4.6] Cast requested"
        );


        const video = findBestVideo();

        if (!video) {

            console.error(
                "[CAST-2.4.6] No video found"
            );

            return;
        }


        const src = getVideoSrc(video);


        console.log(
            "[CAST-2.4.6] Video src:",
            src
        );


        try {

            video.disableRemotePlayback = false;

        } catch (e) {}


        if (!video.remote) {

            console.error(
                "[CAST-2.4.6] Remote Playback unavailable"
            );

            return;
        }


        attachRemoteEvents(video);


        /*
         * Déjà connecté.
         */
        if (
            video.remote.state === "connected"
        ) {

            runtime.castVideo = video;
            runtime.castSrc = src;
            runtime.connected = true;

            console.log(
                "[CAST-2.4.6] Already connected"
            );

            return;
        }


        /*
         * Connexion déjà en cours.
         */
        if (
            video.remote.state === "connecting"
        ) {

            console.log(
                "[CAST-2.4.6] Already connecting"
            );

            return;
        }


        try {

            runtime.casting = true;

            console.log(
                "[CAST-2.4.6] Opening device picker"
            );

            await video.remote.prompt();

            console.log(
                "[CAST-2.4.6] Remote prompt completed"
            );

        } catch (error) {

            runtime.casting = false;

            console.error(
                "[CAST-2.4.6] Remote prompt error:",
                error
            );
        }
    }



    /*
     * ----------------------------------------------------------
     * PROTECTION DOUBLE LECTURE
     * ----------------------------------------------------------
     */

    function stopNewLocalPlayback(video, src) {

        if (!runtime.connected) {
            return;
        }


        /*
         * Ne jamais toucher au video qui possède
         * actuellement la connexion Remote Playback.
         */
        if (
            runtime.castVideo &&
            video === runtime.castVideo
        ) {
            return;
        }


        try {

            if (!video.paused) {

                console.log(
                    "[CAST-2.4.6] Pause new local player:",
                    src
                );

                video.pause();

            }

        } catch (e) {}
    }



    /*
     * ----------------------------------------------------------
     * DETECTION CHANGEMENT EPISODE
     * ----------------------------------------------------------
     */

    function inspectVideo(video, reason) {

        if (!video) {
            return;
        }


        const src = getVideoSrc(video);

        if (!src) {
            return;
        }


        /*
         * Avant Cast : juste mémoriser.
         */
        if (!runtime.connected) {

            runtime.lastSeenSrc = src;

            attachRemoteEvents(video);

            return;
        }


        /*
         * Player actuellement casté.
         */
        if (
            runtime.castVideo &&
            video === runtime.castVideo
        ) {

            return;
        }


        /*
         * Même URL que celle actuellement castée.
         */
        if (
            src === runtime.castSrc
        ) {

            stopNewLocalPlayback(
                video,
                src
            );

            return;
        }


        /*
         * Nouvelle URL détectée.
         */
        if (
            src !== runtime.lastNewEpisodeSrc
        ) {

            runtime.lastNewEpisodeSrc = src;


            console.log(
                "[CAST-2.4.6] =================================="
            );

            console.log(
                "[CAST-2.4.6] NEW EPISODE DETECTED"
            );

            console.log(
                "[CAST-2.4.6] Reason:",
                reason
            );

            console.log(
                "[CAST-2.4.6] Current cast:",
                runtime.castSrc
            );

            console.log(
                "[CAST-2.4.6] New source:",
                src
            );

            console.log(
                "[CAST-2.4.6] =================================="
            );
        }


        /*
         * Empêche le nouvel épisode de partir
         * simultanément sur le lecteur interne.
         */
        stopNewLocalPlayback(
            video,
            src
        );
    }



    /*
     * ----------------------------------------------------------
     * EVENEMENTS MEDIA
     * ----------------------------------------------------------
     */

    function mediaEventHandler(event) {

        const video = event.target;

        if (
            !video ||
            !video.tagName ||
            video.tagName.toLowerCase() !== "video"
        ) {
            return;
        }


        inspectVideo(
            video,
            event.type
        );
    }


    document.addEventListener(
        "play",
        mediaEventHandler,
        true
    );


    document.addEventListener(
        "playing",
        mediaEventHandler,
        true
    );


    document.addEventListener(
        "loadstart",
        mediaEventHandler,
        true
    );


    document.addEventListener(
        "loadedmetadata",
        mediaEventHandler,
        true
    );


    document.addEventListener(
        "canplay",
        mediaEventHandler,
        true
    );



    /*
     * ----------------------------------------------------------
     * MUTATION OBSERVER
     * ----------------------------------------------------------
     */

    const observer = new MutationObserver(
        function(mutations) {

            mutations.forEach(
                function(mutation) {

                    /*
                     * src changé.
                     */
                    if (
                        mutation.type === "attributes"
                    ) {

                        const target =
                            mutation.target;


                        if (
                            target &&
                            target.tagName
                        ) {

                            const tag =
                                target.tagName
                                    .toLowerCase();


                            if (
                                tag === "video"
                            ) {

                                inspectVideo(
                                    target,
                                    "video-src-change"
                                );

                            }


                            if (
                                tag === "source" &&
                                target.parentElement &&
                                target.parentElement.tagName &&
                                target.parentElement.tagName
                                    .toLowerCase() === "video"
                            ) {

                                inspectVideo(
                                    target.parentElement,
                                    "source-src-change"
                                );

                            }

                        }

                    }


                    /*
                     * Nouveau player ajouté.
                     */
                    if (
                        mutation.type === "childList"
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
                                            .toLowerCase() === "video"
                                    ) {

                                        attachRemoteEvents(
                                            node
                                        );

                                        inspectVideo(
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

                                                inspectVideo(
                                                    video,
                                                    "new-player"
                                                );

                                            }
                                        );

                                    }

                                }
                            );

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
     * ----------------------------------------------------------
     * POLLING
     * ----------------------------------------------------------
     *
     * Sécurité pour les players qui changent currentSrc
     * sans mutation DOM exploitable.
     */

    setInterval(
        function() {

            const videos = getVideos();


            videos.forEach(
                function(video) {

                    attachRemoteEvents(
                        video
                    );


                    inspectVideo(
                        video,
                        "poll"
                    );

                }
            );

        },
        500
    );



    /*
     * ----------------------------------------------------------
     * EVENEMENT TRAY
     * ----------------------------------------------------------
     */

    window.addEventListener(
        "seanime-cast-2-4-6",
        function() {

            startCast();

        }
    );


    /*
     * Initialisation des vidéos déjà présentes.
     */
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



        /*
         * ----------------------------------------------------------
         * INJECTION
         * ----------------------------------------------------------
         */

        async function injectRuntime() {

            try {

                console.log(
                    "[CAST-2.4.6] Plugin loaded"
                );


                const head =
                    await ctx.dom.queryOne(
                        "head"
                    );


                if (!head) {

                    console.error(
                        "[CAST-2.4.6] Head not found"
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
                    "[CAST-2.4.6] Runtime injected"
                );

            } catch (error) {

                console.error(
                    "[CAST-2.4.6] Runtime injection error:",
                    error
                );

            }
        }



        /*
         * ----------------------------------------------------------
         * DECLENCHEMENT CAST
         * ----------------------------------------------------------
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


                script.setText(`
                            window.dispatchEvent(
                                new CustomEvent(
                                    "seanime-cast-2-4-6"
                                )
                            );
                        `);


                await head.append(
                    script
                );

            } catch (error) {

                console.error(
                    "[CAST-2.4.6] Trigger error:",
                    error
                );

            }
        }



        /*
         * ----------------------------------------------------------
         * TRAY
         * ----------------------------------------------------------
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
                                    "chromecast-2-4-6",

                                intent:
                                    "success"
                            }
                        )

                    ]

                });

            }
        );



        ctx.registerEventHandler(
            "chromecast-2-4-6",
            async () => {

                console.log(
                    "[CAST-2.4.6] Tray button clicked"
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
