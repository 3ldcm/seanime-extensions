function init() {
    $ui.register((ctx) => {

        /*
         * ==========================================================
         * GOOGLE CAST RUNTIME
         * ==========================================================
         */

        function getCastRuntimeScript() {
            return `
(() => {

    /*
     * Nouvelle clé volontairement différente
     * pour éviter de reprendre un ancien runtime
     * resté chargé dans Seanime.
     */
    const KEY = "__seanimeGoogleCastV6_20260910";

    /*
     * Nettoyage anciennes versions.
     */
    try {
        delete window.__seanimeRemoteCastTray;
        delete window.__seanimeRemoteCastPersistent;
        delete window.__seanimeCastAutoEpisode;
        delete window.__seanimeCastFrameworkTest;
        delete window.__seanimeGoogleCastRuntime;
        delete window.__seanimeGoogleCastRuntimeV2;
    } catch (e) {}


    if (window[KEY]) {
        console.log("[CAST-V6] Runtime already loaded");
        return;
    }


    const runtime = window[KEY] = {

        ready: false,

        castContext: null,

        castSrc: "",

        loadingSrc: "",

        lastDetectedSrc: "",

        switchTimer: null,

        sessionId: "",

        connected: false

    };


    console.log("[CAST-V6] NOUVELLE VERSION CHARGEE");


    /*
     * ==========================================================
     * VIDEO
     * ==========================================================
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



    function getAllVideos() {

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
            getAllVideos();


        if (!videos.length) {
            return null;
        }


        /*
         * Priorité au lecteur qui joue actuellement.
         */
        const playing =
            videos.find(function(video) {

                return (
                    !video.paused &&
                    !video.ended &&
                    getVideoSrc(video)
                );

            });


        if (playing) {
            return playing;
        }


        /*
         * Sinon plus grand lecteur visible.
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


        return videos.find(function(video) {
            return !!getVideoSrc(video);
        }) || null;
    }



    /*
     * ==========================================================
     * CAST SESSION
     * ==========================================================
     */

    function getSession() {

        if (
            !runtime.ready ||
            !runtime.castContext
        ) {
            return null;
        }


        try {

            return runtime.castContext
                .getCurrentSession();

        } catch (e) {

            return null;
        }
    }



    function hasCastSession() {

        const session =
            getSession();


        if (!session) {

            runtime.connected = false;

            return false;
        }


        runtime.connected = true;

        return true;
    }



    /*
     * ==========================================================
     * BLOQUE LA LECTURE LOCALE
     * ==========================================================
     */

    function stopLocalPlayback(exceptSrc) {

        if (!hasCastSession()) {
            return;
        }


        const videos =
            getAllVideos();


        videos.forEach(function(video) {

            const src =
                getVideoSrc(video);


            /*
             * Même si c'est la même source que la TV,
             * on ne veut pas qu'elle joue localement.
             */
            try {

                if (!video.paused) {

                    console.log(
                        "[CAST-V6] Pause lecteur local:",
                        src
                    );

                    video.pause();
                }

            } catch (e) {}

        });
    }



    /*
     * ==========================================================
     * CHARGE UNE VIDEO SUR LE CHROMECAST
     * ==========================================================
     */

    async function loadMediaOnCast(
        src,
        startTime
    ) {

        if (!src) {
            return false;
        }


        const session =
            getSession();


        if (!session) {

            console.log(
                "[CAST-V6] Pas de session Cast active"
            );

            return false;
        }


        /*
         * Empêche plusieurs loadMedia simultanés.
         */
        if (
            runtime.loadingSrc === src
        ) {

            console.log(
                "[CAST-V6] Chargement déjà en cours"
            );

            return true;
        }


        /*
         * C'est déjà le média actuellement envoyé.
         */
        if (
            runtime.castSrc === src
        ) {

            stopLocalPlayback(src);

            return true;
        }


        runtime.loadingSrc = src;


        console.log(
            "[CAST-V6] =================================="
        );

        console.log(
            "[CAST-V6] ENVOI MEDIA SUR CAST"
        );

        console.log(
            "[CAST-V6] URL:",
            src
        );


        try {

            let contentType =
                "video/mp4";


            if (
                src.toLowerCase()
                    .indexOf(".m3u8") !== -1
            ) {

                contentType =
                    "application/x-mpegURL";
            }


            const mediaInfo =
                new chrome.cast.media.MediaInfo(
                    src,
                    contentType
                );


            /*
             * Stream classique.
             */
            mediaInfo.streamType =
                chrome.cast.media.StreamType.BUFFERED;


            const request =
                new chrome.cast.media.LoadRequest(
                    mediaInfo
                );


            request.autoplay = true;


            if (
                typeof startTime === "number" &&
                isFinite(startTime) &&
                startTime > 0
            ) {

                request.currentTime =
                    startTime;

            } else {

                request.currentTime = 0;
            }


            console.log(
                "[CAST-V6] loadMedia()"
            );


            await session.loadMedia(
                request
            );


            runtime.castSrc =
                src;


            runtime.lastDetectedSrc =
                src;


            runtime.loadingSrc =
                "";


            try {

                runtime.sessionId =
                    session.getSessionId() || "";

            } catch (e) {}


            console.log(
                "[CAST-V6] MEDIA CHARGE SUR TV"
            );


            console.log(
                "[CAST-V6] Session:",
                runtime.sessionId
            );


            stopLocalPlayback(src);


            return true;

        } catch (error) {

            runtime.loadingSrc = "";


            console.error(
                "[CAST-V6] ERREUR loadMedia:",
                error
            );


            return false;
        }
    }



    /*
     * ==========================================================
     * PREMIER CAST
     * ==========================================================
     */

    async function startCast() {

        console.log(
            "[CAST-V6] Demande de Cast"
        );


        if (
            !runtime.ready ||
            !runtime.castContext
        ) {

            console.error(
                "[CAST-V6] SDK pas prêt"
            );

            return;
        }


        const video =
            findBestVideo();


        if (!video) {

            console.error(
                "[CAST-V6] Aucun lecteur vidéo trouvé"
            );

            return;
        }


        const src =
            getVideoSrc(video);


        if (!src) {

            console.error(
                "[CAST-V6] Aucune URL vidéo trouvée"
            );

            return;
        }


        const currentTime =
            Number(video.currentTime) || 0;


        console.log(
            "[CAST-V6] Video actuelle:",
            src
        );


        let session =
            getSession();


        /*
         * Pas encore connecté :
         * ouvre le sélecteur Chromecast.
         */
        if (!session) {

            console.log(
                "[CAST-V6] Ouverture sélecteur Chromecast"
            );


            try {

                await runtime.castContext
                    .requestSession();

            } catch (error) {

                console.error(
                    "[CAST-V6] Sélection Cast annulée/erreur:",
                    error
                );

                return;
            }


            session =
                getSession();
        }


        if (!session) {

            console.error(
                "[CAST-V6] Session Cast introuvable"
            );

            return;
        }


        runtime.connected = true;


        try {

            runtime.sessionId =
                session.getSessionId() || "";

        } catch (e) {}


        console.log(
            "[CAST-V6] SESSION ACTIVE:",
            runtime.sessionId
        );


        /*
         * Envoie l'épisode.
         */
        await loadMediaOnCast(
            src,
            currentTime
        );


        stopLocalPlayback(src);
    }



    /*
     * ==========================================================
     * DETECTION NOUVEL EPISODE
     * ==========================================================
     */

    function scheduleNewMedia(
        video,
        reason
    ) {

        if (!hasCastSession()) {
            return;
        }


        if (!video) {
            return;
        }


        let src =
            getVideoSrc(video);


        if (!src) {
            return;
        }


        /*
         * Empêche le nouvel épisode de jouer localement.
         */
        try {

            if (!video.paused) {

                console.log(
                    "[CAST-V6] Lecture locale interceptée"
                );

                video.pause();
            }

        } catch (e) {}


        /*
         * Même vidéo que celle déjà sur la TV.
         */
        if (
            src === runtime.castSrc ||
            src === runtime.loadingSrc
        ) {
            return;
        }


        console.log(
            "[CAST-V6] Nouvelle source détectée"
        );

        console.log(
            "[CAST-V6] Raison:",
            reason
        );

        console.log(
            "[CAST-V6] Ancienne:",
            runtime.castSrc
        );

        console.log(
            "[CAST-V6] Nouvelle:",
            src
        );


        runtime.lastDetectedSrc =
            src;


        /*
         * Seanime peut changer plusieurs fois la source
         * pendant quelques centaines de ms.
         *
         * On attend un peu avant de réellement l'envoyer.
         */
        if (runtime.switchTimer) {

            clearTimeout(
                runtime.switchTimer
            );
        }


        runtime.switchTimer =
            setTimeout(
                async function() {

                    runtime.switchTimer =
                        null;


                    /*
                     * Relecture de la source après stabilisation.
                     */
                    const finalSrc =
                        getVideoSrc(video) ||
                        runtime.lastDetectedSrc;


                    if (
                        !finalSrc ||
                        finalSrc === runtime.castSrc
                    ) {

                        return;
                    }


                    console.log(
                        "[CAST-V6] >>> CHANGEMENT EPISODE <<<"
                    );


                    console.log(
                        "[CAST-V6] Nouvelle URL finale:",
                        finalSrc
                    );


                    /*
                     * Toujours stopper le local.
                     */
                    try {

                        video.pause();

                    } catch (e) {}


                    await loadMediaOnCast(
                        finalSrc,
                        0
                    );


                },
                700
            );
    }



    /*
     * Capture les événements vidéo même si Seanime
     * recrée complètement le <video>.
     */
    function mediaEventHandler(event) {

        if (!hasCastSession()) {
            return;
        }


        const video =
            event.target;


        if (
            !video ||
            !video.tagName ||
            video.tagName.toLowerCase() !== "video"
        ) {
            return;
        }


        scheduleNewMedia(
            video,
            event.type
        );
    }



    /*
     * PLAY est particulièrement important :
     *
     * Seanime lance le nouvel épisode localement.
     * On intercepte immédiatement ce play().
     */
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
     * ==========================================================
     * MUTATION OBSERVER
     * ==========================================================
     */

    const observer =
        new MutationObserver(
            function(mutations) {

                if (!hasCastSession()) {
                    return;
                }


                mutations.forEach(
                    function(mutation) {

                        /*
                         * src="" changé sur video/source.
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


                                if (tag === "video") {

                                    scheduleNewMedia(
                                        target,
                                        "mutation-video-src"
                                    );

                                }


                                if (
                                    tag === "source" &&
                                    target.parentElement &&
                                    target.parentElement.tagName &&
                                    target.parentElement.tagName
                                        .toLowerCase() === "video"
                                ) {

                                    scheduleNewMedia(
                                        target.parentElement,
                                        "mutation-source-src"
                                    );

                                }

                            }

                        }


                        /*
                         * Nouveau player inséré dans le DOM.
                         */
                        if (
                            mutation.type === "childList"
                        ) {

                            mutation.addedNodes
                                .forEach(
                                    function(node) {

                                        if (
                                            !node ||
                                            !node.querySelectorAll
                                        ) {
                                            return;
                                        }


                                        if (
                                            node.tagName &&
                                            node.tagName
                                                .toLowerCase() === "video"
                                        ) {

                                            scheduleNewMedia(
                                                node,
                                                "new-video"
                                            );

                                        }


                                        const videos =
                                            node.querySelectorAll(
                                                "video"
                                            );


                                        videos.forEach(
                                            function(video) {

                                                scheduleNewMedia(
                                                    video,
                                                    "new-player"
                                                );

                                            }
                                        );

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
     * ==========================================================
     * POLLING DE SECOURS
     * ==========================================================
     *
     * Certains players changent currentSrc sans mutation DOM
     * exploitable. On vérifie aussi régulièrement.
     */

    setInterval(
        function() {

            if (!hasCastSession()) {
                return;
            }


            const videos =
                getAllVideos();


            videos.forEach(
                function(video) {

                    const src =
                        getVideoSrc(video);


                    if (
                        src &&
                        src !== runtime.castSrc &&
                        src !== runtime.loadingSrc
                    ) {

                        scheduleNewMedia(
                            video,
                            "poll"
                        );

                    }


                    /*
                     * Interdit la double lecture locale
                     * pendant le Cast.
                     */
                    try {

                        if (!video.paused) {

                            video.pause();

                        }

                    } catch (e) {}

                }
            );

        },
        500
    );



    /*
     * ==========================================================
     * INITIALISATION GOOGLE CAST
     * ==========================================================
     */

    function initializeCast() {

        try {

            if (
                typeof cast === "undefined" ||
                !cast.framework ||
                typeof chrome === "undefined" ||
                !chrome.cast
            ) {

                console.log(
                    "[CAST-V6] SDK présent mais framework pas encore prêt"
                );

                return false;
            }


            const castContext =
                cast.framework
                    .CastContext
                    .getInstance();


            castContext.setOptions({

                receiverApplicationId:
                    chrome.cast.media
                        .DEFAULT_MEDIA_RECEIVER_APP_ID,

                autoJoinPolicy:
                    chrome.cast
                        .AutoJoinPolicy
                        .ORIGIN_SCOPED

            });


            runtime.castContext =
                castContext;


            runtime.ready =
                true;


            console.log(
                "[CAST-V6] GOOGLE CAST READY"
            );


            /*
             * Suivi de la session.
             */
            castContext.addEventListener(

                cast.framework
                    .CastContextEventType
                    .SESSION_STATE_CHANGED,

                function(event) {

                    console.log(
                        "[CAST-V6] SESSION STATE:",
                        event.sessionState
                    );


                    if (
                        event.sessionState ===
                        cast.framework
                            .SessionState
                            .SESSION_STARTED ||

                        event.sessionState ===
                        cast.framework
                            .SessionState
                            .SESSION_RESUMED
                    ) {

                        runtime.connected =
                            true;


                        const session =
                            getSession();


                        if (session) {

                            try {

                                runtime.sessionId =
                                    session.getSessionId() || "";

                            } catch (e) {}

                        }


                        console.log(
                            "[CAST-V6] Chromecast connecté"
                        );

                    }


                    if (
                        event.sessionState ===
                        cast.framework
                            .SessionState
                            .SESSION_ENDED
                    ) {

                        console.log(
                            "[CAST-V6] Chromecast déconnecté"
                        );


                        runtime.connected =
                            false;


                        runtime.castSrc =
                            "";


                        runtime.loadingSrc =
                            "";


                        runtime.sessionId =
                            "";
                    }

                }
            );


            /*
             * Session éventuellement déjà existante.
             */
            const existing =
                castContext.getCurrentSession();


            if (existing) {

                runtime.connected =
                    true;


                try {

                    runtime.sessionId =
                        existing.getSessionId() || "";

                } catch (e) {}


                console.log(
                    "[CAST-V6] Session existante récupérée:",
                    runtime.sessionId
                );

            }


            return true;

        } catch (error) {

            console.error(
                "[CAST-V6] Erreur initialisation:",
                error
            );


            return false;
        }
    }



    /*
     * Le callback doit être défini AVANT
     * le chargement de cast_sender.js.
     */
    window.__onGCastApiAvailable =
        function(isAvailable) {

            console.log(
                "[CAST-V6] __onGCastApiAvailable:",
                isAvailable
            );


            if (isAvailable) {

                initializeCast();

            }

        };



    function loadGoogleCastSdk() {

        /*
         * Framework déjà disponible.
         */
        if (
            typeof cast !== "undefined" &&
            cast.framework
        ) {

            console.log(
                "[CAST-V6] SDK déjà présent"
            );


            initializeCast();


            return;
        }


        let script =
            document.querySelector(
                'script[src*="cast_sender.js"]'
            );


        if (script) {

            console.log(
                "[CAST-V6] Script Cast déjà présent"
            );


            /*
             * Attend que le framework soit disponible.
             */
            let tries = 0;


            const timer =
                setInterval(
                    function() {

                        tries++;


                        if (
                            initializeCast() ||
                            tries >= 40
                        ) {

                            clearInterval(
                                timer
                            );

                        }

                    },
                    250
                );


            return;
        }


        console.log(
            "[CAST-V6] Chargement SDK Google Cast"
        );


        script =
            document.createElement(
                "script"
            );


        script.src =
            "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";


        script.async =
            true;


        script.onload =
            function() {

                    console.log(
                        "[CAST-V6] SDK SCRIPT LOADED"
                    );


                    /*
                     * Le callback Google devrait normalement
                     * s'occuper de l'initialisation.
                     *
                     * Polling de secours.
                     */
                    let tries = 0;


                    const timer =
                        setInterval(
                            function() {

                                tries++;


                                if (
                                    initializeCast() ||
                                    tries >= 40
                                ) {

                                    clearInterval(
                                        timer
                                    );

                                }

                            },
                            250
                        );

                };


        script.onerror =
            function(error) {

                console.error(
                    "[CAST-V6] Erreur chargement SDK:",
                    error
                );

            };


        document.head.appendChild(
            script
        );
    }



    /*
     * ==========================================================
     * EVENEMENT VENANT DU TRAY SEANIME
     * ==========================================================
     */

    window.addEventListener(
        "seanime-google-cast-v6",
        function() {

            startCast();

        }
    );



    /*
     * ==========================================================
     * START
     * ==========================================================
     */

    loadGoogleCastSdk();


})();
`;
        }



        /*
         * ==========================================================
         * INJECTION
         * ==========================================================
         */

        async function injectRuntime() {

            try {

                console.log(
                    "[CAST-V6] Injection runtime"
                );


                const head =
                    await ctx.dom.queryOne(
                        "head"
                    );


                if (!head) {

                    console.error(
                        "[CAST-V6] head introuvable"
                    );

                    return;
                }


                const script =
                    await ctx.dom.createElement(
                        "script"
                    );


                script.setText(
                    getCastRuntimeScript()
                );


                await head.append(
                    script
                );


                console.log(
                    "[CAST-V6] Runtime injecté"
                );

            } catch (error) {

                console.error(
                    "[CAST-V6] Erreur injection:",
                    error
                );

            }
        }



        /*
         * ==========================================================
         * TRIGGER CAST
         * ==========================================================
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
                            "seanime-google-cast-v6"
                        )
                    );
                `);


                await head.append(
                    script
                );

            } catch (error) {

                console.error(
                    "[CAST-V6] Erreur trigger:",
                    error
                );

            }
        }



        /*
         * ==========================================================
         * TRAY SEANIME
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

                        tray.text(
                            "Caster la vidéo actuelle"
                        ),

                        tray.button(
                            "📡 Caster",
                            {
                                onClick:
                                    "chromecast-v6-start",

                                intent:
                                    "success"
                            }
                        )

                    ]

                });

            }
        );



        ctx.registerEventHandler(
            "chromecast-v6-start",
            async () => {

                console.log(
                    "[CAST-V6] Bouton Cast"
                );


                await triggerCast();

            }
        );



        ctx.dom.onReady(
            async () => {

                console.log(
                    "[CAST-V6] Plugin Seanime chargé"
                );


                await injectRuntime();

            }
        );

    });
}

init();
