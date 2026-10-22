/**
 * Seanime MangaProvider — AnimeSama (https://anime-sama.to)
 *
 * Fork of "AnimeSama (Manga)" v2.1.0 (pal & Rafou376), fixed for the
 * 2026-10 catalogue redesign:
 *
 *  - the catalogue page no longer renders results server side, so parsing
 *    /catalogue/?search=… always yields zero cards. The live search is now
 *    served by GET /catalogue/fragment.php?search=… which returns
 *    JSON { liste, pagination, total }; `liste` holds the card HTML.
 *  - cards are now <div class="as-carte …" data-url/data-nom/data-img> with
 *    badges <span class="as-badge as-badge-scan|webtoon">. The old
 *    <p class="info-value">Types</p> field that used to list "Scans" is gone.
 *
 * Chapter discovery is unchanged by the redesign: /catalogue/<slug>/ declares
 * its scan panels through panneauScan("<label>", "<scan path>"), the scan
 * sub-page carries the raw work title in id="titreOeuvre" (the value the scan
 * API expects, spacing included), and /s2/scans/get_nb_chap_et_img.php returns
 * { "<chapter>": <page count> }. Pages are static JPEGs under /s2/scans/.
 */
class Provider {
    api = 'https://anime-sama.to'
    s2 = 'https://anime-sama.to/s2/scans'

