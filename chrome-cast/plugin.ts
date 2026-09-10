function init() {
    $ui.register((ctx) => {

        const CAST_RUNTIME_KEY = "__seanimeCastTrayRuntime";

        function getCastRuntimeScript() {
            return `
(() => {
  if (window.${CAST_RUNTIME_KEY}) {
    console.log("[Chrome Cast] Runtime already loaded");
    return;
  }

  window.${CAST_RUNTIME_KEY} = {
    ready: false,
    context: null
  };

  console.log("[Chrome Cast] Starting Cast runtime");

  // Appelé par le SDK Google quand il est prêt
  window.__onGCastApiAvailable = function(isAvailable) {
    console.log("[Chrome Cast] API available:", isAvailable);

    if (!isAvailable) {
      console.error("[Chrome Cast] Google Cast API unavailable");
      return;
    }

    try {
      const castContext = cast.framework.CastContext.getInstance();

      castContext.setOptions({
        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
      });

      window.${CAST_RUNTIME_KEY}.context = castContext;
      window.${CAST_RUNTIME_KEY}.ready = true;

      console.log("[Chrome Cast] Cast context ready");

      castContext.addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        function(event) {
          console.log(
            "[Chrome Cast] Session state:",
            event.sessionState
          );

          if (
            event.sessionState ===
            cast.framework.SessionState.SESSION_STARTED ||
            event.sessionState ===
            cast.framework.SessionState.SESSION_RESUMED
          ) {
            console.log("[Chrome Cast] Connected");

            setTimeout(() => {
              window.__seanimeLoadCurrentVideoOnCast();
            }, 300);
          }

          if (
            event.sessionState ===
            cast.framework.SessionState.SESSION_ENDED
          ) {
            console.log("[Chrome Cast] Disconnected");
          }
        }
      );

    } catch (err) {
      console.error("[Chrome Cast] Initialization error:", err);
    }
  };


  // Cherche la vidéo actuellement utilisée par Seanime
  window.__seanimeFindCurrentVideo = function() {
    const videos = Array.from(document.querySelectorAll("video"));

    if (!videos.length) {
      return null;
    }

    // Priorité à la vidéo en lecture
    const playing = videos.find(v =>
      !v.paused &&
      !v.ended &&
      v.readyState > 2
    );

    if (playing) {
      return playing;
    }

    // Sinon prendre la plus grande vidéo visible
    const visible = videos
      .map(v => ({
        video: v,
        rect: v.getBoundingClientRect()
      }))
      .filter(item =>
        item.rect.width > 100 &&
        item.rect.height > 100
      )
      .sort(
        (a, b) =>
          (b.rect.width * b.rect.height) -
          (a.rect.width * a.rect.height)
      );

    if (visible.length) {
      return visible[0].video;
    }

    return videos[0];
  };


  // Charge la vidéo Seanime dans Chromecast
  window.__seanimeLoadCurrentVideoOnCast = async function() {

    try {

      const runtime = window.${CAST_RUNTIME_KEY};

      if (!runtime.context) {
        console.error("[Chrome Cast] No Cast context");
        return;
      }

      const session = runtime.context.getCurrentSession();

      if (!session) {
        console.log("[Chrome Cast] No active session");
        return;
      }

      const video = window.__seanimeFindCurrentVideo();

      if (!video) {
        console.error("[Chrome Cast] No video found");
        return;
      }

      const src =
        video.currentSrc ||
        video.src ||
        video.querySelector("source")?.src;

      if (!src) {
        console.error("[Chrome Cast] Video has no source");
        return;
      }

      console.log("[Chrome Cast] Video src:", src);

      const mediaInfo =
        new chrome.cast.media.MediaInfo(
          src,
          video.currentSrc && video.currentSrc.includes(".m3u8")
          ? "application/x-mpegURL"
          : "video/mp4"
        );

      const request =
        new chrome.cast.media.LoadRequest(mediaInfo);

      if (
        Number.isFinite(video.currentTime) &&
        video.currentTime > 0
      ) {
        request.currentTime = video.currentTime;
      }

      request.autoplay = true;

      console.log("[Chrome Cast] Loading media on Chromecast");

      await session.loadMedia(request);

      console.log("[Chrome Cast] Media loaded successfully");

      try {
        video.pause();
      } catch (e) {}

    } catch (err) {
      console.error("[Chrome Cast] loadMedia error:", err);
    }
  };


  // Événement reçu depuis le bouton Tray Seanime
  window.addEventListener(
    "seanime-chromecast-toggle",
    async function() {

      console.log("[Chrome Cast] Tray button clicked");

      try {

        const runtime = window.${CAST_RUNTIME_KEY};

        if (!runtime.ready || !runtime.context) {
          console.log("[Chrome Cast] Cast SDK not ready yet");
          return;
        }

        const session =
          runtime.context.getCurrentSession();

        if (session) {
          console.log(
            "[Chrome Cast] Session already active - loading current video"
          );

          await window.__seanimeLoadCurrentVideoOnCast();
          return;
        }

        console.log("[Chrome Cast] Opening device picker");

        await runtime.context.requestSession();

      } catch (err) {
        console.error(
          "[Chrome Cast] Cast request error:",
          err
        );
      }

    }
  );


  // Charge le SDK Google Cast
  if (!document.querySelector(
    'script[data-seanime-google-cast]'
  )) {

    console.log("[Chrome Cast] Loading Google Cast SDK");

    const script =
      document.createElement("script");

    script.src =
      "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

    script.async = true;

    script.setAttribute(
      "data-seanime-google-cast",
      "true"
    );

    script.onerror = function() {
      console.error(
        "[Chrome Cast] Failed to load Google Cast SDK"
      );
    };

    document.head.appendChild(script);
  }

})();
`;
        }


        async function injectCastRuntime() {
            try {
                const head = await ctx.dom.queryOne("head");

                if (!head) {
                    console.error("[Chrome Cast] Head not found");
                    return;
                }

                const script =
                    await ctx.dom.createElement("script");

                script.setText(
                    getCastRuntimeScript()
                );

                await head.append(script);

                console.log(
                    "[Chrome Cast] Runtime injected"
                );

            } catch (error) {
                console.error(
                    "[Chrome Cast] Runtime injection failed:",
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
      "seanime-chromecast-toggle"
    )
  );
`);

                await head.append(script);

            } catch (error) {
                console.error(
                    "[Chrome Cast] Trigger failed:",
                    error
                );
            }
        }


        /*
         * ICÔNE SIDEBAR / TRAY
         *
         * SVG Chromecast directement inclus.
         */
        const castIcon =
            "data:image/svg+xml;charset=utf-8," +
            encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
                '<path fill="white" d="M1 18v3h3a3 3 0 0 0-3-3zm0-4v2a5 5 0 0 1 5 5h2a7 7 0 0 0-7-7zm0-4v2c5 0 9 4 9 9h2c0-6.1-4.9-11-11-11zm3-7a2 2 0 0 0-2 2v3h2V5h16v12h-6v2h6a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H4z"/>' +
                '</svg>'
            );


        const tray = ctx.newTray({
            tooltipText: "Chromecast",
            iconUrl: castIcon,
            withContent: true,
        });


        tray.render(() => {

            return tray.stack({
                items: [

                    tray.text("📺 Chromecast"),

                    tray.text(
                        "Caster la vidéo actuellement ouverte dans Seanime"
                    ),

                    tray.button(
                        "Caster la vidéo",
                        {
                            onClick: "chromecast-start",
                            intent: "success"
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


        /*
         * Injection au chargement de Seanime
         */
        ctx.dom.onReady(async () => {
            console.log(
                "[Chrome Cast] Plugin loaded"
            );

            await injectCastRuntime();
        });

    });
}

init();
