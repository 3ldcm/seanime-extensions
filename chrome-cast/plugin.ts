function init() {
    $ui.register((ctx) => {

        function enableChromeCast(video: any) {
            try {
                // Active Remote Playback / Cast
                video.setProperty("disableRemotePlayback", false)
                video.setProperty("controls", true)
                video.setProperty("playsInline", true)
                video.setDataAttribute("chrome-cast-test", "enabled")

                console.log("[Chrome Cast] Vidéo détectée, controls activés")
            } catch (e) {
                console.error("[Chrome Cast] Erreur activation:", e)
            }
        }

        function hideSeanimeControls() {
            try {
                // Chercher les contrôles Seanime via ctx.dom
                const controls = ctx.dom.queryOneSync("[data-vc-element]")
                if (controls) {
                    const node = controls.getNode ? controls.getNode() : null
                    if (node && node.attributes) {
                        const vcEl = node.attributes["data-vc-element"] || ""
                        // Ne pas masquer la vidéo
                        if (vcEl !== "video") {
                            controls.setProperty("style", "display: none !important")
                            console.log("[Chrome Cast] Contrôles Seanime masqués")
                        }
                    }
                }
            } catch (e) {
                console.error("[Chrome Cast] Erreur masquage:", e)
            }
        }

        ctx.dom.onReady(async () => {
            const video = await ctx.dom.queryOne("[data-vc-element='video']")

            if (video) {
                enableChromeCast(video)
                hideSeanimeControls()
                ctx.toast.success("Chrome Cast activé")
            } else {
                console.log("[Chrome Cast] Aucune vidéo trouvée")
            }
        })

        // Observer changements vidéo
        ctx.dom.observe("[data-vc-element='video']", (videos) => {
            for (const video of videos) {
                enableChromeCast(video)
                hideSeanimeControls()
            }
        })

        // Observer changements contrôles
        ctx.dom.observe("[data-vc-element]", (elements) => {
            for (const el of elements) {
                try {
                    const node = el.getNode ? el.getNode() : null
                    if (node && node.attributes) {
                        const vcEl = node.attributes["data-vc-element"] || ""
                        if (vcEl !== "video") {
                            el.setProperty("style", "display: none !important")
                        }
                    }
                } catch (e) {}
            }
        })
    })
}

init()
