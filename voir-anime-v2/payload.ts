/// <reference path="../_external/.onlinestream-provider.d.ts" />
/// <reference path="../_external/core.d.ts" />

const DevMode = true;
const originalConsoleLog = console.log;

console.log = function (...args: any[]) {
    if (DevMode) {
        originalConsoleLog.apply(console, args);
    }
};

class Provider {
    readonly BASE_URL = "https://voir-anime.to";

    private readonly SUPPORTED_SERVERS = [
        "mytv",
        "stape"
    ];

    // Seanime asks the same question several times in a row (entry opened, then
    // the player refreshed, then the next episode of the same series): these two
    // caches keep the repeats off the network.
    private readonly SEARCH_TTL_MS = 300000;
    private readonly PAGE_TTL_MS = 30000;

    private searchCache: Record<string, { at: number, results: SearchResult[] }> = {};
    private pageCache: Record<string, { at: number, html: string }> = {};

    // The site advertises six players; only these two can return a source today.
    // The others are kept out of SUPPORTED_SERVERS on purpose — Seanime shows
    // every advertised server in its picker, and a server that can never return
    // a source is worse than an absent one. Their code paths and logs stay, so
    // they can be re-enabled as soon as an extractor exists:
    //
    //  - "voe" (voe.sx -> rotating mirror, e.g. derricknationtop.com): the embed
    //    URL only answers a 751-byte JS-redirect stub; the mirror page holds no
    //    m3u8/mp4 in its HTML (checked on 3 episodes) and builds the source from
    //    an obfuscated JSON blob + a DOM-dependent loader. Also present on the
    //    mirror: a Big_Buck_Bunny sample URL, which addVideoUrl now rejects.
    //  - "moon" (mfw09.org and mirrors): React SPA + fingerprint/AES-GCM
    //    handshake, the m3u8 is built client-side. See the Seanime skill
    //    reference `moon-byse-mfw09.md` — needs a HAR holding the embed
    //    <script> body.
    //  - "fhd1" ("LECTEUR FHD1" -> my.mail.ru/video/embed/...): HTTP 404 on all
    //    five episodes tested on 2026-10-22; no Mail.ru/DASH extractor written.
    //  - "sb" ("LECTEUR SB" -> streamhide.to/e/...): the host refused every
    //    non-browser TLS handshake from the test machine, so nothing could be
    //    verified (parseChapterSources skips it rather than faking success).

