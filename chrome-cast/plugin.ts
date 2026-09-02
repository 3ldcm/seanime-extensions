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
                // Active les contrôles natifs Chrome (bouton Cast inclus)
                video.setProperty("disableRemotePlayback", false)
                video.setProperty("controls", true)
                video.setProperty("playsInline", true)
                video.setDataAttribute("chrome-cast-test", "enabled")

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

        /*
         * MASQUER LES CONTRÔLES SEANIME
         *
         * On veut UNIQUEMENT la barre Chrome native (avec Cast).
         * On cache les éléments de contrôle Seanime via CSS.
         */
        function hideSeanimeControls() {
            const style = document.createElement("style")
            style.setAttribute("data-chrome-cast", "hide-seanime-controls")
            style.textContent = `
                /* Masquer la barre de contrôles Seanime */
                [data-vc-element="controls"],
                [data-vc-element="controls-bar"],
                [data-vc-element="player-controls"],
                [data-video-core-element="controls"],
                [data-video-core-element="controls-bar"],
                .video-controls,
                .player-controls,
                .controls-bar,
                [class*="controls"][class*="video"],
                [class*="player"][class*="controls"] {
                    display: none !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                }
            `

            // Éviter les doublons
            const existing = document.querySelector('style[data-chrome-cast="hide-seanime-controls"]')
            if (existing) {
                existing.remove()
            }

            document.head.appendChild(style)

            console.log(
                "[Chrome Cast Diagnostic] Contrôles Seanime masqués"
            )
        }

        ctx.dom.onReady(async () => {
            const video = await ctx.dom.queryOne(
                '[data-vc-element="video"]'
            )

            if (video) {
                enableChromeCast(video)
                hideSeanimeControls()

                ctx.toast.success(
                    "Chrome Cast : contrôles Chrome natifs activés"
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
                    hideSeanimeControls()
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
