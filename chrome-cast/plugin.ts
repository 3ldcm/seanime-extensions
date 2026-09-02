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
                const className = attrs["class"] || ""
                const id = attrs["id"] || ""
                const key = `${vcElement}|${id}|${className}|${index}`

                if (loggedElements.has(key)) return
                loggedElements.add(key)

                console.log("[Chrome Cast Diagnostic] DOM element", {
                    vcElement, id, className, attributes: attrs
                })
            } catch (e) {
                console.error("[Chrome Cast Diagnostic] Erreur describe:", e)
            }
        }

        /*
         * CRÉER LE BOUTON CAST
         */
        function createCastButton(): HTMLElement {
            const btn = document.createElement("button")
            btn.setAttribute("data-chrome-cast-button", "true")
            btn.title = "Cast to device"
            btn.style.cssText = `
                background: none;
                border: none;
                color: white;
                cursor: pointer;
                padding: 4px 8px;
                margin: 0 2px;
                font-size: 18px;
                line-height: 1;
                opacity: 0.85;
                transition: opacity 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
            `
            btn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/>
                    <circle cx="2" cy="20" r="1"/>
                </svg>
            `

            btn.addEventListener("mouseenter", () => { btn.style.opacity = "1" })
            btn.addEventListener("mouseleave", () => { btn.style.opacity = "0.85" })

            btn.addEventListener("click", async (e) => {
                e.preventDefault()
                e.stopPropagation()

                const video = document.querySelector(
                    "video[data-video-core-element], video[data-vc-element='video'], video"
                ) as HTMLVideoElement

                if (!video) {
                    console.error("[Chrome Cast] Aucune vidéo trouvée")
                    return
                }

                try {
                    // Activer Remote Playback si nécessaire
                    video.disableRemotePlayback = false

                    if (video.remote) {
                        console.log("[Chrome Cast] Ouverture du sélecteur Cast...")
                        await video.remote.prompt()
                    } else {
                        console.warn("[Chrome Cast] Remote Playback API non disponible")
                    }
                } catch (err) {
                    console.error("[Chrome Cast] Erreur Cast:", err)
                }
            })

            return btn
        }

        /*
         * INJECTER LE BOUTON DANS LA BARRE SEANIME
         */
        function injectCastButton() {
            // Si déjà injecté, ne rien faire
            if (document.querySelector("[data-chrome-cast-button]")) return

            // Chercher la barre de contrôles Seanime
            const controlsBar =
                document.querySelector('[data-vc-element="controls"]') ||
                document.querySelector('[data-vc-element="controls-bar"]') ||
                document.querySelector('[data-vc-element="player-controls"]') ||
                document.querySelector('[data-video-core-element="controls"]') ||
                document.querySelector('[data-video-core-element="controls-bar"]')

            if (!controlsBar) {
                console.log("[Chrome Cast Diagnostic] Barre de contrôles Seanime non trouvée")
                return
            }

            const castBtn = createCastButton()
            controlsBar.appendChild(castBtn)

            console.log("[Chrome Cast Diagnostic] Bouton Cast injecté dans la barre Seanime")
        }

        ctx.dom.onReady(async () => {
            const video = await ctx.dom.queryOne(
                '[data-vc-element="video"]'
            )

            if (video) {
                // NE PAS activer controls=true sur la vidéo
                // On garde les contrôles Seanime, on ajoute juste le bouton Cast
                try {
                    video.setProperty("playsInline", true)
                    video.setDataAttribute("chrome-cast-test", "enabled")
                } catch (e) {}

                // Petit délai pour laisser Seanime monter ses contrôles
                setTimeout(injectCastButton, 500)

                ctx.toast.success("Chrome Cast : bouton Cast ajouté")
            } else {
                console.log("[Chrome Cast Diagnostic] Aucune vidéo trouvée au démarrage")
            }
        })

        // Observer les changements de vidéo (changement d'épisode/serveur)
        ctx.dom.observe(
            '[data-vc-element="video"]',
            (videos) => {
                for (const _video of videos) {
                    // Réinjecter si besoin (nouvelle vidéo = nouveaux contrôles)
                    setTimeout(injectCastButton, 500)
                }
            }
        )

        // Observer aussi les changements dans la barre de contrôles
        ctx.dom.observe(
            '[data-vc-element="controls"], [data-vc-element="controls-bar"], [data-video-core-element="controls"]',
            () => {
                setTimeout(injectCastButton, 300)
            }
        )

        // Diagnostic DOM
        ctx.dom.observe('[data-vc-element]', (elements) => {
            let index = 0
            for (const el of elements) {
                describeElement(el, index)
                index++
            }
        })

        ctx.dom.observe('[data-video-core-element]', (elements) => {
            let index = 0
            for (const el of elements) {
                describeElement(el, index)
                index++
            }
        })
    })
}

init()