    private static readonly QUERY_SPLIT_RE =
        /[\s:']+/;

    private static readonly VIDEO_URL_RE =
        /(?:https?:\/\/|\/)[^\s'"]+\.(?:m3u8|mp4)(?:\?[^\s'"]*)?/g;

    private static readonly ESCAPED_VIDEO_URL_RE =
        /(?:https?:\\\/\\\/|\\\/)[^\s'"]+\.(?:m3u8|mp4)(?:\?[^\s'"]*)?/g;

    private static readonly FILE_RE =
        /file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i;

    private static readonly CHAPTER_SOURCES_RE =
        /var\s+thisChapterSources\s*=\s*(\{[\s\S]*?\});/;

    getSettings(): Settings {
        return {
            episodeServers: this.SUPPORTED_SERVERS,
            supportsDub: true,
        };
    }

    private proxyFetch(
        targetUrl: string,
        headers?: Record<string, string>,
        method?: string,
        body?: string
    ): Promise<Response> {
        if (!headers && !method && !body) {
            return fetch(targetUrl);
        }

        const init: any = {};

        if (headers) init.headers = headers;
        if (method) init.method = method;
        if (body !== undefined) init.body = body;

        return fetch(
            targetUrl,
            init
        );
    }

    /**
     * Episode and series pages are refetched on every call, and Seanime calls
     * the provider several times in a row (entry opened, player refreshed, next
     * episode of the same series). A short-lived cache keeps those repeats off
     * the network — the same episode page used to be downloaded once per server
     * and once per refresh.
     */
    private async fetchPageCached(
        targetUrl: string
    ): Promise<{ ok: boolean, status: number, html: string }> {

        const cached =
            this.pageCache[targetUrl];

        if (
            cached &&
            Date.now() - cached.at < this.PAGE_TTL_MS
        ) {
            console.log(
                "[VOIRANIME] Page cache hit:",
                targetUrl
            );

            return {
                ok: true,
                status: 200,
                html:
                    cached.html
            };
        }

        const response =
            await this.proxyFetch(
                targetUrl
            );

        if (
            !response.ok
        ) {
            return {
                ok: false,
                status:
                    response.status,
                html: ""
            };
        }

        const html =
            await response.text();

        this.pageCache[targetUrl] = {
            at:
                Date.now(),
            html
        };

        return {
            ok: true,
            status: 200,
            html
        };
    }

    private normalizeTitle(
        value: string
    ): string {
        return value
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, " ")
            .trim()
            .replace(/\s+/g, " ");
    }

    private absoluteUrl(
        rawUrl: string
    ): string {
        if (
            rawUrl.startsWith("http://") ||
            rawUrl.startsWith("https://")
        ) {
            return rawUrl;
        }

        if (
            rawUrl.startsWith("//")
        ) {
            return "https:" + rawUrl;
        }

        if (
            rawUrl.startsWith("/")
        ) {
            return this.BASE_URL + rawUrl;
        }

        return this.BASE_URL + "/" + rawUrl;
    }

    private getSlugFromUrl(
        url: string
    ): string {
        const clean =
            url
                .replace(/\/$/, "")
                .split("?")[0]
                .split("#")[0];

        const parts =
            clean.split("/");

        return parts[
            parts.length - 1
        ] || "";
    }

    private scoreSearchResult(
        query: string,
        title: string,
        url: string
    ): number {

        const normalizedQuery =
            this.normalizeTitle(query);

        const normalizedTitle =
            this.normalizeTitle(title);

        const normalizedSlug =
            this.normalizeTitle(
                this.getSlugFromUrl(url)
                    .replace(/-/g, " ")
            );

        if (
            normalizedQuery === ""
        ) {
            return 0;
        }

        let score = 0;

        if (
            normalizedTitle ===
            normalizedQuery
        ) {
            score += 1000;
        }

        if (
            normalizedSlug ===
            normalizedQuery
        ) {
            score += 900;
        }

        if (
            normalizedTitle.includes(
                normalizedQuery
            )
        ) {
            score += 500;
        }

        if (
            normalizedSlug.includes(
                normalizedQuery
            )
        ) {
            score += 450;
        }

        return score;
    }

    private parseEpisodeNumber(
        text: string,
        url: string
    ): number {
        const source =
            `${text} ${url}`;

        const matches =
            source.match(
                /\b(\d{1,5})\b/g
            ) || [];

        if (
            matches.length === 0
        ) {
            return 1;
        }

        return parseInt(
            matches[
                matches.length - 1
            ],
            10
        );
    }

    private hasDubMarker(
        value: string
    ): boolean {
        const normalized =
            this.normalizeTitle(value);

        const lower =
            value.toLowerCase();

        return (
            /\bvf\d*\b/.test(normalized) ||
            /(?:^|[-_/])vf\d*(?:[-_/]|$)/.test(lower)
        );
    }

    private hasSubMarker(
        value: string
    ): boolean {
        const normalized =
            this.normalizeTitle(value);

        const lower =
            value.toLowerCase();

        return (
            /\bvostfr\b/.test(normalized) ||
            /(?:^|[-_/])vostfr(?:[-_/]|$)/.test(lower)
        );
    }

    private detectResultDub(
        title: string,
        url: string,
        chapterHints: string[]
    ): boolean | null {
        const haystacks =
            [
                title,
                url,
                ...chapterHints
            ];

        for (
            const value of haystacks
        ) {
            if (
                this.hasDubMarker(value)
            ) {
                return true;
            }
        }

        for (
            const value of haystacks
        ) {
            if (
                this.hasSubMarker(value)
            ) {
                return false;
            }
        }

        return null;
    }

    private cleanServerName(
        label: string
    ): string {
        const normalized =
            this.normalizeTitle(label);

        if (
            normalized.includes("mytv")
        ) {
            return "mytv";
        }

        return normalized
            .replace(/^lecteur\s+/, "")
            .replace(/\s+/g, "-");
    }

    /**
     * Target of a browser-side redirect: `window.location.href = "..."`,
     * `location.replace("...")` or a `<meta http-equiv="refresh">` tag.
     */
    private extractJsRedirectTarget(
        html: string
    ): string {
        const patterns = [
            /window\.location\.href\s*=\s*["']([^"']+)["']/i,
            /window\.location\.replace\(\s*["']([^"']+)["']\s*\)/i,
            /location\.href\s*=\s*["']([^"']+)["']/i,
            /location\.replace\(\s*["']([^"']+)["']\s*\)/i,
            /<meta[^>]+http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'\s>]+)/i
        ];

        for (
            const pattern of patterns
        ) {
            const match =
                html.match(pattern);

            if (
                match &&
                match[1]
            ) {
                return match[1].replace(/\\\//g, "/");
            }
        }

        return "";
    }

    /**
     * Hosts such as VOE rotate their domain: the embed URL answers with a stub
     * whose only job is a JS redirect (voe.sx -> derricknationtop.com), and the
     * player markup exists only on the mirror. Follow it (2 hops max) and return
     * the final page + URL, so the caller can both extract from it and use its
     * origin as Referer. Returns null when there is nothing worth following.
     *
     * Only redirects pointing at another embed page (`/e/<id>`, `/embed…`) are
     * followed — those stubs also emit ad/consent redirects that would otherwise
     * burn the request budget for nothing.
     */
    private async resolveJsRedirect(
        html: string,
        iframeUrl: string
    ): Promise<{ html: string, url: string } | null> {
        let currentHtml =
            html;

        let currentUrl =
            iframeUrl;

        let followed =
            false;

        for (
            let hop = 0;
            hop < 2;
            hop++
        ) {
            const target =
                this.extractJsRedirectTarget(
                    currentHtml
                );

            if (
                !target
            ) {
                break;
            }

            let targetUrl:
                URL;

            try {
                targetUrl =
                    new URL(
                        this.absoluteUrl(
                            target
                        )
                    );
            } catch (error) {
                break;
            }

            if (
                targetUrl.href === currentUrl
            ) {
                break;
            }

            const path =
                targetUrl.pathname
                    .toLowerCase();

            if (
                path.indexOf("/e/") === -1 &&
                path.indexOf("embed") === -1
            ) {
                break;
            }

            try {
                const response =
                    await this.proxyFetch(
                        targetUrl.href,
                        {
                            Referer:
                                this.BASE_URL + "/"
                        }
                    );

                if (
                    !response.ok
                ) {
                    break;
                }

                currentHtml =
                    await response.text();

                currentUrl =
                    targetUrl.href;

                followed =
                    true;

            } catch (error) {
                console.log(
                    "[VOIRANIME] JS redirect fetch failed:",
                    error
                );

                break;
            }
        }

        return followed
            ? {
                html:
                    currentHtml,
                url:
                    currentUrl
            }
            : null;
    }

    private extractIframeSrc(
        html: string
    ): string {
        const match =
            html.match(
                /<iframe[^>]+src=["']([^"']+)["']/i
            );

        return match
            ? match[1]
                .replace(/\\\//g, "/")
            : "";
    }

    private parseChapterSources(
        html: string
    ): Record<string, string> {
        const sources:
            Record<string, string> = {};

        const match =
            html.match(
                Provider.CHAPTER_SOURCES_RE
            );

        if (!match) {
            const iframeSrc =
                this.extractIframeSrc(
                    html
                );

            if (iframeSrc) {
                sources.mytv =
                    this.absoluteUrl(
                        iframeSrc
                    );
            }

            return sources;
        }

        try {
            const rawSources =
                JSON.parse(
                    match[1]
                );

            for (
                const label in rawSources
            ) {
                const server =
                    this.cleanServerName(
                        label
                    );

                if (
                    this.SUPPORTED_SERVERS.indexOf(
                        server
                    ) === -1
                ) {
                    continue;
                }

                const iframeSrc =
                    this.extractIframeSrc(
                        rawSources[label]
                    );

                if (iframeSrc) {
                    sources[server] =
                        this.absoluteUrl(
                            iframeSrc
                        );
                }
            }

        } catch (error) {
            console.error(
                "[VOIRANIME] Failed to parse chapter sources:",
                error
            );
        }

        return sources;
    }

    private addVideoUrl(
        urls: string[],
        seen: Record<string, boolean>,
        rawUrl: string,
        origin: string
    ) {
        let cleanedUrl =
            rawUrl
                .replace(/\\\//g, "/")
                .replace(/\\u0026/g, "&")
                .replace(/&amp;/g, "&");

        if (
            cleanedUrl.startsWith("/") &&
            !cleanedUrl.startsWith("//")
        ) {
            cleanedUrl =
                origin + cleanedUrl;

        } else if (
            cleanedUrl.startsWith("//")
        ) {
            cleanedUrl =
                "https:" + cleanedUrl;
        }

        const lowerUrl =
            cleanedUrl.toLowerCase();

        if (
            (
                !lowerUrl.includes(".m3u8") &&
                !lowerUrl.includes(".mp4")
            ) ||
            lowerUrl.includes("thumbnail") ||
            lowerUrl.includes("_p.jpg") ||
            // Decoys: player pages embed royalty-free test clips (the VOE mirror
            // carries test-videos.co.uk/Big_Buck_Bunny). Handing one to Seanime
            // looks like a success while playing a 10-second sample.
            lowerUrl.includes("test-videos.co.uk") ||
            lowerUrl.includes("bigbuckbunny") ||
            lowerUrl.includes("sample-videos") ||
            seen[cleanedUrl]
        ) {
            return;
        }

        seen[cleanedUrl] =
            true;

        urls.push(
            cleanedUrl
        );
    }

    private async extractVideoSourcesFromHtml(
        html: string,
        iframeUrl: string,
        server: string
    ): Promise<VideoSource[]> {
        if (
            server === "voe"
        ) {
            const voeSources =
                await this.extractVoeSourcesFromHtml(
                    html,
                    iframeUrl
                );

            if (
                voeSources.length > 0
            ) {
                return voeSources;
            }
        }

        if (
            server === "stape"
        ) {
            const stapeSources =
                await this.extractStreamtapeSources(
                    html,
                    iframeUrl
                );

            if (
                stapeSources.length > 0
            ) {
                return stapeSources;
            }
        }

        if (
            server === "fhd1"
        ) {
            // "LECTEUR FHD1" (my.mail.ru) answers 404 on every episode tested
            // and the Mail.ru/DASH extractor was never written, so fhd1 is no
            // longer advertised in SUPPORTED_SERVERS. The branch is kept (and
            // reachable through the "mytv" fallback path) so the reason shows up
            // in the logs instead of a silent "no source".
            console.log(
                "[VOIRANIME][FHD1] Skipped: Mail.ru embed returns 404, extractor not implemented"
            );
        }

        if (
            server === "moon"
        ) {
            // "LECTEUR MOON" (mfw09.org and mirrors) is a React SPA: the embed
            // URL returns a ~1.6 KB shell whose JS requests a fingerprint /
            // AES-GCM handshake (POST /api/videos/<id>/embed/view -> 204) and
            // builds the m3u8 client-side, so the page never contains a URL for
            // a regex scanner to find. Nothing honest to return until that
            // handshake is ported (needs a HAR with the embed <script> body).
            console.log(
                "[VOIRANIME][MOON] Handshake not implemented: SPA builds the m3u8 client-side, no source returned"
            );
        }

        const unescapedHtml =
            html
                .replace(/\\\//g, "/")
                .replace(/\\u0026/g, "&")
                .replace(/&amp;/g, "&");

        const urls: string[] = [];
        const seen:
            Record<string, boolean> = {};

        const origin =
            new URL(
                iframeUrl
            ).origin;

        const fileMatch =
            unescapedHtml.match(
                Provider.FILE_RE
            );

        if (
            fileMatch &&
            fileMatch[1]
        ) {
            this.addVideoUrl(
                urls,
                seen,
                fileMatch[1],
                origin
            );
        }

        const escapedMatches =
            html.match(
                Provider.ESCAPED_VIDEO_URL_RE
            ) || [];

        for (
            const url of escapedMatches
        ) {
            this.addVideoUrl(
                urls,
                seen,
                url,
                origin
            );
        }

        const plainMatches =
            unescapedHtml.match(
                Provider.VIDEO_URL_RE
            ) || [];

        for (
            const url of plainMatches
        ) {
            this.addVideoUrl(
                urls,
                seen,
                url,
                origin
            );
        }

        console.log(
            "[VOIRANIME] Video candidates:",
            server,
            urls.length
        );

        return urls.map(
            url => ({
                url,
                type:
                    (
                        url.toLowerCase()
                            .includes(".m3u8")
                    )
                        ? "m3u8" as VideoSourceType
                        : "mp4" as VideoSourceType,
                quality:
                    server + " - auto",
                subtitles:
                    []
            })
        );
    }

    private async extractVoeSourcesFromHtml(
        html: string,
        iframeUrl: string
    ): Promise<VideoSource[]> {
        const scripts:
            string[] = [];

        const externalScripts:
            string[] = [];

        const jsonMatch =
            html.match(
                /<script\b[^>]*\btype=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i
            );

        const jsonScript =
            {
                type:
                    "application/json",
                textContent:
                    jsonMatch
                        ? jsonMatch[1]
                        : "",
                innerHTML:
                    jsonMatch
                        ? jsonMatch[1]
                        : "",
                previousElementSibling:
                    null,
                nextElementSibling:
                    null
            };

        const srcScriptRe =
            /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi;

        let srcMatch:
            RegExpExecArray | null;

        while (
            (srcMatch = srcScriptRe.exec(html)) !== null
        ) {
            const src =
                this.absoluteUrl(
                    srcMatch[1]
                );

            if (
                src.indexOf(
                    "/js/loader"
                ) !== -1
            ) {
                try {
                    const response =
                        await this.proxyFetch(
                            src,
                            {
                                Referer:
                                    iframeUrl
                            }
                        );

                    if (
                        response.ok
                    ) {
                        externalScripts.push(
                            await response.text()
                        );
                    }

                } catch (error) {
                    console.log(
                        "[VOIRANIME] VOE loader fetch failed:",
                        error
                    );
                }
            }
        }

        const scriptRe =
            /<script\b(?![^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi;

        let match:
            RegExpExecArray | null;

        while (
            (match = scriptRe.exec(html)) !== null
        ) {
            scripts.push(
                match[1]
            );
        }

        let capturedConfig:
            any = null;

        const player:
            any = {
                setup:
                    function (config: any) {
                        capturedConfig =
                            config;

                        return player;
                    },
                on:
                    function () {
                        return player;
                    },
                once:
                    function () {
                        return player;
                    },
                getPlaylist:
                    function () {
                        return capturedConfig
                            ? [capturedConfig]
                            : [];
                    }
            };

        const jwplayer =
            function () {
                return player;
            };

        const storage:
            Record<string, string> = {};

        const localStorage =
            {
                getItem:
                    function (key: string) {
                        return storage[key] || null;
                    },
                setItem:
                    function (key: string, value: string) {
                        storage[key] =
                            value;
                    },
                removeItem:
                    function (key: string) {
                        delete storage[key];
                    }
            };

        const location =
            {
                href:
                    iframeUrl,
                protocol:
                    "https:",
                replace:
                    function () {}
            };

        const document:
            any = {
                body:
                    {
                        appendChild:
                            function () {},
                        removeChild:
                            function () {},
                        innerHTML:
                            ""
                    },
                currentScript:
                    {},
                domain:
                    new URL(
                        iframeUrl
                    ).hostname,
                documentElement:
                    {},
                createElement:
                    function () {
                        return {
                            setAttribute:
                                function () {},
                            appendChild:
                                function () {},
                            style:
                                {},
                            contentWindow:
                                {
                                    document:
                                        {
                                            createElement:
                                                function () {
                                                    return {
                                                        setAttribute:
                                                            function () {},
                                                        style:
                                                            {}
                                                    };
                                                },
                                            body:
                                                {
                                                    appendChild:
                                                        function () {}
                                                }
                                        }
                                }
                        };
                    },
                getElementById:
                    function (id: string) {
                        if (
                            id === "a"
                        ) {
                            return {
                                style:
                                    {},
                                innerHTML:
                                    "",
                                appendChild:
                                    function () {},
                                querySelector:
                                    function () {
                                        return null;
                                    }
                            };
                        }

                        return null;
                    },
                getElementsByClassName:
                    function () {
                        return [];
                    },
                getElementsByTagName:
                    function (tag: string) {
                        if (
                            tag === "script"
                        ) {
                            return [jsonScript];
                        }

                        return [];
                    },
                querySelector:
                    function (selector: string) {
                        if (
                            selector.indexOf(
                                "application/json"
                            ) !== -1
                        ) {
                            return jsonScript;
                        }

                        return null;
                    },
                querySelectorAll:
                    function (selector: string) {
                        if (
                            selector.indexOf(
                                "application/json"
                            ) !== -1
                        ) {
                            return [jsonScript];
                        }

                        return [];
                    },
                write:
                    function () {}
            };

        const window:
            any = {
                document,
                jwplayer,
                localStorage,
                location,
                parent:
                    {},
                screen:
                    {
                        availWidth:
                            1280,
                        availHeight:
                            720,
                        width:
                            1280,
                        height:
                            720
                    },
                navigator:
                    {
                        platform:
                            "Linux",
                        userAgent:
                            "Mozilla/5.0"
                    },
                addEventListener:
                    function () {},
                dispatchEvent:
                    function () {},
                focus:
                    function () {},
                open:
                    function () {
                        return {
                            closed:
                                true,
                            location:
                                {
                                    replace:
                                        function () {}
                                },
                            blur:
                                function () {}
                        };
                    },
                setInterval:
                    function () {
                        return 0;
                    },
                clearInterval:
                    function () {},
                setTimeout:
                    function () {
                        return 0;
                    },
                console:
                    {
                        log:
                            function () {},
                        warn:
                            function () {},
                        clear:
                            function () {}
                    }
            };

        const globalTarget:
            any =
                typeof globalThis === "object"
                    ? globalThis
                    : window;

        // Assign each sandbox global defensively: a host that defines one of
        // them as a getter-only property (Node does for `navigator`) makes a
        // bare assignment throw, and a throw here aborted the whole extraction
        // for that server.
        const assignStub =
            function (key: string, value: any) {
                try {
                    globalTarget[key] =
                        value;
                } catch (error) {
                    console.log(
                        "[VOIRANIME] VOE stub: cannot set global",
                        key
                    );
                }
            };

        assignStub(
            "window",
            window
        );
        assignStub(
            "document",
            document
        );
        assignStub(
            "navigator",
            window.navigator
        );
        assignStub(
            "location",
            location
        );
        assignStub(
            "localStorage",
            localStorage
        );
        assignStub(
            "jwplayer",
            jwplayer
        );
        assignStub(
            "self",
            window
        );
        assignStub(
            "top",
            window
        );
        assignStub(
            "parent",
            window.parent
        );
        assignStub(
            "$",
            function () {
                return {
                    detach:
                        function () {
                            return this;
                        },
                    insertAfter:
                        function () {
                            return this;
                        },
                    show:
                        function () {
                            return this;
                        }
                };
            }
        );

        const setTimeout =
            window.setTimeout;

        const setInterval =
            window.setInterval;

        const clearInterval =
            window.clearInterval;

        // Evaluate each script in the global (sloppy-mode) scope. A direct `eval`
        // inside a class body inherits strict mode, and the player loaders use
        // `delete` on bare identifiers — a SyntaxError that aborted the whole
        // extraction. `new Function` runs in script mode and still sees the
        // stubs published on globalThis just above.
        const runScript =
            function (source: string) {
                try {
                    const fn =
                        new Function(source);

                    fn();

                } catch (error) {
                    console.log(
                        "[VOIRANIME] VOE script eval failed:",
                        error
                    );
                }
            };

        for (
            const script of externalScripts
        ) {
            runScript(script);
        }

        for (
            const script of scripts
        ) {
            if (
                script.indexOf(
                    "import("
                ) !== -1
            ) {
                continue;
            }

            runScript(script);
        }

        const urls:
            string[] = [];

        const collect =
            function (value: any) {
                if (
                    !value
                ) {
                    return;
                }

                if (
                    typeof value === "string"
                ) {
                    if (
                        value.indexOf(".m3u8") !== -1 ||
                        value.indexOf(".mp4") !== -1
                    ) {
                        urls.push(value);
                    }

                    return;
                }

                if (
                    value.file
                ) {
                    collect(
                        value.file
                    );
                }

                if (
                    value.sources
                ) {
                    for (
                        const source of value.sources
                    ) {
                        collect(
                            source
                        );
                    }
                }

                if (
                    value.allSources
                ) {
                    for (
                        const source of value.allSources
                    ) {
                        collect(
                            source
                        );
                    }
                }
            };

        collect(
            capturedConfig
        );

        const seen:
            Record<string, boolean> = {};

        const videoSources:
            VideoSource[] = [];

        for (
            const url of urls
        ) {
            if (
                seen[url]
            ) {
                continue;
            }

            seen[url] =
                true;

            videoSources.push({
                url,
                type:
                    url.indexOf(".m3u8") !== -1
                        ? "m3u8" as VideoSourceType
                        : "mp4" as VideoSourceType,
                quality:
                    "voe - auto",
                subtitles:
                    []
            });
        }

        console.log(
            "[VOIRANIME] VOE video candidates:",
            videoSources.length
        );

        return videoSources;
    }

    /**
     * Collects the `document.getElementById('<id>link').innerHTML = <expr>;`
     * assignments, most trustworthy element first: `robotlink` and `botlink`
     * carry the real token (with the same token when both are present), while
     * `ideoolink` is planted as a decoy whose chain resolves to a broken path.
     */
    private collectStreamtapeExpressions(
        html: string
    ): string[] {
        const expressions: string[] = [];

        for (
            const elementId of ["robotlink", "botlink"]
        ) {
            const lineRegex =
                new RegExp(
                    "document\\.getElementById\\(\\s*[\"']" +
                    elementId +
                    "[\"']\\s*\\)\\.innerHTML\\s*=\\s*([^;]+);",
                    "i"
                );

            const lineMatch =
                html.match(lineRegex);

            if (
                lineMatch &&
                lineMatch[1]
            ) {
                expressions.push(
                    lineMatch[1].trim()
                );
            }
        }

        return expressions;
    }

    /**
     * Evaluates a page-supplied string expression the way a browser would:
     *   '//streamtape.com/'+ ('xcdget_video?id=…&token=…p').substring(2).substring(1)
     * The expression is first checked to contain nothing but quoted literals,
     * '+', parentheses and .substring()/.substr() calls with numeric arguments —
     * identifiers and property chains are refused, so no page-controlled code
     * can run.
     */
    private evaluateStringExpression(
        expression: string
    ): string {
        const allowed =
            /^(?:\s*(?:['"][^'"]*['"]|\(\s*(?:['"][^'"]*['"]\s*\+?\s*)+\)|\.\s*(?:substring|substr)\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\)|\+)\s*)+$/;

        if (
            !allowed.test(expression)
        ) {
            console.log(
                "[VOIRANIME][STAPE] Expression refused: unexpected tokens"
            );

            return "";
        }

        try {
            const value =
                new Function(
                    "return (" + expression + ");"
                )();

            return typeof value === "string"
                ? value
                : "";

        } catch (error) {
            console.log(
                "[VOIRANIME][STAPE] Expression evaluation failed:",
                String(error).slice(0, 120)
            );

            return "";
        }
    }

    private async extractStreamtapeSources(
        html: string,
        iframeUrl: string
    ): Promise<VideoSource[]> {

        console.log(
            "[VOIRANIME][STAPE] Starting extraction"
        );

        if (
            !html ||
            html.length < 100
        ) {
            console.log(
                "[VOIRANIME][STAPE] Empty or trivial HTML"
            );
            return [];
        }

        // Streamtape builds its file URL in a script assignment such as
        //   document.getElementById('robotlink').innerHTML =
        //     '//streamtape.com/'+ ('xcdget_video?id=…&token=…p').substring(2).substring(1)
        // Neither the element that carries the real link (robotlink or botlink —
        // ideoolink holds decoys) nor the splitting chain is stable: the literal
        // carries a random junk prefix and the number of chained .substring()
        // calls changes on every page load. Applying only the first .substring()
        // — what this parser used to do — produced 'dget_video' (HTTP 404) or a
        // bogus host such as 'stredamtape.com' (DNS failure on tapecontent.net),
        // so the expression is now evaluated exactly as a browser would.
        const expressions =
            this.collectStreamtapeExpressions(html);

        if (!expressions.length) {
            console.log(
                "[VOIRANIME][STAPE] No usable innerHTML assignment found"
            );
            return [];
        }

        const seenValues: string[] = [];

        for (const expression of expressions) {
            const value =
                this.evaluateStringExpression(expression);

            if (
                value &&
                seenValues.indexOf(value) === -1
            ) {
                seenValues.push(value);
            }
        }

        if (!seenValues.length) {
            console.log(
                "[VOIRANIME][STAPE] Expression parser matched nothing"
            );
            return [];
        }

        console.log(
            "[VOIRANIME][STAPE] Candidate URL(s):",
            seenValues.length
        );

        let directUrl = seenValues[0].trim();

        if (
            directUrl.startsWith("http")
        ) {
            // already absolute
        } else if (
            directUrl.startsWith("//")
        ) {
            directUrl = "https:" + directUrl;
        } else if (
            directUrl.startsWith("streamtape") ||
            directUrl.indexOf("streamtape") !== -1
        ) {
            directUrl =
                "https://" +
                directUrl.replace(/^\/+/, "");
        } else if (
            directUrl.startsWith("get_video") ||
            directUrl.startsWith("/get_video")
        ) {
            directUrl =
                "https://streamtape.com/" +
                directUrl.replace(/^\/+/, "");
        } else if (
            directUrl.startsWith("/")
        ) {
            // unknown leading '/…', prepend streamtape origin
            directUrl =
                "https://streamtape.com" + directUrl;
        } else {
            directUrl =
                "https://streamtape.com/" + directUrl;
        }

        // Sanitize legacy/recomposed TLDs ('streamtape.cdom', 'streamtape.ccom'…).
        directUrl = directUrl
            .replace(
                /streamtape\.[a-z]*dom/gi,
                "streamtape.com"
            )
            .replace(
                /streamtape\.c+om/gi,
                "streamtape.com"
            );

        if (
            directUrl.indexOf("&stream=1") === -1 &&
            directUrl.indexOf("?stream=1") === -1
        ) {
            directUrl += "&stream=1";
        }

        console.log(
            "[VOIRANIME][STAPE] Video parameters extracted"
        );

        // Try to resolve the 302 redirect to the actual MP4 on tapecontent.net.
        // Spec: don't trust proxyFetch().url — try HEAD via redirect:"follow" /
        // "manual" opportunistically, and don't bail if it isn't supported.
        let resolvedUrl = directUrl;

        try {
            const headResponse =
                await this.proxyFetch(
                    directUrl,
                    {
                        Referer: "https://streamtape.com/",
                        "User-Agent":
                            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
                    }
                );

            // Some proxy layers expose response.url with the final location.
            const candidateFinal =
                (headResponse as any).url as
                    string | undefined;

            if (
                candidateFinal &&
                typeof candidateFinal === "string" &&
                candidateFinal !== directUrl &&
                (
                    candidateFinal.indexOf(".mp4") !== -1 ||
                    candidateFinal.indexOf(".m3u8") !== -1
                )
            ) {
                resolvedUrl = candidateFinal;
                console.log(
                    "[VOIRANIME][STAPE] Redirect resolved"
                );
            } else {
                console.log(
                    "[VOIRANIME][STAPE] Redirect not exposed, using get_video URL"
                );
            }

        } catch (error) {
            console.log(
                "[VOIRANIME][STAPE] HEAD failed, using get_video URL:",
                String(error).slice(0, 120)
            );
        }

        const lowerUrl =
            resolvedUrl.toLowerCase();

        const type: VideoSourceType =
            lowerUrl.indexOf(".m3u8") !== -1
                ? "m3u8"
                : "mp4";

        console.log(
            "[VOIRANIME][STAPE] MP4 source found"
        );

        return [
            {
                url: resolvedUrl,
                type,
                quality:
                    "stape - auto",
                subtitles: []
            }
        ];
    }

    private buildCandidateServers(
        requestedServer: string
    ): string[] {

        if (
            this.SUPPORTED_SERVERS.indexOf(
                requestedServer
            ) !== -1
        ) {
            return [requestedServer];
        }

        return ["mytv"];
    }
/**
     * Search is served by the theme's own AJAX endpoint:
     *   POST /wp-admin/admin-ajax.php   action=wp-manga-search-manga & title=<q>
     *   → {"success":true,"data":[{"title":"Sousou no Frieren 2","url":"https://voir-anime.to/anime/sousou-no-frieren-2/","type":"video"}]}
     * That answer weighs ~500 bytes. The previous implementation parsed the whole
     * search page (~175 KB) and, when it found nothing, dropped the last word of
     * the query and downloaded the whole page again: "Sousou no Frieren: Beyond
     * Journey's End" cost 7 requests / 1.1 MB and ~20 s, and Seanime asks for
     * several title variants per entry. The HTML page is now only a fallback and a
     * single shortened retry replaces the word-by-word walk.
     */
    async search(
        opts: SearchOptions
    ): Promise<SearchResult[]> {

        const query =
            (opts.query || "").trim();

        if (
            !query
        ) {
            return [];
        }

        const cacheKey =
            query.toLowerCase() +
            (
                opts.dub
                    ? "|vf"
                    : "|vostfr"
            );

        const cached =
            this.searchCache[cacheKey];

        if (
            cached &&
            Date.now() - cached.at < this.SEARCH_TTL_MS
        ) {
            console.log(
                "[VOIRANIME] Search cache hit:",
                query
            );

            return cached.results;
        }

        const candidates =
            await this.searchCandidates(
                query
            );

        const results =
            this.rankCandidates(
                query,
                candidates,
                !!opts.dub
            );

        this.searchCache[cacheKey] = {
            at:
                Date.now(),
            results
        };

        return results;
    }

    /**
     * Candidate titles/URLs: AJAX first, then the HTML page once, then a single
     * retry on the part of the title preceding a subtitle separator.
     */
    private async searchCandidates(
        query: string
    ): Promise<{ title: string, url: string }[]> {

        const variants =
            this.searchVariants(
                query
            );

        // The AJAX endpoint answers in ~500 bytes, so every cheap variant is
        // tried before touching the search page (175 KB).
        for (const variant of variants) {
            const found =
                await this.searchViaAjax(
                    variant
                );

            if (
                found.length
            ) {
                return found;
            }
        }

        // Last resort: the endpoint matched none of the variants (it matches
        // leading words only, so "Solo Leveling 2" fails where "Solo Leveling"
        // returns both seasons), or it is down.
        for (const variant of variants) {
            const found =
                await this.searchViaPage(
                    variant
                );

            if (
                found.length
            ) {
                return found;
            }
        }

        return [];
    }

    /**
     * Cheap query variants, most specific first: the title as asked, the part
     * before a subtitle separator ("Mushoku Tensei: Jobless Reincarnation"), and
     * the title without a trailing season marker ("Solo Leveling 2").
     */
    private searchVariants(
        query: string
    ): string[] {
        const variants: string[] = [];

        const add =
            function (value: string) {
                const trimmed =
                    value.trim();

                if (
                    trimmed &&
                    variants.indexOf(trimmed) === -1
                ) {
                    variants.push(
                        trimmed
                    );
                }
            };

        add(query);

        add(
            query.split(/[:–—-]/)[0]
        );

        add(
            query.replace(
                /\s+(?:saison|season|part|partie)?\s*(?:\d{1,2}|ii|iii|iv)$/i,
                ""
            )
        );

        return variants;
    }

    private async searchViaAjax(
        query: string
    ): Promise<{ title: string, url: string }[]> {
        try {
            const response =
                await this.proxyFetch(
                    this.BASE_URL + "/wp-admin/admin-ajax.php",
                    {
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        Referer:
                            this.BASE_URL + "/",
                        "X-Requested-With":
                            "XMLHttpRequest"
                    },
                    "POST",
                    "action=wp-manga-search-manga&title=" + encodeURIComponent(query)
                );

            if (
                !response.ok
            ) {
                console.log(
                    "[VOIRANIME] AJAX search HTTP:",
                    response.status
                );

                return [];
            }

            let payload: any = null;

            try {
                payload =
                    JSON.parse(
                        await response.text()
                    );

            } catch (error) {
                console.log(
                    "[VOIRANIME] AJAX search: invalid JSON"
                );

                return [];
            }

            const items =
                payload && payload.data
                    ? payload.data
                    : [];

            const found: { title: string, url: string }[] = [];

            for (const item of items) {
                if (
                    found.length >= 20
                ) {
                    break;
                }

                if (
                    item &&
                    typeof item.url === "string" &&
                    typeof item.title === "string"
                ) {
                    found.push({
                        title:
                            item.title,
                        url:
                            item.url
                    });
                }
            }

            console.log(
                "[VOIRANIME] AJAX search:",
                query,
                found.length
            );

            return found;

        } catch (error) {
            console.log(
                "[VOIRANIME] AJAX search failed:",
                String(error).slice(0, 120)
            );

            return [];
        }
    }

    /** Fallback path: the search page itself (heavy — one request). */
    private async searchViaPage(
        query: string
    ): Promise<{ title: string, url: string }[]> {
        try {
            const searchUrl =
                new URL(
                    this.BASE_URL + "/"
                );

            searchUrl.searchParams.set(
                "s",
                query
            );

            searchUrl.searchParams.set(
                "post_type",
                "wp-manga"
            );

            const response =
                await this.proxyFetch(
                    searchUrl.toString()
                );

            if (
                !response.ok
            ) {
                return [];
            }

            const $ =
                await LoadDoc(
                    await response.text()
                );

            const rows =
                $(".c-tabs-item__content");

            const results =
                rows.length() > 0
                    ? rows
                    : $(".c-tabs-item");

            const found: { title: string, url: string }[] = [];

            for (
                let i = 0;
                i < results.length();
                i++
            ) {
                if (
                    found.length >= 20
                ) {
                    break;
                }

                const item =
                    results
                        .eq(i)
                        .find(".post-title a, .tab-summary .post-title a")
                        .first();

                const href =
                    item.attr("href") || "";

                const title =
                    item.text()
                        .trim();

                if (
                    href &&
                    title
                ) {
                    found.push({
                        title,
                        url:
                            href
                    });
                }
            }

            console.log(
                "[VOIRANIME] Page search:",
                query,
                found.length
            );

            return found;

        } catch (error) {
            console.log(
                "[VOIRANIME] Page search failed:",
                String(error).slice(0, 120)
            );

            return [];
        }
    }

    /** Dub/sub filtering + relevance scoring, shared by both search paths. */
    private rankCandidates(
        query: string,
        candidates: { title: string, url: string }[],
        wantsDub: boolean
    ): SearchResult[] {

        const seen: Record<string, boolean> = {};

        const items: { title: string, url: string, score: number, isDub: boolean }[] = [];

        const fallbackItems: { title: string, url: string, score: number, isDub: boolean }[] = [];

        for (const candidate of candidates) {
            const title =
                candidate.title.trim();

            const href =
                candidate.url;

            if (
                !href ||
                !title ||
                seen[href]
            ) {
                continue;
            }

            seen[href] = true;

            const detected =
                this.detectResultDub(
                    title,
                    href,
                    []
                );

            const isDub =
                detected === null
                    ? false
                    : detected;

            const entry = {
                title,
                url:
                    href,
                score:
                    this.scoreSearchResult(
                        query,
                        title,
                        href
                    ),
                isDub
            };

            console.log(
                "[VOIRANIME] Candidate:",
                title,
                href,
                "lang=" + (
                    isDub
                        ? "vf"
                        : "vostfr"
                ),
                "requested=" + (
                    wantsDub
                        ? "vf"
                        : "vostfr"
                )
            );

            if (
                wantsDub !== isDub
            ) {
                if (
                    wantsDub &&
                    !isDub
                ) {
                    fallbackItems.push(
                        entry
                    );
                }

                continue;
            }

            items.push(
                entry
            );
        }

        const byScore =
            (a: { score: number }, b: { score: number }) =>
                b.score - a.score;

        if (
            items.length === 0 &&
            fallbackItems.length > 0
        ) {
            console.log(
                "[VOIRANIME] No VF result found, falling back to VOSTFR"
            );

            return fallbackItems
                .sort(byScore)
                .slice(0, 10)
                .map(
                    item => ({
                        id:
                            item.url,
                        title:
                            item.title,
                        url:
                            item.url,
                        subOrDub:
                            "dub" as any
                    })
                );
        }

        return items
            .sort(byScore)
            .slice(0, 10)
            .map(
                item => ({
                    id:
                        item.url,
                    title:
                        item.title,
                    url:
                        item.url,
                    subOrDub:
                        (
                            item.isDub
                                ? "dub"
                                : "sub"
                        ) as any
                })
            );
    }

    async findEpisodes(
        id: string
    ): Promise<EpisodeDetails[]> {

        const page =
            await this.fetchPageCached(
                id
            );

        if (
            !page.ok
        ) {
            return [];
        }

        const $ =
            await LoadDoc(page.html);

        const links =
            $(".listing-chapters_wrap li.wp-manga-chapter a");

        const episodes:
            EpisodeDetails[] = [];

        for (
            let i = 0;
            i < links.length();
            i++
        ) {
            const link =
                links.eq(i);

            const href =
                link.attr("href") || "";

            const text =
                link.text()
                    .replace(/\s+/g, " ")
                    .trim();

            if (!href) {
                continue;
            }

            episodes.push({
                id:
                    href,
                url:
                    href,
                number:
                    this.parseEpisodeNumber(
                        text,
                        href
                    )
            });
        }

        episodes.sort(
            (a, b) =>
                a.number -
                b.number
        );

        console.log(
            "[VOIRANIME] Episodes:",
            episodes.length
        );

        return episodes;
    }

    async findEpisodeServer(
        episode: EpisodeDetails,
        _server: string
    ): Promise<EpisodeServer> {

        const requestedServer =
            (_server || "")
                .toLowerCase();

        const page =
            await this.fetchPageCached(
                episode.id
            );

        if (
            !page.ok
        ) {
            return <EpisodeServer>{
                headers: {},
                server: "",
                videoSources: []
            };
        }

        const html =
            page.html;

        const sources =
            this.parseChapterSources(
                html
            );

        const candidateServers =
            this.buildCandidateServers(
                requestedServer
            );

        for (
            const server of candidateServers
        ) {
            const iframeUrl =
                sources[server] ||
                "";

            if (
                !iframeUrl
            ) {
                console.log(
                    "[VOIRANIME] Server source missing:",
                    server
                );

                continue;
            }

            console.log(
                "[VOIRANIME] Iframe:",
                server,
                iframeUrl
            );

            const iframeResponse =
                await this.proxyFetch(
                    iframeUrl,
                    {
                        Referer:
                            episode.id
                    }
                );

            if (
                !iframeResponse.ok
            ) {
                console.log(
                    "[VOIRANIME] Iframe HTTP:",
                    server,
                    iframeResponse.status
                );

                continue;
            }

            let iframeHtml =
                await iframeResponse.text();

            let resolvedIframeUrl =
                iframeUrl;

            // Some hosts answer their embed URL with a stub whose only job is a
            // JS redirect to a rotating mirror domain (VOE: voe.sx ->
            // derricknationtop.com). The player markup exists only on the
            // mirror, so follow it before extracting.
            const redirected =
                await this.resolveJsRedirect(
                    iframeHtml,
                    iframeUrl
                );

            if (
                redirected
            ) {
                iframeHtml =
                    redirected.html;

                resolvedIframeUrl =
                    redirected.url;

                console.log(
                    "[VOIRANIME] Followed JS redirect:",
                    server,
                    resolvedIframeUrl
                );
            }

            const videoSources =
                await this.extractVideoSourcesFromHtml(
                    iframeHtml,
                    resolvedIframeUrl,
                    server
                );

            if (
                videoSources.length === 0
            ) {
                console.log(
                    "[VOIRANIME] Server returned no video source:",
                    server
                );

                continue;
            }

            const serverHeaders: Record<string, string> =
                server === "stape"
                    ? {
                        Referer: "https://streamtape.com/",
                        "User-Agent":
                            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
                    }
                    : {
                        referer:
                            new URL(
                                resolvedIframeUrl
                            ).origin + "/"
                    };

            return {
                headers: serverHeaders,
                server,
                videoSources
            };
        }

        console.log(
            "[VOIRANIME] No iframe source found"
        );

        return <EpisodeServer>{
            headers: {},
            server: "",
            videoSources: []
        };
    }
}
