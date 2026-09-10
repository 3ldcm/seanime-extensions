function init() {
    $ui.register((ctx) => {

        function getCastScript() {
            return `
(() => {

    const RUNTIME_KEY = "__seanimeChromecastTrayRuntime";

    if (window[RUNTIME_KEY]) {
        console.log("[Chrome Cast] Runtime already loaded");
        return;
    }

    window[RUNTIME_KEY] = true;

    console.log("[Chrome Cast] Remote Playback runtime loaded");


    function findVideo() {

        const videos = Array.from(
            document.querySelectorAll("video")
        );

        if (!videos.length) {
            return null;
        }


        // Priorité à la vidéo actuellement en lecture
        const playing = videos.find(video =>
            !video.paused &&
            !video.ended &&
            video.readyState > 1
        );

        if (playing) {
            return playing;
        }


        // Sinon la plus grande vidéo visible
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



    async function castCurrentVideo() {

        console.log("[Chrome Cast] Tray Cast requested");

        const video = findVideo();

        if (!video) {
            console.error("[Chrome Cast] No video found");
            return;
        }


        console.log(
            "[Chrome Cast] Video src:",
            video.currentSrc || video.src
        );


        try {

            video.disableRemotePlayback = false;

        } catch (e) {
            console.log(
                "[Chrome Cast] Cannot change disableRemotePlayback"
            );
        }


        if (!video.remote) {

            console.error(
                "[Chrome Cast] Remote Playback API unavailable"
            );

            return;
        }


        console.log(
            "[Chrome Cast] Remote state:",
            video.remote.state
        );


        /*
         * Si déjà connecté, ne surtout pas
         * réouvrir le sélecteur.
         */
        if (
            video.remote.state === "connected" ||
            video.remote.state === "connecting"
        ) {

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


            console.log(
                "[Chrome Cast] Prompt completed"
            );


        } catch (error) {

            console.error(
                "[Chrome Cast] Remote prompt error:",
                error
            );

        }

    }



    /*
     * Événement envoyé par le plugin Seanime
     */
    window.addEventListener(
        "seanime-cast-from-tray",
        function() {

            console.log(
                "[Chrome Cast] Tray browser event received"
            );

            castCurrentVideo();

        }
    );



    /*
     * Écoute les changements d'état
     */
    function attachRemoteEvents() {

        const video = findVideo();

        if (!video || !video.remote) {
            return;
        }


        if (video.__seanimeCastEvents) {
            return;
        }

        video.__seanimeCastEvents = true;


        video.remote.addEventListener(
            "connecting",
            function() {

                console.log(
                    "[Chrome Cast] Connecting"
                );

            }
        );


        video.remote.addEventListener(
            "connect",
            function() {

                console.log(
                    "[Chrome Cast] Connected"
                );

            }
        );


        video.remote.addEventListener(
            "disconnect",
            function() {

                console.log(
                    "[Chrome Cast] Disconnected"
                );

            }
        );

    }



    /*
     * Seanime peut remplacer complètement
     * l'élément <video>.
     */
    const observer = new MutationObserver(
        function() {

            attachRemoteEvents();

        }
    );


    observer.observe(
        document.documentElement,
        {
            childList: true,
            subtree: true
        }
    );


    setInterval(
        attachRemoteEvents,
        1500
    );


    attachRemoteEvents();

})();
`;
        }



        async function injectRuntime() {

            try {

                const head =
                    await ctx.dom.queryOne("head");

                if (!head) {
                    console.error(
                        "[Chrome Cast] head not found"
                    );
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

            try {

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
                            "seanime-cast-from-tray"
                        )
                    );
                `);


                await head.append(script);


            } catch (error) {

                console.error(
                    "[Chrome Cast] Trigger error:",
                    error
                );

            }

        }



        /*
         * ICÔNE DU TRAY
         *
         * On utilise une vraie icône Cast externe.
         */
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
                        "Caster la vidéo actuellement ouverte"
                    ),

                    tray.button(
                        "📺 Caster la vidéo",
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
