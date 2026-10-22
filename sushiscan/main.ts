/**
 * Seanime MangaProvider — SushiScan (https://sushiscan.net)
 *
 * Fork of branrgx's provider v1.0.0 (branrgx/seanime-extensions). Two
 * load-bearing fixes:
 *
 *  - **Never send an empty User-Agent.** SushiScan sits behind Cloudflare and
 *    answers HTTP 403 to any request without a browser User-Agent — including
 *    wp-admin/admin-ajax.php. Upstream only filled `userAgent` from
 *    FlareSolverr, so on a host where FlareSolverr is not running
 *    (`127.0.0.1:8191` → connection refused) every search returned 403 and
 *    Seanime reported "no results found". A browser UA is now always sent and
 *    the FlareSolverr bypass is opt-in.
 *  - **Covers cannot carry a Referer.** sushiscan.net serves its images only
 *    when the Referer is a sushiscan.net URL, and only `ChapterPage` has a
 *    `headers` field (SearchResult does not), so upstream's
 *    `&headers={…}` suffix on the cover URL only corrupted it. Removed; covers
 *    may render blank in the provider's result list.
 *
 * Chapter pages keep working because Seanime proxies each `ChapterPage` through
 * /api/v1/image-proxy with the headers below attached.
 *
 * Server-side contracts verified against the live site (2026-10-22):
 *   POST /wp-admin/admin-ajax.php  action=ts_ac_do_search & ts_ac_query=<q>
 *     → {"series":[{"all":[{post_title, post_link, post_image, …}]}]}
 *   GET  /catalogue/<slug>/  → #chapterlist > ul > li[data-num]
 *     (li .eph-num>a[href], .chapternum, .chapterdate)
 *   GET  /<chapter-slug>/    → "sources": [{"source":…,"images":[…]}]
 *     images live on c.sushiscan.net and require a sushiscan Referer.
 */

interface SerieSearchItem {
  ID: number
  post_image: string
  post_title: string
  post_link: string
}

interface SerieSearchResponse {
  series: { all: SerieSearchItem[] }[]
}

class Provider {
  private useProxyBypass = "{{useProxyBypassSushiScan}}"
  private proxyBypassUrl = "{{proxyBypassUrlSushiScan}}"
  private baseUrl = "https://sushiscan.net"

  // Sending an empty User-Agent is what broke search on hosts without
  // FlareSolverr: Cloudflare answers 403 and the provider silently returned [].
  private defaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"

  private cookies = ""
  private userAgent = ""
  private proxyResolved = false

  getSettings(): Settings {
    return {
      supportsMultiLanguage: false,
      supportsMultiScanlator: false,
    }
  }

  /**
   * A user-config value can still be the raw `{{placeholder}}` when the field
   * was never set (or when the default was not applied), so treat anything
   * unsubstituted/empty as "disabled" instead of trying 127.0.0.1:8191.
   */
  private stringToBool(str: string): boolean {
    const value = (str ?? "").trim().toLowerCase()
    if (!value || value.startsWith("{{")) return false
    return value === "true" || value === "1" || value === "on" || value === "yes"
  }

