/// <reference path="../_external/.onlinestream-provider.d.ts" />
/// <reference path="../_external/core.d.ts" />

const DevMode = true;
const originalConsoleLog = console.log;

console.log = function (...args: any[]) {
    if (DevMode) {
        originalConsoleLog.apply(console, args);
    }
};

type FranimeTitleMap = {
    [key: string]: string;
};

type FranimeEpisode = {
    title?: string;
    lang?: {
        vf?: {
            lecteurs?: string[];
        };
        vo?: {
            lecteurs?: string[];
        };
    };
};

type FranimeSeason = {
    title?: string;
    episodes?: FranimeEpisode[];
};

type FranimeAnime = {
    id: number | string;
    title?: string;
    titleO?: string;
    titleVF?: string;
    titles?: FranimeTitleMap;
    saisons?: FranimeSeason[];
};

type FranimeEpisodeId = {
    animeId: string;
    season: number;
    episode: number;
    lang: "vf" | "vo";
};

class Provider {
    readonly API_URL = "https://api.franime.fr/api";

    private readonly SUPPORTED_SERVERS = [
        "sibnet",
        "sendvid",
        "vidmoly",
        "filemoon",
        "Smoothpre",
        "vkru",
        "uqload"
    ];

    private static readonly VIDEO_URL_RE =
        /(?:https?:\/\/|\/)[^\s'"]+\.(?:m3u8|mp4)(?:\?[^\s'"]*)?/g;

    private static readonly ESCAPED_VIDEO_URL_RE =
        /(?:https?:\\\/\\\/|\\\/)[^\s'"]+\.(?:m3u8|mp4)(?:\?[^\s'"]*)?/g;

    private static readonly IFRAME_RE =
        /<iframe[^>]+src=["']([^"']+)["']/i;

    getSettings(): Settings {
        return {
            episodeServers: this.SUPPORTED_SERVERS,
            supportsDub: true,
        };
    }

    private async apiFetch(
        endpoint: string
    ): Promise<Response> {
        const url =
            endpoint.startsWith("http")
                ? endpoint
                : this.API_URL + "/" + endpoint.replace(/^\//, "");

        return fetch(
            url,
            {
                headers: {
                    "Accept":
                        "application/json,text/html,*/*",
                    "Origin":
                        "https://franime.fr",
                    "Referer":
                        "https://franime.fr/",
                    "User-Agent":
                        "Mozilla/5.0"
                }
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

    private getAllTitles(
        anime: FranimeAnime
    ): string[] {
        const titles: string[] = [];

        if (anime.title) {
            titles.push(anime.title);
        }

        if (anime.titleO) {
            titles.push(anime.titleO);
        }

        if (anime.titleVF) {
            titles.push(anime.titleVF);
        }

        if (anime.titles) {
            for (const key in anime.titles) {
                if (anime.titles[key]) {
                    titles.push(anime.titles[key]);
                }
            }
        }

        return titles;
    }

    private scoreAnime(
        query: string,
        anime: FranimeAnime
    ): number {
        const normalizedQuery =
            this.normalizeTitle(query);

        if (!normalizedQuery) {
            return 0;
        }

        let bestScore = 0;
        const titles =
            this.getAllTitles(anime);

        for (const title of titles) {
            const normalizedTitle =
                this.normalizeTitle(title);

            let score = 0;

            if (
                normalizedTitle === normalizedQuery
            ) {
                score += 1000;
            }

            if (
                normalizedTitle.indexOf(normalizedQuery) !== -1
            ) {
                score += 500;
            }

            const queryWords =
                normalizedQuery.split(" ");

            let matchedWords = 0;

            for (const word of queryWords) {
                if (
                    word.length > 1 &&
                    normalizedTitle.indexOf(word) !== -1
                ) {
                    matchedWords++;
                }
            }

            score += matchedWords * 25;

            if (score > bestScore) {
                bestScore = score;
            }
        }

        return bestScore;
    }

    private parseEpisodeNumber(
        title: string,
        fallback: number
    ): number {
        const matches =
            (title || "").match(/\d+(?:\.\d+)?/g);

        if (
            !matches ||
            matches.length === 0
        ) {
            return fallback;
        }

        return parseFloat(
            matches[matches.length - 1]
        );
    }

    private encodeEpisodeId(
        id: FranimeEpisodeId
    ): string {
        return JSON.stringify(id);
    }

    private encodeAnimeId(
        animeId: string,
        lang: "vf" | "vo"
    ): string {
        return animeId + "$" + lang;
    }

    private decodeAnimeId(
        value: string
    ): FranimeEpisodeId {
        const parts =
            value.split("$");

        return {
            animeId:
                parts[0],
            season:
                0,
            episode:
                0,
            lang:
                parts[1] === "vo"
                    ? "vo"
                    : "vf"
        };
    }

    private decodeEpisodeId(
        value: string
    ): FranimeEpisodeId {
        return JSON.parse(value);
    }

    private uniqueServers(
        values: string[]
    ): string[] {
        const seen:
            Record<string, boolean> =
                {};

        const out:
            string[] =
                [];

        for (const value of values) {
            if (!value) {
                continue;
            }

            const key =
                value.toLowerCase();

            if (seen[key]) {
                continue;
            }

            seen[key] = true;
            out.push(value);
        }

        return out;
    }

    private extractVideoSources(
        text: string,
        server: string
    ): VideoSource[] {
        const normalized =
            text
                .replace(/\\\//g, "/")
                .replace(/&amp;/g, "&");

        const candidates:
            string[] =
                [];

        const escapedMatches =
            text.match(
                Provider.ESCAPED_VIDEO_URL_RE
            ) || [];

        for (const match of escapedMatches) {
            candidates.push(
                match
                    .replace(/\\\//g, "/")
                    .replace(/&amp;/g, "&")
            );
        }

        const plainMatches =
            normalized.match(
                Provider.VIDEO_URL_RE
            ) || [];

        for (const match of plainMatches) {
            candidates.push(
                match.replace(/&amp;/g, "&")
            );
        }

        const seen:
            Record<string, boolean> =
                {};

        const sources:
            VideoSource[] =
                [];

        for (const url of candidates) {
            if (
                seen[url]
            ) {
                continue;
            }

            seen[url] =
                true;

            sources.push({
                url,
                type:
                    url.toLowerCase().indexOf(".m3u8") !== -1
                        ? "m3u8" as VideoSourceType
                        : "mp4" as VideoSourceType,
                quality:
                    server + " - auto",
                subtitles:
                    []
            });
        }

        return sources;
    }

    private extractIframeUrl(
        text: string
    ): string {
        const iframeMatch =
            text.match(
                Provider.IFRAME_RE
            );

        if (
            iframeMatch &&
            iframeMatch[1]
        ) {
            return iframeMatch[1]
                .replace(/&amp;/g, "&");
        }

        const directMatch =
            text.match(
                /https?:\/\/[^\s"'<>]+/i
            );

        if (
            directMatch &&
            directMatch[0]
        ) {
            return directMatch[0]
                .replace(/&amp;/g, "&");
        }

        return "";
    }

    private async fetchAnimes(): Promise<FranimeAnime[]> {
        const response =
            await this.apiFetch(
                "animes"
            );

        if (
            !response.ok
        ) {
            console.log(
                "[FRANIME] Anime catalog HTTP:",
                response.status
            );

            return [];
        }

        return await response.json();
    }

    async search(
        opts: SearchOptions
    ): Promise<SearchResult[]> {
        const animes =
            await this.fetchAnimes();

        const results:
            Array<{
                anime: FranimeAnime;
                score: number;
            }> =
                [];

        for (const anime of animes) {
            const score =
                this.scoreAnime(
                    opts.query,
                    anime
                );

            if (
                score > 0
            ) {
                results.push({
                    anime,
                    score
                });
            }
        }

        results.sort(
            (a, b) =>
                b.score - a.score
        );

        return results
            .slice(0, 10)
            .map(
                item => ({
                    id:
                        this.encodeAnimeId(
                            String(item.anime.id),
                            opts.dub
                                ? "vf"
                                : "vo"
                        ),
                    title:
                        item.anime.title ||
                        item.anime.titleO ||
                        String(item.anime.id),
                    url:
                        "https://franime.fr/anime/" +
                        String(item.anime.id),
                    subOrDub:
                        opts.dub
                            ? "dub"
                            : "sub"
                })
            );
    }

    async findEpisodes(
        id: string
    ): Promise<EpisodeDetails[]> {
        const decodedAnime =
            this.decodeAnimeId(id);

        const animes =
            await this.fetchAnimes();

        let anime:
            FranimeAnime | null =
                null;

        for (const candidate of animes) {
            if (
                String(candidate.id) === decodedAnime.animeId
            ) {
                anime = candidate;
                break;
            }
        }

        if (
            !anime ||
            !anime.saisons
        ) {
            return [];
        }

        const episodes:
            EpisodeDetails[] =
                [];

        for (
            let seasonIndex = 0;
            seasonIndex < anime.saisons.length;
            seasonIndex++
        ) {
            const season =
                anime.saisons[seasonIndex];

            const seasonNumber =
                seasonIndex + 1;

            const list =
                season.episodes || [];

            for (
                let episodeIndex = 0;
                episodeIndex < list.length;
                episodeIndex++
            ) {
                const episode =
                    list[episodeIndex];

                const number =
                    this.parseEpisodeNumber(
                        episode.title || "",
                        episodeIndex + 1
                    );

                const langs =
                    episode.lang || {};

                const langData =
                    langs[decodedAnime.lang];

                const hasRequestedLang =
                    !!(
                        langData &&
                        langData.lecteurs &&
                        langData.lecteurs.length > 0
                    );

                if (hasRequestedLang) {
                    episodes.push({
                        id:
                            this.encodeEpisodeId({
                                animeId:
                                    String(anime.id),
                                season:
                                    seasonNumber,
                                episode:
                                    episodeIndex + 1,
                                lang:
                                    decodedAnime.lang
                            }),
                        url:
                            "https://franime.fr/anime/" +
                            String(anime.id),
                        number
                    });
                }
            }
        }

        console.log(
            "[FRANIME] Episodes:",
            episodes.length
        );

        return episodes;
    }

    async findEpisodeServer(
        episode: EpisodeDetails,
        _server: string
    ): Promise<EpisodeServer> {
        const id =
            this.decodeEpisodeId(
                episode.id
            );

        const requested =
            (_server || "").toLowerCase();

        const animes =
            await this.fetchAnimes();

        let servers:
            string[] =
                [];

        for (const anime of animes) {
            if (
                String(anime.id) !== id.animeId ||
                !anime.saisons
            ) {
                continue;
            }

            const season =
                anime.saisons[id.season - 1];

            const ep =
                season &&
                season.episodes
                    ? season.episodes[id.episode - 1]
                    : null;

            const lang =
                ep &&
                ep.lang
                    ? ep.lang[id.lang]
                    : null;

            servers =
                this.uniqueServers(
                    lang && lang.lecteurs
                        ? lang.lecteurs
                        : []
                );

            break;
        }

        if (
            servers.length === 0
        ) {
            return <EpisodeServer>{
                headers: {},
                server: "",
                videoSources: []
            };
        }

        const ordered:
            string[] =
                [];

        if (requested) {
            for (const server of servers) {
                if (
                    server.toLowerCase() === requested
                ) {
                    ordered.push(server);
                }
            }
        }

        for (const server of servers) {
            let exists = false;

            for (const current of ordered) {
                if (
                    current.toLowerCase() === server.toLowerCase()
                ) {
                    exists = true;
                    break;
                }
            }

            if (!exists) {
                ordered.push(server);
            }
        }

        for (const server of ordered) {
            const endpoint =
                "anime/" +
                id.animeId +
                "/" +
                id.season +
                "/" +
                id.lang +
                "/" +
                id.episode +
                "/" +
                encodeURIComponent(server);

            const response =
                await this.apiFetch(endpoint);

            const text =
                await response.text();

            if (
                !response.ok
            ) {
                console.log(
                    "[FRANIME] Lecteur HTTP:",
                    server,
                    response.status
                );

                continue;
            }

            if (
                text.indexOf("Just a moment") !== -1 ||
                text.indexOf("challenges.cloudflare.com") !== -1
            ) {
                console.log(
                    "[FRANIME] Cloudflare challenge for lecteur:",
                    server
                );

                continue;
            }

            const directSources =
                this.extractVideoSources(
                    text,
                    server
                );

            if (
                directSources.length > 0
            ) {
                return {
                    headers: {
                        referer:
                            "https://franime.fr/"
                    },
                    server,
                    videoSources:
                        directSources
                };
            }

            const iframeUrl =
                this.extractIframeUrl(
                    text
                );

            if (
                !iframeUrl
            ) {
                console.log(
                    "[FRANIME] No iframe/source in lecteur response:",
                    server
                );

                continue;
            }

            console.log(
                "[FRANIME] Iframe:",
                server,
                iframeUrl
            );

            const iframeResponse =
                await fetch(
                    iframeUrl,
                    {
                        headers: {
                            Referer:
                                "https://franime.fr/",
                            "User-Agent":
                                "Mozilla/5.0"
                        }
                    }
                );

            if (
                !iframeResponse.ok
            ) {
                console.log(
                    "[FRANIME] Iframe HTTP:",
                    server,
                    iframeResponse.status
                );

                continue;
            }

            const iframeHtml =
                await iframeResponse.text();

            const iframeSources =
                this.extractVideoSources(
                    iframeHtml,
                    server
                );

            if (
                iframeSources.length > 0
            ) {
                return {
                    headers: {
                        referer:
                            new URL(iframeUrl).origin + "/"
                    },
                    server,
                    videoSources:
                        iframeSources
                };
            }

            console.log(
                "[FRANIME] Iframe has no direct video source:",
                server
            );
        }

        return <EpisodeServer>{
            headers: {},
            server: "",
            videoSources: []
        };
    }
}
