function init() {
    $ui.register((ctx) => {
        const loggedElements = new Set<string>()

        function describeElement(el: any, index: number) {
            try {
                const attrs = el.attributes || {}

                const vcElement =
                    attrs["data-vc-element"] ||
                    attrs["data-video-core-element"] ||
                    ""

                const className =
                    attrs["class"] ||
                    ""

                const id =
                    attrs["id"] ||
                    ""

                const key =
                    `${vcElement}|${id}|${className}|${index}`

                if (loggedElements.has(key)) {
                    return
                }

                loggedElements.add(key)

                console.log("[Chrome Cast Diagnostic] DOM element", {
                    vcElement,
                    id,
                    className,
                    attributes: attrs
                })
            } catch (e) {
                console.error(
                    "[Chrome Cast Diagnostic] Impossible de décrire l'élément:",
                    e
                )
            }
        }

        function enableChromeCast(video: any) {
            try {
                // Autorise Chrome Remote Playback / Cast.
                video.setProperty("disableRemotePlayback", false)

                // IMPORTANT :
                // on garde temporairement les contrôles natifs Chrome
                // car c'est là que le bouton Cast est actuellement visible.
                video.setProperty("controls", true)

                video.setProperty("playsInline", true)

                video.setDataAttribute(
                    "chrome-cast-test",
                    "enabled"
                )

                console.log(
                    "[Chrome Cast Diagnostic] Vidéo détectée, contrôles Chrome activés"
                )
            } catch (e) {
                console.error(
                    "[Chrome Cast Diagnostic] Erreur activation Cast:",
                    e
                )
            }
        }

        ctx.dom.onReady(async () => {
            const video = await ctx.dom.queryOne(
                '[data-vc-element="video"]'
            )

            if (video) {
                enableChromeCast(video)

                ctx.toast.success(
                    "Chrome Cast : diagnostic activé"
                )
            } else {
                console.log(
                    "[Chrome Cast Diagnostic] Aucune vidéo trouvée au démarrage"
                )
            }
        })

        // Seanime peut recréer la balise vidéo au changement
        // d'épisode ou de serveur.
        ctx.dom.observe(
            '[data-vc-element="video"]',
            (videos) => {
                for (const video of videos) {
                    enableChromeCast(video)
                }
            }
        )

        /*
         * DIAGNOSTIC :
         * on journalise tous les éléments Video Core / Seanime
         * possédant data-vc-element.
         *
         * Le prochain issue_report permettra d'identifier
         * précisément le conteneur de la barre de contrôles Seanime
         * qui masque la barre native Chrome.
         */
        ctx.dom.observe(
            '[data-vc-element]',
            (elements) => {
                let index = 0

                for (const el of elements) {
                    describeElement(el, index)
                    index++
                }
            }
        )

        /*
         * Certaines versions utilisent également
         * data-video-core-element.
         */
        ctx.dom.observe(
            '[data-video-core-element]',
            (elements) => {
                let index = 0

                for (const el of elements) {
                    describeElement(el, index)
                    index++
                }
            }
        )
    })
}

init()