  /**
   * admin-ajax returns titles HTML-escaped ("Sanji&#039;s Food Wars"), which
   * would both display wrong and hurt AniList matching.
   */
  private decodeEntities(text: string): string {
    return (text ?? "")
      .replace(/&#0*39;|&#x27;|&apos;/gi, "'")
      .replace(/&#0*34;|&quot;/gi, "\"")
      .replace(/&#0*38;|&amp;/gi, "&")
      .replace(/&#0*60;/gi, "<")
      .replace(/&#0*62;/gi, ">")
      .replace(/&nbsp;/gi, " ")
  }

  async search(opts: QueryOptions): Promise<SearchResult[]> {
    const query = (opts?.query ?? "").trim()
    if (!query) return []

    const formData = new FormData()
    formData.append("action", "ts_ac_do_search")
    formData.append("ts_ac_query", query)

    const res = await this.safeFetch(`${this.baseUrl}/wp-admin/admin-ajax.php`, {
      method: "POST",
      body: formData,
    })

    if (!res.ok) {
      console.log(`[SUSHISCAN] Search failed: HTTP ${res.status}`)
      return []
    }

    let data: SerieSearchResponse
    try {
      data = await res.json()
    } catch (e) {
      console.log("[SUSHISCAN] Search failed: admin-ajax did not return JSON")
      return []
    }

    const items = data?.series?.[0]?.all ?? []

    const series: SearchResult[] = items.map((item) => ({
      id: item.post_link.split(this.baseUrl)[1] ?? item.post_link,
      title: this.decodeEntities(item.post_title),
      // No `&headers=` here: only ChapterPage headers are honoured by Seanime.
      image: item.post_image,
    }))

    if (opts?.year) {
      await this.enrichWithYear(series)
      return series.filter((serie) => serie.year === opts.year)
    }

    return series
  }

  /**
   * Reads the "Année" row of each result page. Upstream did this on every
   * search (one page fetch per result); it only matters when the caller filters
   * on the year, so it is deferred until then.
   */
  private async enrichWithYear(series: SearchResult[]): Promise<void> {
    await Promise.all(
      series.map(async (serie) => {
        try {
          const res = await this.safeFetch(`${this.baseUrl}${serie.id}`)
          if (!res.ok) return

          const $ = LoadDoc(await res.text())
          $(".infotable tr").each((_: number, row: any) => {
            const rowText = row.text()?.trim() ?? ""
            if (rowText.includes("Année")) {
              const year = rowText.split("Année")[1].trim()
              serie.year = year ? parseInt(year) : undefined
            }
          })
        } catch (e) {
          // year stays undefined
        }
      }),
    )
  }

  async findChapters(mangaId: string): Promise<ChapterDetails[]> {
    const res = await this.safeFetch(`${this.baseUrl}${mangaId}`)

    if (!res.ok) {
      console.log(`[SUSHISCAN] findChapters failed: HTTP ${res.status} for ${mangaId}`)
      return []
    }

    const $ = LoadDoc(await res.text())

    const chapters: ChapterDetails[] = [];
    $("#chapterlist>ul")
      .children("li")
      .each((i: number, e: any) => {
        const url = e.find(".eph-num>a").attr("href")?.trim() ?? ""
        if (!url) return

        chapters.push({
          id: url.split(this.baseUrl)[1] ?? url,
          url,
          title: e.find(".chapternum").text().trim(),
          chapter: e.attr("data-num")?.trim() ?? "",
          updatedAt: this.parseChapterDate(e.find(".chapterdate").text()),
          index: i,
        })
      })

    if (!chapters.length) {
      console.log(`[SUSHISCAN] findChapters: no chapter found for ${mangaId}`)
      return []
    }

    // The site lists newest first; Seanime expects ascending order.
    return chapters.reverse().map((chapter, i) => ({ ...chapter, index: i }))
  }

  /**
   * The site renders French dates ("19 avril 2026"); `new Date(...)` does not
   * parse those, so upstream shipped `"Invalid Date"` as updatedAt. Returns
   * undefined when the text does not match, rather than a poisoned date.
   */
  private parseChapterDate(text: string): string | undefined {
    const months: { [key: string]: number } = {
      janvier: 0,
      février: 1,
      fevrier: 1,
      mars: 2,
      avril: 3,
      mai: 4,
      juin: 5,
      juillet: 6,
      août: 7,
      aout: 7,
      septembre: 8,
      octobre: 9,
      novembre: 10,
      décembre: 11,
      decembre: 11,
    }

    const match = (text ?? "").trim().match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})$/)
    if (!match) return undefined

    const month = months[match[2].toLowerCase()]
    if (month === undefined) return undefined

    const date = new Date(Date.UTC(parseInt(match[3], 10), month, parseInt(match[1], 10)))
    return isNaN(date.getTime()) ? undefined : date.toISOString()
  }

  async findChapterPages(chapterId: string): Promise<ChapterPage[]> {
    const pageUrl = `${this.baseUrl}${chapterId}`
    const res = await this.safeFetch(pageUrl)

    if (!res.ok) {
      console.log(`[SUSHISCAN] findChapterPages failed: HTTP ${res.status} for ${chapterId}`)
      return []
    }

    const html = await res.text()

    // The reader bootstraps from a "sources" array inlined in the page.
    const sourcesRegex = /"sources":\s*(\[[\s\S]*?\})\s*\]/
    const match = html.match(sourcesRegex)
    if (!match?.[1]) {
      console.log(`[SUSHISCAN] findChapterPages: no sources block for ${chapterId}`)
      return []
    }

    let sources: { source: string; images: string[] }[]
    try {
      sources = JSON.parse(match[1] + "]")
    } catch (e) {
      console.log(`[SUSHISCAN] findChapterPages: sources block is not valid JSON for ${chapterId}`)
      return []
    }

    const images = sources?.[0]?.images ?? []
    if (!images.length) {
      console.log(`[SUSHISCAN] findChapterPages: empty image list for ${chapterId}`)
      return []
    }

    // SushiScan serves its images only to a sushiscan.net Referer, and Seanime
    // proxies this through /api/v1/image-proxy with exactly these headers.
    const headers: { [key: string]: string } = {
      Referer: pageUrl,
      "User-Agent": this.userAgent || this.defaultUserAgent,
    }
    if (this.cookies) headers["Cookie"] = this.cookies

    return images.map((url, index) => ({
      index,
      url: new URL(url).href,
      headers,
    }))
  }

  /**
   * Opt-in Cloudflare bypass: fills the cookie jar and User-Agent from a
   * FlareSolverr instance. A missing or unreachable proxy is not fatal — the
   * request continues with the default browser UA.
   */
  private async getValidSessionHeaders(): Promise<void> {
    const endpoint = (this.proxyBypassUrl ?? "").trim().replace(/\/$/, "")

    if (!endpoint || endpoint.startsWith("{{")) {
      this.proxyResolved = true
      return
    }

    try {
      const res = await fetch(`${endpoint}/v1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cmd: "request.get",
          url: `${this.baseUrl}/`,
          maxTimeout: 60000,
        }),
      })
      const data = await res.json()

      if (data?.solution?.cookies) {
        this.cookies = data.solution.cookies.map((c: any) => `${c.name}=${c.value}`).join("; ")
      }
      if (data?.solution?.userAgent) {
        this.userAgent = data.solution.userAgent
      }
    } catch (e) {
      console.log(`[SUSHISCAN] Cloudflare bypass unavailable, using a direct request instead (${e})`)
    } finally {
      this.proxyResolved = true
    }
  }

  private async safeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    if (this.stringToBool(this.useProxyBypass) && !this.proxyResolved) {
      await this.getValidSessionHeaders()
    }

    const headers: { [key: string]: string } = { ...((init.headers as any) ?? {}) }

    // A browser User-Agent is mandatory: Cloudflare answers 403 without one.
    headers["User-Agent"] = this.userAgent || this.defaultUserAgent
    if (this.cookies) headers["Cookie"] = this.cookies
    if (!headers["Referer"]) headers["Referer"] = `${this.baseUrl}/`

    return fetch(input, { ...init, headers })
  }
}