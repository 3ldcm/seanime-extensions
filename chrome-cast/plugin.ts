function init() {
    $ui.register((ctx) => {
        function enableChromeCast(video: any) {
            try {
                video.setProperty("disableRemotePlayback", false)
                video.setProperty("controls", true)
                video.setProperty("playsInline", true)
                video.setDataAttribute("chrome-cast-test", "enabled")
            } catch (e) {
                console.error("[Chrome Cast Test] erreur:", e)
            }
        }

        ctx.dom.onReady(async () => {
            const video = await ctx.dom.queryOne('[data-vc-element="video"]')
            if (video) {
                enableChromeCast(video)
                ctx.toast.success("Chrome Cast : contrôles natifs activés")
            }
        })

        ctx.dom.observe('[data-vc-element="video"]', (videos) => {
            for (const video of videos) {
                enableChromeCast(video)
            }
        })
    })
}

init()
