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
        "mytv"
    ];

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
        headers?: Record<string, string>
    ): Promise<Response> {
        if (!headers) {
            return fetch(targetUrl);
        }

        return fetch(
            targetUrl,
            {
                headers
            }
        );
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

    private extractVideoSourcesFromHtml(
        html: string,
        iframeUrl: string
    ): VideoSource[] {
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
                    "mytv - auto",
                subtitles:
                    []
            })
        );
    }

    async search(
        opts: SearchOptions
    ): Promise<SearchResult[]> {

        let tempQuery =
            opts.query;

        while (
            tempQuery !== ""
        ) {
            const searchUrl =
                new URL(
                    this.BASE_URL + "/"
                );

            searchUrl.searchParams.set(
                "s",
                tempQuery
            );

            searchUrl.searchParams.set(
                "post_type",
                "wp-manga"
            );

            console.log(
                "[VOIRANIME] Search:",
                searchUrl.toString()
            );

            const response =
                await this.proxyFetch(
                    searchUrl.toString()
                );

            if (
                !response.ok
            ) {
                tempQuery =
                    tempQuery
                        .split(
                            Provider.QUERY_SPLIT_RE
                        )
                        .slice(
                            0,
                            -1
                        )
                        .join(" ");

                continue;
            }

            const html =
                await response.text();

            const $ =
                await LoadDoc(html);

            const results =
                $(".c-tabs-item .post-title a, .tab-summary .post-title a");

            const seen:
                Record<string, boolean> = {};

            const items: {
                title: string;
                url: string;
                score: number;
            }[] = [];

            for (
                let i = 0;
                i < results.length();
                i++
            ) {
                const item =
                    results.eq(i);

                const href =
                    item.attr("href") || "";

                const title =
                    item.text()
                        .trim();

                if (
                    !href ||
                    !title ||
                    seen[href]
                ) {
                    continue;
                }

                seen[href] =
                    true;

                const isDub =
                    title.toLowerCase()
                        .includes("(vf)") ||
                    href.toLowerCase()
                        .includes("-vf/");

                if (
                    opts.dub !== isDub
                ) {
                    continue;
                }

                items.push({
                    title,
                    url:
                        href,
                    score:
                        this.scoreSearchResult(
                            tempQuery,
                            title,
                            href
                        )
                });
            }

            if (
                items.length === 0
            ) {
                tempQuery =
                    tempQuery
                        .split(
                            Provider.QUERY_SPLIT_RE
                        )
                        .slice(
                            0,
                            -1
                        )
                        .join(" ");

                continue;
            }

            return items
                .sort(
                    (a, b) =>
                        b.score -
                        a.score
                )
                .slice(
                    0,
                    10
                )
                .map(
                    item => ({
                        id:
                            item.url,
                        title:
                            item.title,
                        url:
                            item.url,
                        subOrDub:
                            opts.dub
                                ? "dub"
                                : "sub"
                    })
                );
        }

        return [];
    }

    async findEpisodes(
        id: string
    ): Promise<EpisodeDetails[]> {

        const response =
            await this.proxyFetch(
                id
            );

        if (
            !response.ok
        ) {
            return [];
        }

        const html =
            await response.text();

        const $ =
            await LoadDoc(html);

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
            (_server || "mytv")
                .toLowerCase();

        const response =
            await this.proxyFetch(
                episode.id
            );

        if (
            !response.ok
        ) {
            return <EpisodeServer>{
                headers: {},
                server: "",
                videoSources: []
            };
        }

        const html =
            await response.text();

        const sources =
            this.parseChapterSources(
                html
            );

        const iframeUrl =
            sources[requestedServer] ||
            sources.mytv ||
            "";

        if (
            !iframeUrl
        ) {
            console.log(
                "[VOIRANIME] No iframe source found"
            );

            return <EpisodeServer>{
                headers: {},
                server: "",
                videoSources: []
            };
        }

        console.log(
            "[VOIRANIME] Iframe:",
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
                iframeResponse.status
            );

            return <EpisodeServer>{
                headers: {},
                server: "",
                videoSources: []
            };
        }

        const iframeHtml =
            await iframeResponse.text();

        const videoSources =
            this.extractVideoSourcesFromHtml(
                iframeHtml,
                iframeUrl
            );

        return {
            headers: {
                referer:
                    new URL(
                        iframeUrl
                    ).origin + "/"
            },
            server:
                requestedServer,
            videoSources
        };
    }
}
