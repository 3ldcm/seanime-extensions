/// <reference path="../_external/.onlinestream-provider.d.ts" />
/// <reference path="../_external/core.d.ts" />

const DevMode = true;
const originalConsoleLog = console.log;

console.log = function (...args: any[]) {
    if (DevMode) {
        originalConsoleLog.apply(console, args);
    }
};

interface AnimeSeason {
    title: string;
    url: string;
    status: "COMPLETED" | "UNKNOWN";
    thumbnail: string;
    description: string;
    genre: string;
}

class Provider {
    readonly BASE_URL = "https://anime-sama.to";
    readonly CATALOGUE_URL = "https://anime-sama.to/catalogue/";

    private readonly VOICES_VALUES = [
        "vostfr",
        "vf",
        "vf1",
        "vf2",
        "va",
        "vcn",
        "vj",
        "vkr",
        "vqc"
    ];

    private readonly SUPPORTED_SERVERS = [
        "ansembed"
    ];

    private static readonly TRAILING_SLASH_RE = /\/$/;
    private static readonly COMMENT_RE = /\/\*[\s\S]*?\*\/|\/\/.*$/gm;

    private static readonly SEASON_PANEL_RE =
        /panneauAnime\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;

    private static readonly MOVIE_NAME_RE =
        /^\s*newSPF\("([^"]+)"\)/gm;

    private static readonly FILEVER_RE =
        /episodes\.js\?filever=(\d+)/;

    private static readonly EPISODE_ARRAY_RE =
        /var\s+eps\w*\s*=\s*\[([\s\S]*?)\];/g;

    private static readonly EPISODE_URL_RE =
        /'(https?:\/\/[^']+)'/g;

    private static readonly VIDMOLY_RE =
        /vidmoly\.to/g;

    private static readonly SCRIPT_TAG_RE =
        /<script[^>]*>([\s\S]*?)<\/script>/gi;

    private static readonly PACKER_RE =
        /eval\(function\([^)]*\)\{[\s\S]*?\}\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/;

    private static readonly VIDEO_URL_RE =
        /(?:https?:\/\/|\/)[^\s'"]+\.(?:m3u8|mp4)(?:\?[^\s'"]*)?/g;

    private static readonly ESCAPED_VIDEO_URL_RE =
        /(?:https?:\\\/\\\/|\\\/)[^\s'"]+\.(?:m3u8|mp4)(?:\?[^\s'"]*)?/g;

    private static readonly ANSEMBED_FILE_RE =
        /file\s*:\s*["']?([^"',\s]+\.m3u8[^"',\s]*)["']?/i;

    private static readonly QUERY_SPLIT_RE =
        /[\s:']+/;

    _Server = "";

    getSettings(): Settings {
        return {
            episodeServers: this.SUPPORTED_SERVERS,
            supportsDub: true,
        };
    }

    /*
     * IMPORTANT
     * On ne repasse plus par /api/v1/proxy.
     * Ça évite le 401 UNAUTHENTICATED sur le LXC.
     */
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

    private stripComments(
        text: string
    ): string {
        return text.replace(
            Provider.COMMENT_RE,
            ""
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

    private getSlugFromUrl(
        url: string
    ): string {
        const clean =
            url
                .replace(
                    Provider.TRAILING_SLASH_RE,
                    ""
                )
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

        const slug =
            this.getSlugFromUrl(url);

        const normalizedSlug =
            this.normalizeTitle(
                slug.replace(/-/g, " ")
            );

        if (
            normalizedQuery === ""
        ) {
            return 0;
        }

        let score = 0;

        if (
            normalizedSlug ===
            normalizedQuery
        ) {
            score += 1000;
        }

        if (
            normalizedTitle ===
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

        if (
            normalizedTitle !== "" &&
            normalizedQuery.includes(
                normalizedTitle
            )
        ) {
            score += 250;
        }

        if (
            normalizedSlug !== "" &&
            normalizedQuery.includes(
                normalizedSlug
            )
        ) {
            score += 250;
        }

        const queryWords =
            normalizedQuery
                .split(" ")
                .filter(Boolean);

        const titleWords =
            new Set(
                normalizedTitle
                    .split(" ")
                    .filter(Boolean)
            );

        const slugWords =
            new Set(
                normalizedSlug
                    .split(" ")
                    .filter(Boolean)
            );

        let titleMatches = 0;
        let slugMatches = 0;

        for (
            const word of queryWords
        ) {
            if (
                titleWords.has(word)
            ) {
                titleMatches++;
            }

            if (
                slugWords.has(word)
            ) {
                slugMatches++;
            }
        }

        if (
            queryWords.length > 0
        ) {
            score += Math.round(
                (
                    titleMatches /
                    queryWords.length
                ) * 200
            );

            score += Math.round(
                (
                    slugMatches /
                    queryWords.length
                ) * 300
            );
        }

        return score;
    }

    private async fetchAnimeSeasons(
        rawAnimeUrl: string
    ): Promise<AnimeSeason[]> {

        try {
            const animeUrl =
                rawAnimeUrl.replace(
                    Provider.TRAILING_SLASH_RE,
                    ""
                );

            console.log(
                "[SEASONS] Anime URL:",
                animeUrl
            );

            const response =
                await this.proxyFetch(
                    animeUrl
                );

            console.log(
                "[SEASONS] HTTP status:",
                response.status
            );

            console.log(
                "[SEASONS] response.ok:",
                response.ok
            );

            if (!response.ok) {
                return [];
            }

            const html =
                await response.text();

            console.log(
                "[SEASONS] HTML length:",
                html.length
            );

            console.log(
                "[SEASONS] Contains panneauAnime:",
                html.includes(
                    "panneauAnime"
                )
            );

            const $ =
                await LoadDoc(html);

            const animeName =
                $("#titreOeuvre")
                    .text() || "";

            const thumbnail =
                $("#coverOeuvre")
                    .attr("src") || "";

            const description =
                $("h2:contains(synopsis)")
                    .next("p")
                    .text() || "";

            const genre =
                $("h2:contains(genres)")
                    .next("a")
                    .text() || "";

            console.log(
                "[SEASONS] Anime name:",
                animeName
            );

            const scripts =
                $("div.flex.flex-wrap")
                    .find("script")
                    .text();

            console.log(
                "[SEASONS] Script length:",
                scripts.length
            );

            console.log(
                "[SEASONS] Script contains panneauAnime:",
                scripts.includes(
                    "panneauAnime"
                )
            );

            const uncommented =
                this.stripComments(
                    scripts
                );

            const rawPanneaux: {
                seasonName: string;
                seasonStem: string;
            }[] = [];

            let match:
                RegExpExecArray | null;

            Provider.SEASON_PANEL_RE.lastIndex = 0;

            while (
                (
                    match =
                        Provider.SEASON_PANEL_RE.exec(
                            uncommented
                        )
                ) !== null
            ) {
                console.log(
                    "[SEASONS] panneauAnime match:",
                    match[1],
                    match[2]
                );

                rawPanneaux.push({
                    seasonName:
                        match[1],
                    seasonStem:
                        match[2]
                });
            }

            console.log(
                "[SEASONS] Raw seasons found:",
                rawPanneaux.length
            );

            const seenNames =
                new Set<string>();

            const dedupedPanneaux =
                rawPanneaux.filter(
                    ({ seasonName }) => {

                        if (
                            seenNames.has(
                                seasonName
                            )
                        ) {
                            return false;
                        }

                        seenNames.add(
                            seasonName
                        );

                        return true;
                    }
                );

            const seasonGroups =
                await Promise.all(
                    dedupedPanneaux.map(
                        async ({
                            seasonName,
                            seasonStem
                        }): Promise<AnimeSeason[]> => {

                            if (
                                seasonStem.includes(
                                    "film"
                                )
                            ) {
                                const moviesUrl =
                                    `${animeUrl}/${seasonStem}`;

                                const moviePlayers =
                                    await this.fetchPlayers(
                                        moviesUrl
                                    );

                                if (
                                    moviePlayers.length === 0
                                ) {
                                    return [];
                                }

                                const movieResponse =
                                    await this.proxyFetch(
                                        moviesUrl
                                    );

                                if (
                                    !movieResponse.ok
                                ) {
                                    return [];
                                }

                                const movieHtml =
                                    await movieResponse.text();

                                const movieNames:
                                    string[] = [];

                                let nameMatch:
                                    RegExpExecArray | null;

                                Provider.MOVIE_NAME_RE.lastIndex = 0;

                                while (
                                    (
                                        nameMatch =
                                            Provider.MOVIE_NAME_RE.exec(
                                                movieHtml
                                            )
                                    ) !== null
                                ) {
                                    movieNames.push(
                                        nameMatch[1]
                                    );
                                }

                                const movieSeasons:
                                    AnimeSeason[] = [];

                                for (
                                    let i = 0;
                                    i < moviePlayers.length;
                                    i++
                                ) {
                                    const title =
                                        movieNames.length > i
                                            ? `${animeName} ${movieNames[i]}`
                                            : moviePlayers.length === 1
                                                ? `${animeName} Film`
                                                : `${animeName} Film ${i + 1}`;

                                    movieSeasons.push({
                                        title,
                                        url:
                                            `${moviesUrl}#${i}`,
                                        status:
                                            "COMPLETED",
                                        thumbnail,
                                        description,
                                        genre
                                    });
                                }

                                return movieSeasons;
                            }

                            const seasonUrl =
                                `${animeUrl}/${seasonStem}`;

                            console.log(
                                "[SEASONS] Series season URL:",
                                seasonUrl
                            );

                            return [
                                {
                                    title:
                                        `${animeName} ${seasonName}`,
                                    url:
                                        seasonUrl,
                                    status:
                                        "UNKNOWN",
                                    thumbnail,
                                    description,
                                    genre
                                }
                            ];
                        }
                    )
                );

            const finalSeasons =
                seasonGroups.flat();

            console.log(
                "[SEASONS] Final seasons count:",
                finalSeasons.length
            );

            return finalSeasons;

        } catch (error) {
            console.error(
                "[SEASONS] ERROR:",
                error
            );

            return [];
        }
    }

    private async fetchEpisodesJs(
        seasonUrl: string
    ): Promise<{
        js: string;
        pageHtml: string;
    } | null> {

        const basePath =
            seasonUrl.replace(
                Provider.TRAILING_SLASH_RE,
                ""
            );

        const pageResponse =
            await this.proxyFetch(
                `${basePath}/`
            );

        console.log(
            "[EPISODES] Season page status:",
            pageResponse.status
        );

        if (!pageResponse.ok) {
            return null;
        }

        const pageHtml =
            await pageResponse.text();

        const fileverMatch =
            pageHtml.match(
                Provider.FILEVER_RE
            );

        const episodesJsUrl =
            fileverMatch
                ? `${basePath}/episodes.js?filever=${fileverMatch[1]}`
                : `${basePath}/episodes.js`;

        console.log(
            "[EPISODES] episodes.js:",
            episodesJsUrl
        );

        const jsResponse =
            await this.proxyFetch(
                episodesJsUrl
            );

        console.log(
            "[EPISODES] episodes.js status:",
            jsResponse.status
        );

        if (!jsResponse.ok) {
            return null;
        }

        return {
            js:
                await jsResponse.text(),
            pageHtml
        };
    }

    private parseEpisodeArrays(
        js: string
    ): string[][] {

        const episodeArrays:
            string[][] = [];

        let match:
            RegExpExecArray | null;

        Provider.EPISODE_ARRAY_RE.lastIndex = 0;

        while (
            (
                match =
                    Provider.EPISODE_ARRAY_RE.exec(
                        js
                    )
            ) !== null
        ) {
            const urls =
                (
                    match[1].match(
                        Provider.EPISODE_URL_RE
                    ) || []
                )
                    .map(
                        u =>
                            u
                                .slice(1, -1)
                                .replace(
                                    Provider.VIDMOLY_RE,
                                    "vidmoly.net"
                                )
                    );

            if (
                urls.length > 0
            ) {
                episodeArrays.push(
                    urls
                );
            }
        }

        console.log(
            "[EPISODES] Provider arrays:",
            episodeArrays.length
        );

        console.log(
            "[EPISODES] Array lengths:",
            episodeArrays.map(
                arr => arr.length
            )
        );

        return episodeArrays;
    }

    private groupEpisodesByIndex(
        episodeArrays: string[][]
    ): string[][] {

        if (
            episodeArrays.length === 0
        ) {
            return [];
        }

        const maxEpisodes =
            Math.max(
                ...episodeArrays.map(
                    arr => arr.length
                )
            );

        const groups:
            string[][] = [];

        for (
            let episodeIndex = 0;
            episodeIndex < maxEpisodes;
            episodeIndex++
        ) {
            const episodeUrls =
                episodeArrays
                    .map(
                        voiceArray =>
                            voiceArray[
                                episodeIndex
                            ]
                    )
                    .filter(
                        (
                            url
                        ): url is string =>
                            !!url
                    );

            if (
                episodeUrls.length > 0
            ) {
                groups.push(
                    episodeUrls
                );
            }
        }

        return groups;
    }

    private async fetchPlayers(
        url: string
    ): Promise<string[][]> {

        try {
            const result =
                await this.fetchEpisodesJs(
                    url
                );

            if (!result) {
                return [];
            }

            const episodeArrays =
                this.parseEpisodeArrays(
                    result.js
                );

            if (
                episodeArrays.length === 0
            ) {
                return [];
            }

            return this.groupEpisodesByIndex(
                episodeArrays
            );

        } catch (error) {
            console.error(
                "Error fetching players:",
                error
            );

            return [];
        }
    }

    private async HandleServerUrl(
        serverUrl: string
    ): Promise<VideoSource[]> {

        const req =
            await this.proxyFetch(
                serverUrl
            );

        if (!req.ok) {
            console.error(
                "Failed to fetch server URL:",
                serverUrl,
                "Status:",
                req.status
            );

            return [];
        }

        const html =
            await req.text();

        function unpack(
            p: string,
            a: number,
            c: number,
            k: string[]
        ): string {

            while (c--) {
                if (k[c]) {
                    p =
                        p.replace(
                            new RegExp(
                                "\\b" +
                                c.toString(a) +
                                "\\b",
                                "g"
                            ),
                            k[c]
                        );
                }
            }

            return p;
        }

        let unpacked:
            string | undefined;

        let match:
            RegExpExecArray | null;

        Provider.SCRIPT_TAG_RE.lastIndex = 0;

        while (
            (
                match =
                    Provider.SCRIPT_TAG_RE.exec(
                        html
                    )
            ) !== null
        ) {
            const script =
                match[1];

            if (
                script.includes(
                    "eval(function(p,a,c,k,e,d)"
                )
            ) {
                const unpackMatch =
                    script.match(
                        Provider.PACKER_RE
                    );

                if (unpackMatch) {
                    const packed =
                        unpackMatch[1];

                    const base =
                        parseInt(
                            unpackMatch[2],
                            10
                        );

                    const count =
                        parseInt(
                            unpackMatch[3],
                            10
                        );

                    const dict =
                        unpackMatch[4]
                            .split("|");

                    unpacked =
                        unpack(
                            packed,
                            base,
                            count,
                            dict
                        );

                    break;
                }
            }
        }

        const searchSource =
            unpacked
                ? `${html}\n${unpacked}`
                : html;

        const unescapedSearchSource =
            searchSource
                .replace(/\\\//g, "/")
                .replace(/\\u0026/g, "&");

        const videoUrls = [
            ...new Set<string>([
                ...(
                    searchSource.match(
                        Provider.ESCAPED_VIDEO_URL_RE
                    ) || []
                ).map(
                    url => url
                        .replace(/\\\//g, "/")
                        .replace(/\\u0026/g, "&")
                ),
                ...(
                    unescapedSearchSource.match(
                        Provider.VIDEO_URL_RE
                    ) || []
                )
            ])
        ];

        const videos:
            VideoSource[] = [];

        let origin = "";

        try {
            const urlObj =
                new URL(serverUrl);

            origin =
                urlObj.origin;

        } catch (error) {
            console.error(
                "Failed to parse server URL for origin:",
                serverUrl
            );
        }

        for (
            const url of videoUrls
        ) {
            let finalUrl =
                url;

            if (
                url.startsWith("/") &&
                !url.startsWith("//")
            ) {
                if (
                    origin === ""
                ) {
                    continue;
                }

                finalUrl =
                    origin + url;

            } else if (
                url.startsWith("//")
            ) {
                finalUrl =
                    `https:${url}`;
            }

            const type =
                finalUrl.includes(
                    ".m3u8"
                )
                    ? "m3u8"
                    : "mp4";

            videos.push({
                url:
                    finalUrl,
                type:
                    type as VideoSourceType,
                quality:
                    `${this._Server} - unknown`,
                subtitles:
                    []
            });
        }

        return videos;
    }

    private async HandleAnsEmbedUrl(
        serverUrl: string
    ): Promise<VideoSource[]> {

        if (
            this.isEmbed4meUrl(
                serverUrl
            )
        ) {
            return this.HandleEmbed4meUrl(
                serverUrl
            );
        }

        const req =
            await this.proxyFetch(
                serverUrl
            );

        if (!req.ok) {
            console.log(
                `[ANSEMBED] HTTP ${req.status}`
            );

            return [];
        }

        const html =
            await req.text();

        const lowerHtml =
            html.toLowerCase();

        console.log(
            `[ANSEMBED] HTML length: ${html.length}`
        );

        console.log(
            `[ANSEMBED] VidMoly markers: ${lowerHtml.includes("vidmoly")}`
        );

        console.log(
            `[ANSEMBED] JWPlayer markers: ${lowerHtml.includes("jwplayer")}`
        );

        console.log(
            `[ANSEMBED] file marker: ${/file\s*:/.test(html)}`
        );

        console.log(
            `[ANSEMBED] m3u8 marker: ${html.includes(".m3u8")}`
        );

        console.log(
            `[ANSEMBED] packed marker: ${html.includes("eval(function")}`
        );

        function unpack(
            p: string,
            a: number,
            c: number,
            k: string[]
        ): string {

            while (c--) {
                if (k[c]) {
                    p =
                        p.replace(
                            new RegExp(
                                "\\b" +
                                c.toString(a) +
                                "\\b",
                                "g"
                            ),
                            k[c]
                        );
                }
            }

            return p;
        }

        let unpacked:
            string | undefined;

        let match:
            RegExpExecArray | null;

        Provider.SCRIPT_TAG_RE.lastIndex = 0;

        while (
            (
                match =
                    Provider.SCRIPT_TAG_RE.exec(
                        html
                    )
            ) !== null
        ) {
            const script =
                match[1];

            if (
                script.includes(
                    "eval(function(p,a,c,k,e,d)"
                )
            ) {
                const unpackMatch =
                    script.match(
                        Provider.PACKER_RE
                    );

                if (unpackMatch) {
                    const packed =
                        unpackMatch[1];

                    const base =
                        parseInt(
                            unpackMatch[2],
                            10
                        );

                    const count =
                        parseInt(
                            unpackMatch[3],
                            10
                        );

                    const dict =
                        unpackMatch[4]
                            .split("|");

                    unpacked =
                        unpack(
                            packed,
                            base,
                            count,
                            dict
                        );

                    break;
                }
            }
        }

        let searchSource =
            html;

        if (unpacked) {
            searchSource +=
                "\n" + unpacked;
        }

        const unescapedSearchSource =
            searchSource
                .replace(/\\\//g, "/")
                .replace(/\\u0026/g, "&")
                .replace(/&amp;/g, "&");

        const fileMatch =
            unescapedSearchSource.match(
                Provider.ANSEMBED_FILE_RE
            );

        const videoUrls = [
            ...new Set<string>([
                ...(fileMatch
                    ? [fileMatch[1]]
                    : []),
                ...(
                    searchSource.match(
                        Provider.ESCAPED_VIDEO_URL_RE
                    ) || []
                ).map(
                    url => url
                        .replace(/\\\//g, "/")
                        .replace(/\\u0026/g, "&")
                        .replace(/&amp;/g, "&")
                ),
                ...(
                    unescapedSearchSource.match(
                        Provider.VIDEO_URL_RE
                    ) || []
                )
            ])
        ].filter(
            url => {
                const lowerUrl =
                    url.toLowerCase();

                return (
                    lowerUrl.includes(".m3u8") &&
                    !lowerUrl.includes("bigbuckbunny") &&
                    !lowerUrl.includes("sample")
                );
            }
        );

        const videos:
            VideoSource[] = [];

        const origin =
            new URL(serverUrl)
                .origin;

        for (
            const url of videoUrls
        ) {
            let finalUrl =
                url
                    .replace(/\\\//g, "/")
                    .replace(/\\u0026/g, "&")
                    .replace(/&amp;/g, "&");

            if (
                finalUrl.startsWith("/") &&
                !finalUrl.startsWith("//")
            ) {
                finalUrl =
                    origin +
                    finalUrl;

            } else if (
                finalUrl.startsWith("//")
            ) {
                finalUrl =
                    `https:${finalUrl}`;
            }

            const bestVariant =
                await this.resolveBestM3u8Variant(
                    finalUrl
                );

            videos.push({
                url:
                    bestVariant,
                type:
                    "m3u8" as VideoSourceType,
                quality:
                    "ansembed - auto",
                subtitles:
                    []
            });
        }

        return videos;
    }

    private async resolveBestM3u8Variant(
        playlistUrl: string
    ): Promise<string> {

        try {
            const response =
                await this.proxyFetch(
                    playlistUrl
                );

            if (!response.ok) {
                return playlistUrl;
            }

            const playlist =
                await response.text();

            const lines =
                playlist
                    .split(/\r?\n/)
                    .map(
                        line => line.trim()
                    );

            let pendingBandwidth = -1;
            let bestBandwidth = -1;
            let bestUrl = "";

            for (
                const line of lines
            ) {
                if (
                    line.startsWith(
                        "#EXT-X-STREAM-INF"
                    )
                ) {
                    const bandwidthMatch =
                        line.match(
                            /BANDWIDTH=(\d+)/i
                        );

                    pendingBandwidth =
                        bandwidthMatch
                            ? parseInt(
                                bandwidthMatch[1],
                                10
                            )
                            : 0;

                    continue;
                }

                if (
                    pendingBandwidth >= 0 &&
                    line !== "" &&
                    !line.startsWith("#")
                ) {
                    if (
                        pendingBandwidth >
                        bestBandwidth
                    ) {
                        bestBandwidth =
                            pendingBandwidth;

                        bestUrl =
                            new URL(
                                line,
                                playlistUrl
                            ).toString();
                    }

                    pendingBandwidth =
                        -1;
                }
            }

            return bestUrl || playlistUrl;

        } catch (error) {
            console.log(
                "[ANSEMBED] Failed to parse master playlist:",
                error
            );

            return playlistUrl;
        }
    }

    private isEmbed4meUrl(
        serverUrl: string
    ): boolean {
        try {
            const hostname =
                new URL(serverUrl)
                    .hostname
                    .toLowerCase();

            return (
                hostname === "lpayer.embed4me.com" ||
                hostname.endsWith(".embed4me.com") ||
                hostname === "embed4me.net" ||
                hostname.endsWith(".embed4me.net")
            );

        } catch (error) {
            return false;
        }
    }

    private getEmbed4meVideoId(
        serverUrl: string
    ): string {
        const hashMatch =
            serverUrl.match(
                /#([a-zA-Z0-9]+)/
            );

        if (hashMatch) {
            return hashMatch[1];
        }

        try {
            return new URL(serverUrl)
                .searchParams
                .get("id") || "";

        } catch (error) {
            return "";
        }
    }

    private hexToBytes(
        hex: string
    ): Uint8Array {
        const bytes =
            new Uint8Array(
                Math.floor(
                    hex.length / 2
                )
            );

        for (
            let index = 0;
            index < bytes.length;
            index++
        ) {
            bytes[index] =
                parseInt(
                    hex.slice(
                        index * 2,
                        index * 2 + 2
                    ),
                    16
                );
        }

        return bytes;
    }

    private stringToBytes(
        value: string
    ): Uint8Array {
        const bytes =
            new Uint8Array(
                value.length
            );

        for (
            let index = 0;
            index < value.length;
            index++
        ) {
            bytes[index] =
                value.charCodeAt(
                    index
                ) & 0xff;
        }

        return bytes;
    }

    private bytesToArrayBuffer(
        bytes: Uint8Array
    ): ArrayBuffer {
        return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset +
            bytes.byteLength
        ) as ArrayBuffer;
    }

    private utf8Decode(
        bytes: Uint8Array
    ): string {
        let result = "";
        let index = 0;

        while (
            index < bytes.length
        ) {
            const first =
                bytes[index++];

            if (
                first < 0x80
            ) {
                result +=
                    String.fromCharCode(
                        first
                    );

                continue;
            }

            if (
                first >= 0xc0 &&
                first < 0xe0 &&
                index < bytes.length
            ) {
                const second =
                    bytes[index++];

                result +=
                    String.fromCharCode(
                        (
                            (first & 0x1f) << 6
                        ) |
                        (
                            second & 0x3f
                        )
                    );

                continue;
            }

            if (
                first >= 0xe0 &&
                first < 0xf0 &&
                index + 1 < bytes.length
            ) {
                const second =
                    bytes[index++];

                const third =
                    bytes[index++];

                result +=
                    String.fromCharCode(
                        (
                            (first & 0x0f) << 12
                        ) |
                        (
                            (second & 0x3f) << 6
                        ) |
                        (
                            third & 0x3f
                        )
                    );

                continue;
            }

            if (
                first >= 0xf0 &&
                first < 0xf8 &&
                index + 2 < bytes.length
            ) {
                const second =
                    bytes[index++];

                const third =
                    bytes[index++];

                const fourth =
                    bytes[index++];

                let codePoint =
                    (
                        (first & 0x07) << 18
                    ) |
                    (
                        (second & 0x3f) << 12
                    ) |
                    (
                        (third & 0x3f) << 6
                    ) |
                    (
                        fourth & 0x3f
                    );

                codePoint -=
                    0x10000;

                result +=
                    String.fromCharCode(
                        0xd800 +
                        (
                            codePoint >> 10
                        ),
                        0xdc00 +
                        (
                            codePoint & 0x3ff
                        )
                    );

                continue;
            }

            result +=
                String.fromCharCode(
                    first
                );
        }

        return result;
    }

    private async decryptEmbed4mePayload(
        hexData: string
    ): Promise<string> {
        const keyBytes =
            this.stringToBytes(
                "kiemtienmua911ca"
            );

        const ivBytes =
            this.stringToBytes(
                "1234567890oiuytr"
            );

        const key =
            await crypto.subtle.importKey(
                "raw",
                this.bytesToArrayBuffer(
                    keyBytes
                ),
                {
                    name:
                        "AES-CBC"
                },
                false,
                [
                    "decrypt"
                ]
            );

        const encryptedData =
            this.hexToBytes(
                hexData
            );

        const decrypted =
            await crypto.subtle.decrypt(
                {
                    name:
                        "AES-CBC",
                    iv:
                        this.bytesToArrayBuffer(
                            ivBytes
                        )
                },
                key,
                this.bytesToArrayBuffer(
                    encryptedData
                )
            );

        return this.utf8Decode(
            new Uint8Array(
                decrypted
            )
        );
    }

    private async HandleEmbed4meUrl(
        serverUrl: string
    ): Promise<VideoSource[]> {
        const videoId =
            this.getEmbed4meVideoId(
                serverUrl
            );

        if (
            videoId === ""
        ) {
            console.log(
                "[ANSEMBED] embed4me video id not found"
            );

            return [];
        }

        const apiUrl =
            `https://lpayer.embed4me.com/api/v1/video?id=${videoId}&w=1920&h=1080&r=https://lpayer.embed4me.com/`;

        try {
            const response =
                await this.proxyFetch(
                    apiUrl,
                    {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Referer":
                            "https://lpayer.embed4me.com/"
                    }
                );

            if (!response.ok) {
                console.log(
                    `[ANSEMBED] embed4me API HTTP ${response.status}`
                );

                return [];
            }

            const rawPayload =
                (
                    await response.text()
                )
                    .trim()
                    .replace(/^"|"$/g, "");

            if (
                !/^[0-9a-f]+$/i.test(
                    rawPayload
                )
            ) {
                console.log(
                    "[ANSEMBED] embed4me API returned non-hex payload"
                );

                return [];
            }

            const decryptedPayload =
                await this.decryptEmbed4mePayload(
                    rawPayload
                );

            const data =
                JSON.parse(
                    decryptedPayload
                );

            const source =
                data.cfNative ||
                data.cf ||
                data.source ||
                "";

            if (
                typeof source !== "string" ||
                source === ""
            ) {
                console.log(
                    "[ANSEMBED] embed4me source missing"
                );

                return [];
            }

            const bestVariant =
                await this.resolveBestM3u8Variant(
                    source
                );

            return [
                {
                    url:
                        bestVariant,
                    type:
                        "m3u8" as VideoSourceType,
                    quality:
                        "embed4me - auto",
                    subtitles:
                        []
                }
            ];

        } catch (error) {
            console.log(
                "[ANSEMBED] embed4me extraction failed:",
                error
            );

            return [];
        }
    }

    async search(
        opts: SearchOptions
    ): Promise<SearchResult[]> {

        let tempquery =
            opts.query;

        while (
            tempquery !== ""
        ) {
            console.log(
                `[SEARCH] Query: "${tempquery}"`
            );

            const searchUrl =
                new URL(
                    this.CATALOGUE_URL
                );

            searchUrl.searchParams.set(
                "search",
                tempquery
            );

            searchUrl.searchParams.set(
                "page",
                "1"
            );

            const response =
                await fetch(
                    searchUrl.toString()
                );

            console.log(
                "[SEARCH] HTTP status:",
                response.status
            );

            console.log(
                "[SEARCH] response.ok:",
                response.ok
            );

            if (
                !response.ok
            ) {
                tempquery =
                    tempquery
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

            const searchResults =
                $("#list_catalog > div a");

            if (
                searchResults.length() <=
                0
            ) {
                console.log(
                    "[SEARCH] No results"
                );

                tempquery =
                    tempquery
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

            console.log(
                "[SEARCH] Results found:",
                searchResults.length()
            );

            let bestAnimeUrl =
                "";

            let bestTitle =
                "";

            let bestScore =
                -1;

            for (
                let i = 0;
                i <
                searchResults.length();
                i++
            ) {
                const result =
                    searchResults.eq(i);

                const href =
                    result.attr(
                        "href"
                    ) || "";

                if (!href) {
                    continue;
                }

                const resultTitle =
                    result.text() || "";

                const score =
                    this.scoreSearchResult(
                        tempquery,
                        resultTitle,
                        href
                    );

                console.log(
                    `[SEARCH] Candidate ${i}:`,
                    resultTitle.trim(),
                    href,
                    score
                );

                if (
                    score >
                    bestScore
                ) {
                    bestScore =
                        score;

                    bestAnimeUrl =
                        href;

                    bestTitle =
                        resultTitle.trim();
                }
            }

            if (
                !bestAnimeUrl
            ) {
                return [];
            }

            console.log(
                "[SEARCH] Selected:",
                bestTitle,
                bestAnimeUrl,
                bestScore
            );

            const seasons =
                await this.fetchAnimeSeasons(
                    bestAnimeUrl
                );

            if (
                seasons.length === 0
            ) {
                console.log(
                    "[SEARCH] Selected candidate has no seasons:",
                    bestAnimeUrl
                );

                return [];
            }

            return await Promise.all(
                seasons.map(
                    async (
                        season:
                            AnimeSeason
                    ): Promise<SearchResult> => {

                        let finalUrl =
                            season.url;

                        if (
                            opts.dub &&
                            !finalUrl.includes(
                                "film"
                            )
                        ) {
                            const dubUrl =
                                finalUrl.replace(
                                    "/vostfr",
                                    "/vf"
                                );

                            const dubResponse =
                                await this.proxyFetch(
                                    dubUrl
                                );

                            if (
                                dubResponse.ok
                            ) {
                                finalUrl =
                                    dubUrl;

                            } else {
                                const vf1Url =
                                    dubUrl + "1";

                                const vf1Response =
                                    await this.proxyFetch(
                                        vf1Url
                                    );

                                if (
                                    vf1Response.ok
                                ) {
                                    finalUrl =
                                        vf1Url;
                                }
                            }
                        }

                        return {
                            id:
                                finalUrl,
                            title:
                                season.title,
                            url:
                                finalUrl,
                            subOrDub:
                                opts.dub
                                    ? "dub"
                                    : "sub",
                        };
                    }
                )
            );
        }

        return [];
    }

    async findEpisodes(
        id: string
    ): Promise<EpisodeDetails[]> {

        const animeUrl =
            id.split("#")[0];

        const movieIndex =
            id.split("#")[1];

        const result =
            await this.fetchEpisodesJs(
                animeUrl
            );

        if (!result) {
            console.error(
                "Failed to fetch episodes.js"
            );

            return [];
        }

        const episodesText =
            result.js;

        const episodeDetails:
            EpisodeDetails[] = [];

        const episodeArrays =
            this.parseEpisodeArrays(
                episodesText
            );

        if (
            episodeArrays.length === 0
        ) {
            return [];
        }

        if (
            movieIndex !== undefined
        ) {
            const movieIdx =
                parseInt(
                    movieIndex,
                    10
                );

            const movieUrls:
                string[] = [];

            for (
                const voiceArray
                of episodeArrays
            ) {
                if (
                    voiceArray[
                        movieIdx
                    ]
                ) {
                    movieUrls.push(
                        voiceArray[
                            movieIdx
                        ]
                    );
                }
            }

            if (
                movieUrls.length >
                0
            ) {
                return [
                    {
                        id:
                            movieUrls.join(
                                ","
                            ),
                        url:
                            id,
                        number:
                            1
                    }
                ];
            }

            return [];
        }

        const groups =
            this.groupEpisodesByIndex(
                episodeArrays
            );

        console.log(
            "[EPISODES] Video groups:",
            groups.length
        );

        groups.forEach(
            (
                episodeUrls,
                episodeIndex
            ) => {

                const number =
                    episodeIndex + 1;

                console.log(
                    `[EPISODES] Group ${episodeIndex} => episode ${number}`,
                    episodeUrls
                );

                episodeDetails.push({
                    id:
                        episodeUrls.join(
                            ","
                        ),
                    url:
                        id,
                    number
                });
            }
        );

        console.log(
            "[EPISODES] Returned numbers:",
            episodeDetails.map(
                e => e.number
            )
        );

        return episodeDetails;
    }

    async findEpisodeServer(
        episode: EpisodeDetails,
        _server: string
    ): Promise<EpisodeServer> {

        this._Server =
            "ansembed";

        const servers: string[] = [
            ...new Set<string>(
                episode.id
                    .split(",")
                    .map(
                        (url: string) => url.trim()
                    )
                    .filter(
                        (url: string) => url !== ""
                    )
            )
        ];

        const serverUrl =
            servers.find(
                url => {
                    try {
                        const hostname =
                            new URL(url)
                                .hostname
                                .toLowerCase();

                        return (
                            hostname ===
                            "ansembed.net" ||
                            hostname.endsWith(
                                ".ansembed.net"
                            ) ||
                            hostname ===
                            "lpayer.embed4me.com" ||
                            hostname.endsWith(
                                ".embed4me.com"
                            ) ||
                            hostname ===
                            "embed4me.net" ||
                            hostname.endsWith(
                                ".embed4me.net"
                            )
                        );

                    } catch (error) {
                        return false;
                    }
                }
            );

        if (!serverUrl) {
            console.log(
                "[ANSEMBED] No AnsEmbed URL for this episode"
            );

            return <EpisodeServer>{
                headers: {},
                server: "",
                videoSources: []
            };
        }

        console.log(
            `[ANSEMBED] Handling: ${serverUrl}`
        );

        const videoSources =
            await this.HandleAnsEmbedUrl(
                serverUrl
            );

        if (
            videoSources.length ===
            0
        ) {
            console.log(
                "[ANSEMBED] No playable video source found"
            );

            return <EpisodeServer>{
                headers: {},
                server: "",
                videoSources: []
            };
        }

        const referer =
            new URL(serverUrl)
                .origin +
            "/";

        return {
            headers: {
                referer
            },
            server:
                "ansembed",
            videoSources
        };
    }
}