    // A card is kept only when it advertises manga content. `webtoon` matters:
    // anime-sama tags pure webtoons with as-badge-webtoon (no as-badge-scan)
    // while still serving real scan chapters (e.g. "Infinite Mage").
    mangaBadge = /as-badge-(?:scan|webtoon)\b/i

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        }
    }

    getHeaders(referer) {
        return {
            'Referer': referer || `${this.api}/`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
        }
    }

    getWorkTitle(html) {
        // The oeuvre param the scan API expects is the raw display title
        // (exact spacing/casing as shown on the page), not the URL slug.
        // e.g. title "Blue Lock  " (with trailing spaces) -> oeuvre=Blue%20Lock%20%20
        const match = html.match(/<[^>]*id=["']titreOeuvre["'][^>]*>([^<]*)/i)
        return match ? match[1] : ''
    }

    async search(opts) {
        const query = String(opts?.query ?? '').trim()
        if (!query) return []

        const url = `${this.api}/catalogue/fragment.php?search=${encodeURIComponent(query)}`

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: this.getHeaders(`${this.api}/catalogue/`),
            })

            if (!response.ok) {
                console.log(`[ANIMESAMAMANGA] Search failed: HTTP ${response.status}`)
                return []
            }

            let liste = ''
            try {
                const data = JSON.parse(await response.text())
                liste = typeof data?.liste === 'string' ? data.liste : ''
            } catch (e) {
                console.log('[ANIMESAMAMANGA] Search failed: fragment.php did not return JSON')
                return []
            }

            return this.parseSearchResults(liste)
        } catch (e) {
            console.log(`[ANIMESAMAMANGA] Search failed: ${e}`)
            return []
        }
    }

    /**
     * Parses the card HTML returned in fragment.php's `liste` field.
     * Card shape (2026-10):
     *   <div class="as-carte as-carte-oeuvre" data-url="/catalogue/<slug>/"
     *        data-cat="oeuvre" data-nom="<raw title>" data-img="<cover>">
     *     <a class="as-carte-lien" href="https://anime-sama.to/catalogue/<slug>">
     *       …<img src="<thumb>">… <span class="as-badge as-badge-scan">Scans</span>
     *       <h3 class="as-carte-titre" title="<raw title>"><raw title></h3>
     */
    parseSearchResults(html) {
        const source = String(html || '')
        const results = []

        const starts = []
        // The class token must be exactly `as-carte`, not a nested helper such as
        // `as-carte-badges` / `as-carte-texte` — otherwise a card block would be
        // truncated before its own badges.
        const cardRe = /<div[^>]*class=["'][^"']*\bas-carte(?=[\s"'])[^"']*["'][^>]*>/gi
        for (const match of source.matchAll(cardRe)) {
            starts.push({ start: match.index, tag: match[0] })
        }

        for (let i = 0; i < starts.length; i++) {
            const end = i + 1 < starts.length ? starts[i + 1].start : source.length
            const card = source.slice(starts[i].start, end)

            if (!this.mangaBadge.test(card)) continue

            const attr = (name) => {
                const m = starts[i].tag.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'))
                return m ? m[1].trim() : ''
            }

            const href = attr('data-url') || attr('href')
            const slugMatch = href.match(/catalogue\/([^/?"']+)/i) || card.match(/href=["'][^"']*\/catalogue\/([^/?"']+)/i)
            if (!slugMatch) continue

            const titleMatch = card.match(/<h3[^>]*class=["'][^"']*as-carte-titre[^"']*["'][^>]*>([^<]*)/i)
            const imgMatch = card.match(/<img[^>]+src=["']([^"']+)["']/i)

            const slug = slugMatch[1]
            const title = (attr('data-nom') || (titleMatch ? titleMatch[1] : '')).trim() || slug

            results.push({
                id: slug,
                title,
                image: attr('data-img') || (imgMatch ? imgMatch[1] : undefined),
            })
        }

        return results
    }

    async findChapters(mangaId) {
        // mangaId is the slug, e.g. "infinite-mage"
        try {
            const catalogueUrl = `${this.api}/catalogue/${mangaId}`
            const pageResponse = await fetch(catalogueUrl, { headers: this.getHeaders() })

            if (!pageResponse.ok) return []

            const documentHtml = await pageResponse.text()

            // The Manga section declares its scan panels via JS calls like:
            //   panneauScan("Scans", "scan/vf");
            //   panneauScan("Blue Lock Spin-off", "scan_spin-off/vf");
            const panneauRegex = /panneauScan\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g

            // Extract valid scan panels (excluding "va" - version anglaise)
            const panels = Array.from(documentHtml.matchAll(panneauRegex))
                .map(m => ({ scanTitle: m[1], scanPath: m[2].trim() }))
                .filter(p => !p.scanPath.includes('va'))

            if (!panels.length) {
                console.log(`[ANIMESAMAMANGA] No scan panel on ${catalogueUrl}`)
                return []
            }

            // Process each valid panel concurrently
            const allPanelsResults = await Promise.all(panels.map(async ({ scanPath }) => {
                // scanPath looks like "scan/vf" — the lang is the last segment
                const lang = scanPath.split('/').pop()
                const subMangaUrl = `${this.api}/catalogue/${mangaId}/${scanPath}/`

                const subResponse = await fetch(subMangaUrl, { headers: this.getHeaders(catalogueUrl) })
                if (!subResponse.ok) return []
                const subHtml = await subResponse.text()

                const title = this.getWorkTitle(subHtml)
                if (!title.trim()) return []

                // Fetch chapter count map: { "1": numPages, "2": numPages, ... }
                // Note: this endpoint takes only "oeuvre" (the raw title), no "lang" param.
                const chapUrl = `${this.s2}/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(title)}`
                const chapResponse = await fetch(chapUrl, { headers: this.getHeaders() })

                if (!chapResponse.ok) return []

                let apiImageCountJson = {}
                try {
                    apiImageCountJson = await chapResponse.json()
                } catch (e) {
                    return []
                }

                if (!apiImageCountJson || typeof apiImageCountJson !== 'object') return []

                return Object.entries(apiImageCountJson).map(([chapName, numPages]) => ({
                    // Encode mangaId, oeuvre title, lang, chapter number and page count
                    // so findChapterPages can build static image URLs + a correct referer.
                    id: `${mangaId}|${encodeURIComponent(title)}|${lang}|${chapName}|${numPages}`,
                    url: `${this.api}/catalogue/${mangaId}/${scanPath}/${chapName}`,
                    title: `Chapitre ${chapName}`,
                    chapter: chapName,
                }))
            }))

            // Deduplicate chapters by name across multiple panels
            const chapters = []
            const seenNames = new Set()

            for (const panelChapters of allPanelsResults) {
                for (const chapter of panelChapters) {
                    if (!seenNames.has(chapter.chapter)) {
                        seenNames.add(chapter.chapter)
                        chapters.push(chapter)
                    }
                }
            }

            // Sort numerically ascending when possible
            chapters.sort((a, b) => {
                const numA = parseFloat(a.chapter)
                const numB = parseFloat(b.chapter)
                if (isNaN(numA) || isNaN(numB)) {
                    return a.chapter.localeCompare(b.chapter, undefined, { numeric: true })
                }
                return numA - numB
            })

            chapters.forEach((c, i) => { c.index = i })

            return chapters
        } catch (e) {
            console.log(`[ANIMESAMAMANGA] findChapters failed: ${e}`)
            return []
        }
    }

    async findChapterPages(chapterId) {
        // chapterId is "mangaId|encodedOeuvre|lang|chapNum|pageCount"
        const parts = String(chapterId).split('|')
        const encodedOeuvre = parts[1]
        const chapNum = parts[3]
        const pageCount = parseInt(parts[4], 10) || 0
        const referer = `${this.api}/`

        // Pages are static images at:
        // https://anime-sama.to/s2/scans/{oeuvre}/{chapNum}/{pageNum}.jpg
        return Array.from({ length: pageCount }, (_, i) => ({
            url: `${this.s2}/${encodedOeuvre}/${chapNum}/${i + 1}.jpg`,
            index: i,
            headers: { 'Referer': referer },
        }))
    }
}