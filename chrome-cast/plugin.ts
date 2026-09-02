function init() {
    $ui.register((ctx) => {
        const loggedElements = new Set<string>()

        function describeElement(el: any, index: number, label: string) {
            try {
                const node = el.getNode ? el.getNode() : null
                if (!node) return

                const attrs: Record<string, string> = {}
                if (node.attributes) {
                    for (const [k, v] of Object.entries(node.attributes)) {
                        attrs[k] = String(v)
                    }
                }

                const key = `${label}|${attrs["data-vc-element"] || attrs["data-video-core-element"] || ""}|${attrs["class"] || ""}|${attrs["id"] || ""}|${index}`
                if (loggedElements.has(key)) return
                loggedElements.add(key)

                console.log("[Chrome Cast Diagnostic]", label, JSON.stringify(attrs))
            } catch (e) {
                console.error("[Chrome Cast Diagnostic] describe error:", e)
            }
        }

        function getHtmlVideo(): HTMLVideoElement | null {
            return document.querySelector("video")
        }

        function hideSeanimeControls() {
            // Trouver et masquer TOUS les éléments de contrôle Seanime
            // On cible les éléments qui ne sont PAS la vidéo elle-même
            const allEls = document.querySelectorAll("[data-vc-element], [data-video-core-element]")
            let hidden = 0

            for (const el of allEls) {
                const vcEl = el.getAttribute("data-vc-element") || el.getAttribute("data-video-core-element") || ""

                // Ne pas masquer la vidéo elle-même
                if (vcEl === "video") continue

                // Masquer tout le reste (controls, controls-bar, etc.)
                ;(el as HTMLElement).style.setProperty("display", "none", "important")
                hidden++
            }

            if (hidden > 0) {
                console.log(`[Chrome Cast Diagnostic] ${hidden} éléments Seanime masqués`)
            }
        }

        function showSeanimeControls() {
            const allEls = document.querySelectorAll("[data-vc-element], [data-video-core-element]")
            for (const el of allEls) {
                ;(el as HTMLElement).style.removeProperty("display")
            }
        }

        function enableChromeCast() {
            const video = getHtmlVideo()
            if (!video) return

            video.disableRemotePlayback = false
            video.controls = true
            video.setAttribute("data-chrome-cast-test", "enabled")

            console.log("[Chrome Cast Diagnostic] Video controls activés")
        }

        function setupPlayPauseToggle() {
            const video = getHtmlVideo()
            if (!video) return

            video.addEventListener("play", () => {
                // En lecture : masquer contrôles Seanime, garder Chrome natifs
                hideSeanimeControls()
                video.controls = true
                console.log("[Chrome Cast Diagnostic] Play → contrôles Seanime masqués")
            })

            video.addEventListener("pause", () => {
                // En pause : garder Chrome natifs (Cast accessible)
                video.controls = true
                console.log("[Chrome Cast Diagnostic] Pause → controls restent actifs")
            })

            // Si déjà en pause au chargement
            if (video.paused) {
                hideSeanimeControls()
                video.controls = true
            }
        }

        ctx.dom.onReady(async () => {
            // Diagnostic : lister TOUS les éléments avec data-vc-element
            console.log("[Chrome Cast Diagnostic] === DÉBUT DIAGNOSTIC DOM ===")

            // Observer les data-vc-element
            ctx.dom.observe("[data-vc-element]", (elements) => {
                let i = 0
                for (const el of elements) {
                    describeElement(el, i, "data-vc-element")
                    i++
                }
            })

            // Observer les data-video-core-element
            ctx.dom.observe("[data-video-core-element]", (elements) => {
                let i = 0
                for (const el of elements) {
                    describeElement(el, i, "data-video-core-element")
                    i++
                }
            })

            // petit délai pour laisser le DOM se monter
            setTimeout(() => {
                enableChromeCast()
                setupPlayPauseToggle()

                // Diagnostic initial
                const allEls = document.querySelectorAll("[data-vc-element], [data-video-core-element]")
                console.log(`[Chrome Cast Diagnostic] ${allEls.length} éléments trouvés au total`)
                for (const el of allEls) {
                    const vcEl = el.getAttribute("data-vc-element") || el.getAttribute("data-video-core-element") || ""
                    const classes = el.className || ""
                    const tag = el.tagName
                    console.log(`[Chrome Cast Diagnostic] → <${tag}> data-vc="${vcEl}" class="${classes}"`)
                }
                console.log("[Chrome Cast Diagnostic] === FIN DIAGNOSTIC DOM ===")
            }, 1000)

            ctx.toast.success("Chrome Cast : diagnostic lancé")
        })

        // Réinjecter au changement de vidéo
        ctx.dom.observe("[data-vc-element='video'], [data-video-core-element='video']", () => {
            setTimeout(() => {
                enableChromeCast()
                setupPlayPauseToggle()
            }, 500)
        })
    })
}

init()
