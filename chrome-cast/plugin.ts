function init() {
    $ui.register((ctx) => {

        function getCastScript() {
            return `
(() => {

    const KEY = "__seanimeRemoteCastPersistent";

    if (window[KEY]) {
        console.log("[Chrome Cast] Runtime already loaded");
        return;
    }

    const runtime = window[KEY] = {
        castVideo: null,
        castSrc: "",
        switching: false
    };

    console.log("[Chrome Cast] Persistent Remote Playback runtime loaded");


    function getVideos() {
        return Array.from(
            document.querySelectorAll("video")
        );
    }


    function getSrc(video) {
        if (!video) return "";

        return (
            video.currentSrc ||
            video.src ||
            video.querySelector("source")?.src ||
            ""
        );
    }


    function findCurrentSeanimeVideo() {

        const videos = getVideos();

        if (!videos.length) {
            return null;
        }


        /*
         * Ne pas reprendre notre ancien
         * élément connecté si Seanime en a créé un nouveau.
         */
        const candidates =
            videos.filter(video =>
                video !== runtime.castVideo
            );


        const list =
            candidates.length
                ? candidates
                : videos;


        const playing =
            list.find(video =>
                !video.paused &&
                !video.ended &&
                getSrc(video)
            );


        if (playing) {
            return playing;
        }


        const visible =
            list
                .map(video => ({
                    video: video,
                    rect: video.getBoundingClientRect()
                }))
                .filter(item =>
                    item.rect.width > 100 &&
                    item.rect.height > 100 &&
                    getSrc(item.video)
                )
                .sort((a, b) =>
                    (b.rect.width * b.rect.height) -
                    (a.rect.width * a.rect.height)
                );


        if (visible.length) {
            return visible[0].video;
        }


        return list.find(video => getSrc(video)) || null;
    }



    function attachCastEvents(video) {

        if (
            !video ||
            !video.remote ||
            video.__seanimeCastEvents
        ) {
            return;
        }


        video.__seanimeCastEvents = true;


        video.remote.addEventListener(
            "connecting",
            function() {
                console.log("[Chrome Cast] Connecting");
            }
        );


        video.remote.addEventListener(
            "connect",
            function() {

                console.log("[Chrome Cast] Connected");

                runtime.castVideo = video;
                runtime.castSrc = getSrc(video);

                console.log(
                    "[Chrome Cast] Cast owner stored:",
                    runtime.castSrc
                );
            }
        );


        video.remote.addEventListener(
            "disconnect",
            function() {

                console.log("[Chrome Cast] Disconnected");

                if (runtime.castVideo === video) {
                    runtime.castVideo = null;
                    runtime.castSrc = "";
                }
            }
        );
    }



    async function startCast() {

        const video =
            findCurrentSeanimeVideo();

        if (!video) {
            console.error("[Chrome Cast] No video found");
            return;
        }


        const src =
            getSrc(video);


        console.log(
            "[Chrome Cast] Cast requested:",
            src
        );


        video.disableRemotePlayback = false;

        attachCastEvents(video);


        if (!video.remote) {
            console.error(
                "[Chrome Cast] Remote Playback unavailable"
            );
            return;
        }


        /*
         * Si CE video est déjà connecté,
         * inutile de rouvrir le picker.
         */
        if (
            video.remote.state === "connected"
        ) {

            runtime.castVideo = video;
            runtime.castSrc = src;

            console.log(
                "[Chrome Cast] Already connected"
            );

            return;
        }


        try {

            console.log(
                "[Chrome Cast] Opening device picker"
            );

            await video.remote.prompt();

        } catch (error) {

            console.error(
                "[Chrome Cast] Prompt error:",
                error
            );
        }
    }



    /*
     * Remplace le média de l'élément qui
     * possède déjà la connexion Remote Playback.
     */
    async function switchRemoteMedia(newVideo, newSrc) {

        if (runtime.switching) {
            return;
        }


        const castVideo =
            runtime.castVideo;


        if (
            !castVideo ||
            !castVideo.remote ||
            castVideo.remote.state !== "connected"
        ) {

            console.log(
                "[Chrome Cast] No connected cast owner"
            );

            return;
        }


        if (
            !newSrc ||
            newSrc === runtime.castSrc
        ) {
            return;
        }


        runtime.switching = true;


        console.log(
            "[Chrome Cast] NEW EPISODE"
        );

        console.log(
            "[Chrome Cast] Old:",
            runtime.castSrc
        );

        console.log(
            "[Chrome Cast] New:",
            newSrc
        );


        try {

            /*
             * Arrête le nouvel épisode local.
             */
            if (
                newVideo &&
                newVideo !== castVideo
            ) {
                try {
                    newVideo.pause();
                } catch (e) {}
            }


            /*
             * On conserve l'élément qui possède
             * la connexion Chromecast.
             */
            castVideo.disableRemotePlayback = false;


            /*
             * Remplacement de la source.
             */
            castVideo.src = newSrc;


            console.log(
                "[Chrome Cast] Source replaced on connected video"
            );


            castVideo.load();


            /*
             * La doc Remote Playback indique que,
             * connecté, les commandes média sont
             * exécutées sur le périphérique distant.
             */
            await castVideo.play();


            runtime.castSrc = newSrc;


            console.log(
                "[Chrome Cast] New episode sent to remote"
            );


        } catch (error) {

            console.error(
                "[Chrome Cast] Episode switch failed:",
                error
            );

        } finally {

            setTimeout(
                function() {
                    runtime.switching = false;
                },
                1000
            );
        }
    }



    /*
     * Détection changement épisode.
     */
    setInterval(
        function() {

            if (
                !runtime.castVideo ||
                !runtime.castVideo.remote ||
                runtime.castVideo.remote.state !== "connected"
            ) {
                return;
            }


            const currentVideo =
                findCurrentSeanimeVideo();


            if (!currentVideo) {
                return;
            }


            const src =
                getSrc(currentVideo);


            if (
                !src ||
                src === runtime.castSrc
            ) {
                return;
            }


            /*
             * Seanime a chargé une autre URL.
             */
            console.log(
                "[Chrome Cast] Different Seanime source detected"
            );


            /*
             * Petite attente :
             * évite d'envoyer une URL intermédiaire
             * pendant le chargement de l'épisode.
             */
            setTimeout(
                function() {

                    const video =
                        findCurrentSeanimeVideo();

                    const finalSrc =
                        getSrc(video);


                    if (
                        finalSrc &&
                        finalSrc !== runtime.castSrc
                    ) {

                        switchRemoteMedia(
                            video,
                            finalSrc
                        );
                    }

                },
                500
            );

        },
        750
    );



    /*
     * Surveille également si Seanime
     * remplace complètement le player.
     */
    const observer =
        new MutationObserver(
            function() {

                const videos =
                    getVideos();

                videos.forEach(
                    function(video) {
                        attachCastEvents(video);
                    }
                );

            }
        );


    observer.observe(
        document.documentElement,
        {
            childList: true,
            subtree: true
        }
    );



    window.addEventListener(
        "seanime-cast-start",
        function() {

            startCast();

        }
    );


    getVideos().forEach(
        function(video) {
            attachCastEvents(video);
        }
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
                "[Chrome Cast] Runtime injected"
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
                        "seanime-cast-start"
                    )
                );
            `);


            await head.append(script);
        }



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
