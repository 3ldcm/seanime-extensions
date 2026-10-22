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
        // "sibnet",  // disabled 2026-10-14: Anime-Sama serves a placeholder
        //             // short MP4 instead of the real episode. Fix expected
        //             // in 1-2 months. Re-enable once validated.
        "vk",
        // "sendvid", // disabled: Anime-Sama can return a 5-second placeholder
        // video which Seanime treats as a valid episode.
        "vidmoly",
        "movearnpre",
        "oneupload",
        "uqload",
        "stape",
        "embed4me",
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

    // `//host/path.m3u8` — VIDEO_URL_RE captures only the tail after the first
    // slash, and the loop would then re-root it on the *embed* host, inventing a
    // URL that does not exist. Matched separately and normalised to https://.
    private static readonly PROTOCOL_RELATIVE_VIDEO_URL_RE =
        /\/\/[^\s'"]+\.(?:m3u8|mp4)(?:\?[^\s'"]*)?/g;

    private static readonly ESCAPED_VIDEO_URL_RE =
        /(?:https?:\\\/\/\\\/|\/\/)[^\s'"]+\.(?:m3u8|mp4)(?:\?[^\s'"]*)?/g;

    // JWPlayer setup({sources: [{file: "URL_HLS"}]})
    private static readonly JWPLAYER_FILE_RE =
        /sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/gi;

    private static readonly QUERY_SPLIT_RE =
        /[\s:']+/;

    // Sample clips some embedders ship alongside the real stream (test mirrors
    // embed Big Buck Bunny). Seanime would "play" 10 s of it and call the
    // extraction a success, so they are dropped — same rule the download tool
    // applies in its ansembed/vidhide extractors.
    private static readonly DECOY_VIDEO_RE =
        /test-videos\.co\.uk|bigbuckbunny|sample-videos/i;

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
        timeoutSeconds?: number,
        referer?: string
    ): Promise<Response> {
        const init:
            any = {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
                    Referer:
                        referer || this.deriveReferer(targetUrl)
                }
            };

        if (
            timeoutSeconds &&
            timeoutSeconds > 0
        ) {
            // Seanime honours `timeout` (in seconds) in its fetch options; the
            // standard AbortSignal covers the same ground outside the sandbox.
            // Without a cap, an unresponsive embed host leaves the user staring
            // at a spinner for minutes.
            init.timeout =
                timeoutSeconds;

            if (
                typeof AbortSignal !== "undefined" &&
                typeof (AbortSignal as any).timeout === "function"
            ) {
                init.signal =
                    (AbortSignal as any).timeout(
                        timeoutSeconds * 1000
                    );
            }
        }

        return fetch(
            targetUrl,
            init
        );
    }

    /**
     * anime-sama serves its assets only when a Referer is present: episodes.js
     * answers HTTP 403 without one, which silently emptied the whole episode
     * list (findEpisodes returned []). Embed hosts expect a Referer too, usually
     * their own origin. Derive it from the target URL: the directory the file
     * lives in, which for `<season>/episodes.js` is exactly the season page a
     * browser would send.
     */
    private deriveReferer(
        targetUrl: string
    ): string {
        try {
            const url =
                new URL(targetUrl);

            return url.origin +
                url.pathname.replace(/\/[^/]*$/, "/");

        } catch (error) {
            return this.BASE_URL + "/";
        }
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

    private getServerName(
        serverUrl: string
    ): string {
        try {
            const hostname =
                new URL(serverUrl)
                    .hostname
                    .toLowerCase();

            if (
                hostname === "video.sibnet.ru" ||
                hostname === "sibnet.ru" ||
                hostname.endsWith(".sibnet.ru")
            ) {
                return "sibnet";
            }

            if (
                hostname === "vk.com" ||
                hostname.endsWith(".vk.com") ||
                hostname.includes("vkvideo")
            ) {
                return "vk";
            }

            if (
                hostname === "sendvid.com" ||
                hostname.endsWith(".sendvid.com")
            ) {
                return "sendvid";
            }

            if (
                hostname === "vidmoly.to" ||
                hostname.endsWith(".vidmoly.to")
            ) {
                return "vidmoly";
            }

            if (
                hostname.includes("movearnpre")
            ) {
                return "movearnpre";
            }

            if (
                hostname === "oneupload.to" ||
                hostname.endsWith(".oneupload.to")
            ) {
                return "oneupload";
            }

            if (
                hostname === "embed4me.net" ||
                hostname.endsWith(".embed4me.net")
            ) {
                return "embed4me";
            }

            if (
                hostname === "ansembed.net" ||
                hostname.endsWith(".ansembed.net")
            ) {
                return "ansembed";
            }

            // HLS embedder network (callistanise, minochinos, vidhide, etc.)
            if (
                hostname === "callistanise.com" ||
                hostname.endsWith(".callistanise.com") ||
                hostname === "minochinos.com" ||
                hostname.endsWith(".minochinos.com") ||
                hostname === "pixibay.cc" ||
                hostname.endsWith(".pixibay.cc")
            ) {
                return "stape";
            }

            if (
                hostname === "uqload.vc" ||
                hostname.endsWith(".uqload.vc") ||
                hostname === "uqload.com" ||
                hostname.endsWith(".uqload.com")
            ) {
                return "uqload";
            }

            return hostname
                .split(".")
                .filter(Boolean)
                .slice(-2, -1)[0] || hostname;

        } catch (error) {
            return "";
        }
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

    /**
     * Embed4me hides its stream behind an API call and an AES-CBC payload:
     *   GET https://lpayer.embed4me.com/api/v1/video?id=<id>&w=1920&h=1080&r=<origin>
     *   → a hex string, decrypted with AES-CBC(key, iv) into
     *   {"cfNative": "<m3u8>", …} (the two constants are the player's own).
     * The embed URL carries the id in its fragment (`https://…/#ebsnp`).
     * The host was unreachable from the machine this was written on, so the
     * contract is exercised by a unit test against a locally produced
     * ciphertext rather than a live call. The request is capped with a timeout:
     * without one, an unresponsive host left the user waiting minutes for
     * nothing (observed: 134 s, no source).
     */
    private async extractEmbed4meSources(
        serverUrl: string
    ): Promise<VideoSource[]> {

        const idMatch =
            serverUrl.match(
                /#([A-Za-z0-9]+)/
            ) ||
            serverUrl.match(
                /[?&]id=([A-Za-z0-9]+)/
            );

        if (!idMatch) {
            console.log(
                "[ANIMESAMA][EMBED4ME] No video id in",
                serverUrl
            );

            return [];
        }

        const subtle =
            (globalThis as any).crypto ?
                (globalThis as any).crypto.subtle :
                undefined;

        if (!subtle) {
            console.log(
                "[ANIMESAMA][EMBED4ME] crypto.subtle unavailable, cannot decrypt"
            );

            return [];
        }

        const apiUrl =
            "https://lpayer.embed4me.com/api/v1/video?id=" +
            idMatch[1] +
            "&w=1920&h=1080&r=" +
            encodeURIComponent(
                "https://lpayer.embed4me.com/"
            );

        let payload: string;

        try {
            const response =
                await this.proxyFetch(
                    apiUrl,
                    15,
                    // The player calls its own API from the embed page root.
                    "https://lpayer.embed4me.com/"
                );

            if (!response.ok) {
                console.log(
                    "[ANIMESAMA][EMBED4ME] API status:",
                    response.status
                );

                return [];
            }

            payload =
                (await response.text())
                    .trim()
                    .replace(
                        /^"|"$/g,
                        ""
                    );

        } catch (error) {
            console.log(
                "[ANIMESAMA][EMBED4ME] API unreachable:",
                String(error).slice(0, 120)
            );

            return [];
        }

        const plain =
            await this.decryptAesCbcHex(
                payload,
                "kiemtienmua911ca",
                "1234567890oiuytr"
            );

        if (!plain) {
            return [];
        }

        let data:
            any;

        try {
            data =
                JSON.parse(plain);

        } catch (error) {
            console.log(
                "[ANIMESAMA][EMBED4ME] Decrypted payload is not JSON:",
                plain.slice(0, 80)
            );

            return [];
        }

        const url =
            data?.cfNative ||
            data?.cf ||
            data?.source;

        if (
            typeof url !== "string" ||
            url.length === 0
        ) {
            console.log(
                "[ANIMESAMA][EMBED4ME] No stream field in the payload"
            );

            return [];
        }

        return [
            {
                url,
                type:
                    url.includes(".m3u8") ?
                        "m3u8" as VideoSourceType :
                        "mp4" as VideoSourceType,
                quality: "auto",
                subtitles: []
            }
        ];
    }

    /**
     * AES-CBC over a hex payload, through Web Crypto. Returns "" on any
     * failure so the caller can just log and give up.
     */
    private async decryptAesCbcHex(
        hex: string,
        keyText: string,
        ivText: string
    ): Promise<string> {

        const subtle =
            (globalThis as any).crypto ?
                (globalThis as any).crypto.subtle :
                undefined;

        if (!subtle) {
            return "";
        }

        const clean =
            hex.replace(
                /[^0-9a-fA-F]/g,
                ""
            );

        if (
            clean.length === 0 ||
            clean.length % 2 !== 0
        ) {
            console.log(
                "[ANIMESAMA][EMBED4ME] Payload is not valid hex"
            );

            return "";
        }

        const toBytes =
            (value: string): Uint8Array => {
                const bytes =
                    new Uint8Array(
                        value.length
                    );

                for (
                    let i = 0;
                    i < value.length;
                    i++
                ) {
                    bytes[i] =
                        value.charCodeAt(i) & 0xff;
                }

                return bytes;
            };

        const cipher =
            new Uint8Array(
                clean.length / 2
            );

        for (
            let i = 0;
            i < cipher.length;
            i++
        ) {
            cipher[i] =
                parseInt(
                    clean.substring(
                        i * 2,
                        i * 2 + 2
                    ),
                    16
                );
        }

        try {
            const key =
                await subtle.importKey(
                    "raw",
                    toBytes(keyText),
                    {
                        name: "AES-CBC"
                    },
                    false,
                    ["decrypt"]
                );

            const plainBuffer =
                await subtle.decrypt(
                    {
                        name: "AES-CBC",
                        iv: toBytes(ivText)
                    },
                    key,
                    cipher
                );

            const bytes =
                new Uint8Array(
                    plainBuffer
                );

            if (
                typeof TextDecoder !== "undefined"
            ) {
                return new TextDecoder().decode(bytes);
            }

            // The payload is a JSON of URLs, i.e. ASCII in practice.
            let out = "";

            for (
                let i = 0;
                i < bytes.length;
                i++
            ) {
                out +=
                    String.fromCharCode(bytes[i]);
            }

            return out;

        } catch (error) {
            console.log(
                "[ANIMESAMA][EMBED4ME] Decrypt failed:",
                String(error).slice(0, 120)
            );

            return "";
        }
    }

    private async HandleServerUrl(
        serverUrl: string
    ): Promise<VideoSource[]> {

        // Callistanise / minochinos / pixibay embedders hide the HLS
        // master URL behind an obfuscated script whose only side-channel
        // is a pipe-separated token array embedded in the HTML.
        if (
            this._Server === "hlsembed" ||
            this._Server === "stape"
        ) {
            return this.extractHlsembedSources(
                serverUrl
            );
        }

        // Embed4me never exposes the stream in its embed page: the id in the URL
        // fragment is traded for an AES-CBC payload on an API endpoint.
        if (
            this._Server === "embed4me"
        ) {
            return this.extractEmbed4meSources(
                serverUrl
            );
        }

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

        /**
         * The packer replaces a dictionary index with a word, using the index
         * written in the dictionary's base. `Number.prototype.toString(radix)`
         * only accepts 2..36, while packers routinely use base 62 — calling
         * `c.toString(62)` throws "radix argument must be between 2 and 36" and
         * that exception aborted the whole extraction (observed live on
         * ansembed.net, where the m3u8 sits in plain sight in the page).
         */
        function encodeBase(
            number: number,
            radix: number
        ): string {

            const alphabet =
                "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

            if (
                radix < 2 ||
                radix > alphabet.length ||
                !isFinite(number)
            ) {
                return String(number);
            }

            if (
                number === 0
            ) {
                return "0";
            }

            let result = "";
            let current = number;

            while (
                current > 0
            ) {
                result =
                    alphabet[current % radix] +
                    result;

                current =
                    Math.floor(current / radix);
            }

            return result;
        }

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
                                encodeBase(c, a) +
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
                        (() => {
                            try {
                                return unpack(
                                    packed,
                                    base,
                                    count,
                                    dict
                                );

                            } catch (error) {
                                // A malformed packer header must not abort the
                                // extraction: the raw HTML still gets scanned
                                // below (that is where ansembed keeps its m3u8).
                                console.log(
                                    "[ANIMESAMA] Packer unpack failed, scanning raw HTML only:",
                                    String(error).slice(0, 120)
                                );

                                return undefined;
                            }
                        })();

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
                ),
                // `//host/…` literals: keep their authority instead of letting
                // the loop re-root them on the embed host.
                ...(
                    unescapedSearchSource.match(
                        Provider.PROTOCOL_RELATIVE_VIDEO_URL_RE
                    ) || []
                ).map(
                    url => `https:${url}`
                ),
                // JWPlayer setup({sources: [{file: "URL"}]}) pattern
                ...(
                    (unescapedSearchSource.match(
                        Provider.JWPLAYER_FILE_RE
                    ) || []) as RegExpMatchArray[]
                ).map(
                    (m: RegExpMatchArray) =>
                        m[1] || ""
                )
            ])
        ];

        const videos:
            VideoSource[] = [];

        let origin = "";

        // The page often carries the same stream twice — once escaped
        // (`https:\/\/…`) and once as a bare `//host/…` literal. Both normalize
        // to the same final URL, so dedupe after normalization, not before.
        const seenUrls =
            new Set<string>();

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

            if (
                !/^https?:\/\//i.test(
                    finalUrl
                )
            ) {
                console.log(
                    `[${this._Server.toUpperCase()}] Ignoring invalid video URL:`,
                    finalUrl
                );
                continue;
            }

            if (
                Provider.DECOY_VIDEO_RE.test(
                    finalUrl
                )
            ) {
                console.log(
                    `[${this._Server.toUpperCase()}] Ignoring sample clip:`,
                    finalUrl
                );
                continue;
            }

            if (
                seenUrls.has(
                    finalUrl
                )
            ) {
                continue;
            }

            seenUrls.add(
                finalUrl
            );

            const type =
                finalUrl.includes(
                    ".m3u8"
                )
                    ? "m3u8"
                    : "mp4";

            if (
                this._Server === "vk" &&
                type === "m3u8"
            ) {
                console.log(
                    "[VK] Skipping HLS manifest because Seanime proxy returns 400 for VK/OKCDN manifests"
                );

                continue;
            }

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

    // Extract the master.m3u8 URL for the callistanise / minochinos /
    // pixibay embedder network. The HTML embeds a pipe-separated token
    // array (e.g. ".../streams/"<token>"/<hash>/<ts>/<file_id>/master.m3u8")
    // inside an obfuscated script. We extract the candidate components
    // by their shape (10-digit timestamp, 14-char hash, ~22-char token,
    // 8-digit file_id from a `$.cookie('file_id', ...)` call), build
    // candidate URLs, and HEAD-probe to find the live one.
    private async extractHlsembedSources(
        serverUrl: string
    ): Promise<VideoSource[]> {

        console.log(
            "[HLSEMBED] Fetching",
            serverUrl
        );

        const response =
            await this.proxyFetch(
                serverUrl
            );

        if (!response.ok) {
            console.log(
                "[HLSEMBED] HTTP",
                response.status
            );
            return [];
        }

        const html =
            await response.text();

        // Strip obfuscation escapes so pipe-separated arrays become
        // easier to find.
        const unescapedHtml =
            html
                .replace(/\\\//g, "/")
                .replace(/\\u0026/g, "&");

        // Collect all pipe-separated arrays of length 6+. These are
        // the obfuscator's dictionary lookups.
        const pipeArrays: string[][] = [];

        const pipeRegex =
            /["']([^"']*?(?:\w+\|){5,}\w+)["']/g;

        let pm: RegExpExecArray | null;

        while (
            (pm = pipeRegex.exec(unescapedHtml)) !== null
        ) {
            const inner = pm[1];

            // Skip values that contain dots in tokens (usually URLs).
            if (
                inner.includes("://") ||
                inner.includes("/stream/")
            ) {
                continue;
            }

            pipeArrays.push(
                inner.split("|")
            );
        }

        // The HLS components are consecutive dictionary entries:
        // <timestamp>|<path hash>|<stream token>. Do not select the
        // first value matching each shape: packed player code contains
        // unrelated timestamps and identifiers such as "callistanise"
        // and "setCurrentAudioTrack".
        let timestamp = "";
        let hash = "";
        let token = "";

        for (const arr of pipeArrays) {
            for (let i = 0; i + 2 < arr.length; i++) {
                if (
                    /^\d{10}$/.test(arr[i]) &&
                    /^[a-z]{12,16}$/.test(arr[i + 1]) &&
                    /^[A-Za-z0-9]{18,26}$/.test(arr[i + 2])
                ) {
                    timestamp = arr[i];
                    hash = arr[i + 1];
                    token = arr[i + 2];
                }
            }
        }

        // file_id is in a $.cookie('file_id', 'NNNNNNNN') call.
        const fileIdMatch = unescapedHtml.match(
            /\$\.cookie\(\s*['"]file_id['"]\s*,\s*['"](\d{6,12})['"]/
        );
        const fileId =
            fileIdMatch
                ? fileIdMatch[1]
                : "";

        console.log(
            "[HLSEMBED] tokens ts=",
            timestamp,
            "hash=",
            hash,
            "token=",
            token,
            "file_id=",
            fileId
        );

        if (
            !timestamp ||
            !hash ||
            !token ||
            !fileId
        ) {
            console.log(
                "[HLSEMBED] Missing one or more URL components"
            );
            return [];
        }

        const url =
            `${new URL(serverUrl).origin}/stream/${token}/${hash}/${timestamp}/${fileId}/master.m3u8`;

        console.log(
            "[HLSEMBED] master.m3u8 extracted:",
            url
        );

        return [
            {
                url,
                type: "m3u8" as VideoSourceType,
                quality:
                    "hlsembed - auto",
                subtitles: []
            }
        ];
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
                await this.proxyFetch(
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
            _server;

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

        const requestedServer =
            (_server || "")
                .toLowerCase();

        const fallbackPriority = [
            "sibnet",
            "vk",
            "sendvid",
            "vidmoly",
            "movearnpre",
            "oneupload",
            "embed4me",
            "ansembed"
        ];

        const candidates =
            servers
                .map(
                    url => ({
                        url,
                        server:
                            this.getServerName(
                                url
                            )
                    })
                )
                .filter(
                    candidate =>
                        candidate.server !== ""
                );

        const orderedCandidates =
            candidates
                .filter(
                    candidate =>
                        candidate.server ===
                        requestedServer
                )
                .concat(
                    candidates
                        .filter(
                            candidate =>
                                candidate.server !==
                                requestedServer
                        )
                        .sort(
                            (a, b) =>
                                (
                                    fallbackPriority.indexOf(
                                        a.server
                                    ) === -1
                                        ? fallbackPriority.length
                                        : fallbackPriority.indexOf(
                                            a.server
                                        )
                                ) -
                                (
                                    fallbackPriority.indexOf(
                                        b.server
                                    ) === -1
                                        ? fallbackPriority.length
                                        : fallbackPriority.indexOf(
                                            b.server
                                        )
                                )
                        )
                );

        for (
            const candidate of orderedCandidates
        ) {
            if (
                requestedServer !== "" &&
                candidate.server !== requestedServer &&
                _server !== "sibnet"
            ) {
                continue;
            }

            this._Server =
                candidate.server;

            console.log(
                `[SERVER] Handling ${candidate.server}: ${candidate.url}`
            );

            const videoSources =
                await this.HandleServerUrl(
                    candidate.url
                );

            if (
                videoSources.length > 0
            ) {
                const referer =
                    candidate.url
                        .split("/")
                        .slice(
                            0,
                            3
                        )
                        .join("/");

                return {
                    headers: {
                        referer:
                            referer
                    },
                    server:
                        candidate.server,
                    videoSources:
                        videoSources
                };
            }

            console.log(
                `[SERVER] ${candidate.server} returned no video source`
            );
        }

        console.log(
            `Server not found: ${_server}`
        );

        return <EpisodeServer>{
            headers: {},
            server: "",
            videoSources: []
        };
    }
}

