/// <reference path="../_external/.onlinestream-provider.d.ts" />
/// <reference path="../_external/core.d.ts" />

/**
 * Anime-Sama V2 — Provider amélioré
 *
 * Changements vs v1 :
 * - DevMode désactivé par défaut
 * - Retry + timeout sur les requêtes réseau
 * - Fetch unique pour les films (pas de double appel)
 * - Meilleure gestion des erreurs
 * - Logs réduits en production
 * - Gestion VF/VF1/VF2 plus robuste
 */

const DevMode = false;

const originalConsoleLog = console.log;

console.log = function (...args: any[]) {
    if (DevMode) {
        originalConsoleLog.apply(console, args);
    }
};

// ── Types ────────────────────────────────────────────────────

interface AnimeSeason {
    title: string;
    url: string;
    status: "COMPLETED" | "UNKNOWN";
    thumbnail: string;
    description: string;
    genre: string;
}

// ── Config ───────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

// ── Provider ─────────────────────────────────────────────────

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
        "sibnet",
        "vk",
        "sendvid",
        "vidmoly",
        "movearnpre",
        "oneupload",
        "embed4me",
        "ansembed"
    ];

    // ── Regex ────────────────────────────────────────────────

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
    private static readonly QUERY_SPLIT_RE =
        /[\s:']+/;

    _Server = "";

    // ── Settings ─────────────────────────────────────────────

    getSettings(): Settings {
        return {
            episodeServers: this.SUPPORTED_SERVERS,
            supportsDub: true,
        };
    }

    // ── Réseau ───────────────────────────────────────────────

    /**
     * Fetch avec timeout et retry.
     * Pas de proxy — accès direct à anime-sama.to.
     */
    private async robustFetch(
        url: string,
        retries = MAX_RETRIES
    ): Promise<Response | null> {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(
                    () => controller.abort(),
                    FETCH_TIMEOUT_MS
                );

                const response = await fetch(url, {
                    signal: controller.signal
                });

                clearTimeout(timer);
                return response;
            } catch (error: any) {
                const isLast = attempt === retries;

                if (isLast) {
                    console.error(
                        `[FETCH] Échec après ${retries + 1} tentatives:`,
                        url,
                        error?.message || error
                    );
                    return null;
                }

                // Backoff exponentiel
                await new Promise(r =>
                    setTimeout(r, RETRY_DELAY_MS * (attempt + 1))
                );
            }
        }

        return null;
    }

    // ── Utilitaires ──────────────────────────────────────────

    private stripComments(text: string): string {
        return text.replace(Provider.COMMENT_RE, "");
    }

    private normalizeTitle(value: string): string {
        return value
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, " ")
            .trim()
            .replace(/\s+/g, " ");
    }

    private getSlugFromUrl(url: string): string {
        const clean = url
            .replace(Provider.TRAILING_SLASH_RE, "")
            .split("?")[0]
            .split("#")[0];
        const parts = clean.split("/");
        return parts[parts.length - 1] || "";
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(r => setTimeout(r, ms));
    }

    // ── Scoring ──────────────────────────────────────────────

    private scoreSearchResult(
        query: string,
        title: string,
        url: string
    ): number {
        const nq = this.normalizeTitle(query);
        const nt = this.normalizeTitle(title);
        const slug = this.getSlugFromUrl(url);
        const ns = this.normalizeTitle(slug.replace(/-/g, " "));

        if (nq === "") return 0;

        let score = 0;

        // Correspondance exacte
        if (ns === nq) score += 1000;
        if (nt === nq) score += 900;

        // Inclusion
        if (nt.includes(nq)) score += 500;
        if (ns.includes(nq)) score += 450;

        // Inverse
        if (nt !== "" && nq.includes(nt)) score += 250;
        if (ns !== "" && nq.includes(ns)) score += 250;

        // Mot par mot
        const queryWords = nq.split(" ").filter(Boolean);
        const titleWords = new Set(nt.split(" ").filter(Boolean));
        const slugWords = new Set(ns.split(" ").filter(Boolean));

        let titleMatches = 0;
        let slugMatches = 0;

        for (const word of queryWords) {
            if (titleWords.has(word)) titleMatches++;
            if (slugWords.has(word)) slugMatches++;
        }

        if (queryWords.length > 0) {
            score += Math.round((titleMatches / queryWords.length) * 200);
            score += Math.round((slugMatches / queryWords.length) * 300);
        }

        return score;
    }

    // ── Saisons ──────────────────────────────────────────────

    private async fetchAnimeSeasons(
        rawAnimeUrl: string
    ): Promise<AnimeSeason[]> {
        try {
            const animeUrl = rawAnimeUrl.replace(
                Provider.TRAILING_SLASH_RE,
                ""
            );

            const response = await this.robustFetch(animeUrl);

            if (!response || !response.ok) {
                return [];
            }

            const html = await response.text();
            const $ = await LoadDoc(html);

            const animeName = $("#titreOeuvre").text() || "";
            const thumbnail = $("#coverOeuvre").attr("src") || "";
            const description =
                $("h2:contains(synopsis)").next("p").text() || "";
            const genre = $("h2:contains(genres)").next("a").text() || "";

            const scripts = $("div.flex.flex-wrap").find("script").text();
            const uncommented = this.stripComments(scripts);

            const rawPanneaux: {
                seasonName: string;
                seasonStem: string;
            }[] = [];

            let match: RegExpExecArray | null;
            Provider.SEASON_PANEL_RE.lastIndex = 0;

            while (
                (match = Provider.SEASON_PANEL_RE.exec(uncommented)) !== null
            ) {
                rawPanneaux.push({
                    seasonName: match[1],
                    seasonStem: match[2],
                });
            }

            // Dédoublonnage
            const seenNames = new Set<string>();
            const dedupedPanneaux = rawPanneaux.filter(({ seasonName }) => {
                if (seenNames.has(seasonName)) return false;
                seenNames.add(seasonName);
                return true;
            });

            const seasonGroups = await Promise.all(
                dedupedPanneaux.map(
                    async ({
                        seasonName,
                        seasonStem,
                    }): Promise<AnimeSeason[]> => {
                        // ── Films ──
                        if (seasonStem.includes("film")) {
                            return this.handleFilmSeason(
                                animeUrl,
                                animeName,
                                seasonStem,
                                thumbnail,
                                description,
                                genre
                            );
                        }

                        // ── Séries ──
                        return [
                            {
                                title: `${animeName} ${seasonName}`,
                                url: `${animeUrl}/${seasonStem}`,
                                status: "UNKNOWN",
                                thumbnail,
                                description,
                                genre,
                            },
                        ];
                    }
                )
            );

            return seasonGroups.flat();
        } catch (error) {
            console.error("[SEASONS] Erreur:", error);
            return [];
        }
    }

    /**
     * Gestion unifiée des films :
     * un seul fetch pour les players + les noms.
     */
    private async handleFilmSeason(
        animeUrl: string,
        animeName: string,
        seasonStem: string,
        thumbnail: string,
        description: string,
        genre: string
    ): Promise<AnimeSeason[]> {
        const moviesUrl = `${animeUrl}/${seasonStem}`;

        // Fetch episodes.js une seule fois
        const result = await this.fetchEpisodesJs(moviesUrl);

        if (!result) {
            return [];
        }

        const episodeArrays = this.parseEpisodeArrays(result.js);

        if (episodeArrays.length === 0) {
            return [];
        }

        // Extraire les noms depuis la page HTML déjà récupérée
        const movieNames: string[] = [];
        let nameMatch: RegExpExecArray | null;
        Provider.MOVIE_NAME_RE.lastIndex = 0;

        while (
            (nameMatch = Provider.MOVIE_NAME_RE.exec(result.pageHtml)) !== null
        ) {
            movieNames.push(nameMatch[1]);
        }

        // Grouper par index
        const groups = this.groupEpisodesByIndex(episodeArrays);

        const movieSeasons: AnimeSeason[] = [];

        for (let i = 0; i < groups.length; i++) {
            const title =
                movieNames.length > i
                    ? `${animeName} ${movieNames[i]}`
                    : groups.length === 1
                      ? `${animeName} Film`
                      : `${animeName} Film ${i + 1}`;

            movieSeasons.push({
                title,
                url: `${moviesUrl}#${i}`,
                status: "COMPLETED",
                thumbnail,
                description,
                genre,
            });
        }

        return movieSeasons;
    }

    // ── Episodes.js ──────────────────────────────────────────

    private async fetchEpisodesJs(
        seasonUrl: string
    ): Promise<{ js: string; pageHtml: string } | null> {
        const basePath = seasonUrl.replace(Provider.TRAILING_SLASH_RE, "");

        const pageResponse = await this.robustFetch(`${basePath}/`);

        if (!pageResponse || !pageResponse.ok) {
            return null;
        }

        const pageHtml = await pageResponse.text();

        const fileverMatch = pageHtml.match(Provider.FILEVER_RE);

        const episodesJsUrl = fileverMatch
            ? `${basePath}/episodes.js?filever=${fileverMatch[1]}`
            : `${basePath}/episodes.js`;

        const jsResponse = await this.robustFetch(episodesJsUrl);

        if (!jsResponse || !jsResponse.ok) {
            return null;
        }

        return {
            js: await jsResponse.text(),
            pageHtml,
        };
    }

    // ── Parsing épisodes ─────────────────────────────────────

    private parseEpisodeArrays(js: string): string[][] {
        const episodeArrays: string[][] = [];
        let match: RegExpExecArray | null;

        Provider.EPISODE_ARRAY_RE.lastIndex = 0;

        while (
            (match = Provider.EPISODE_ARRAY_RE.exec(js)) !== null
        ) {
            const urls = (match[1].match(Provider.EPISODE_URL_RE) || [])
                .map(u =>
                    u
                        .slice(1, -1)
                        .replace(Provider.VIDMOLY_RE, "vidmoly.net")
                )
                .filter(u => u.length > 0);

            if (urls.length > 0) {
                episodeArrays.push(urls);
            }
        }

        return episodeArrays;
    }

    private groupEpisodesByIndex(episodeArrays: string[][]): string[][] {
        if (episodeArrays.length === 0) return [];

        const maxEpisodes = Math.max(
            ...episodeArrays.map(arr => arr.length)
        );

        const groups: string[][] = [];

        for (let i = 0; i < maxEpisodes; i++) {
            const episodeUrls = episodeArrays
                .map(arr => arr[i])
                .filter((url): url is string => !!url);

            if (episodeUrls.length > 0) {
                groups.push(episodeUrls);
            }
        }

        return groups;
    }

    // ── Players ──────────────────────────────────────────────

    private async fetchPlayers(url: string): Promise<string[][]> {
        try {
            const result = await this.fetchEpisodesJs(url);

            if (!result) return [];

            const episodeArrays = this.parseEpisodeArrays(result.js);

            if (episodeArrays.length === 0) return [];

            return this.groupEpisodesByIndex(episodeArrays);
        } catch (error) {
            console.error("[PLAYERS] Erreur:", error);
            return [];
        }
    }

    // ── Serveurs vidéo ───────────────────────────────────────

    private unpack(
        p: string,
        a: number,
        c: number,
        k: string[]
    ): string {
        while (c--) {
            if (k[c]) {
                p = p.replace(
                    new RegExp("\\b" + c.toString(a) + "\\b", "g"),
                    k[c]
                );
            }
        }
        return p;
    }

    private async HandleServerUrl(
        serverUrl: string
    ): Promise<VideoSource[]> {
        const req = await this.robustFetch(serverUrl);

        if (!req || !req.ok) {
            console.error(
                "[SERVER] Échec fetch:",
                serverUrl,
                req?.status
            );
            return [];
        }

        const html = await req.text();

        // Désempaqueter le JS obfusqué
        let unpacked: string | undefined;
        let match: RegExpExecArray | null;

        Provider.SCRIPT_TAG_RE.lastIndex = 0;

        while (
            (match = Provider.SCRIPT_TAG_RE.exec(html)) !== null
        ) {
            const script = match[1];

            if (script.includes("eval(function(p,a,c,k,e,d)")) {
                const unpackMatch = script.match(Provider.PACKER_RE);

                if (unpackMatch) {
                    unpacked = this.unpack(
                        unpackMatch[1],
                        parseInt(unpackMatch[2], 10),
                        parseInt(unpackMatch[3], 10),
                        unpackMatch[4].split("|")
                    );
                    break;
                }
            }
        }

        const searchSource = unpacked
            ? `${html}\n${unpacked}`
            : html;

        const videoUrls =
            searchSource.match(Provider.VIDEO_URL_RE) || [];

        const videos: VideoSource[] = [];

        let origin = "";
        try {
            origin = new URL(serverUrl).origin;
        } catch {
            // ignore
        }

        for (const url of videoUrls) {
            let finalUrl = url;

            if (url.startsWith("/") && !url.startsWith("//")) {
                if (origin === "") continue;
                finalUrl = origin + url;
            } else if (url.startsWith("//")) {
                finalUrl = `https:${url}`;
            }

            const type = finalUrl.includes(".m3u8") ? "m3u8" : "mp4";

            videos.push({
                url: finalUrl,
                type: type as VideoSourceType,
                quality: `${this._Server} - unknown`,
                subtitles: [],
            });
        }

        return videos;
    }

    // ── Recherche ────────────────────────────────────────────

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        let tempquery = opts.query;

        while (tempquery !== "") {
            const searchUrl = new URL(this.CATALOGUE_URL);
            searchUrl.searchParams.set("search", tempquery);
            searchUrl.searchParams.set("page", "1");

            const response = await fetch(searchUrl.toString());

            if (!response.ok) {
                tempquery = tempquery
                    .split(Provider.QUERY_SPLIT_RE)
                    .slice(0, -1)
                    .join(" ");
                continue;
            }

            const html = await response.text();
            const $ = await LoadDoc(html);
            const searchResults = $("#list_catalog > div a");

            if (searchResults.length() <= 0) {
                tempquery = tempquery
                    .split(Provider.QUERY_SPLIT_RE)
                    .slice(0, -1)
                    .join(" ");
                continue;
            }

            let bestAnimeUrl = "";
            let bestTitle = "";
            let bestScore = -1;

            for (let i = 0; i < searchResults.length(); i++) {
                const result = searchResults.eq(i);
                const href = result.attr("href") || "";

                if (!href) continue;

                const resultTitle = result.text() || "";
                const score = this.scoreSearchResult(
                    tempquery,
                    resultTitle,
                    href
                );

                if (score > bestScore) {
                    bestScore = score;
                    bestAnimeUrl = href;
                    bestTitle = resultTitle.trim();
                }
            }

            if (!bestAnimeUrl) {
                return [];
            }

            const seasons =
                await this.fetchAnimeSeasons(bestAnimeUrl);

            if (seasons.length === 0) {
                return [];
            }

            return await Promise.all(
                seasons.map(
                    async (season): Promise<SearchResult> => {
                        let finalUrl = season.url;

                        // VF / VF1 / VF2
                        if (opts.dub && !finalUrl.includes("film")) {
                            finalUrl = await this.resolveDubUrl(finalUrl);
                        }

                        return {
                            id: finalUrl,
                            title: season.title,
                            url: finalUrl,
                            subOrDub: opts.dub ? "dub" : "sub",
                        };
                    }
                )
            );
        }

        return [];
    }

    /**
     * Résout l'URL VF en essayant vf, vf1, vf2 dans l'ordre.
     * Retourne la meilleure URL disponible.
     */
    private async resolveDubUrl(subUrl: string): Promise<string> {
        const candidates = [
            subUrl.replace("/vostfr", "/vf"),
            subUrl.replace("/vostfr", "/vf1"),
            subUrl.replace("/vostfr", "/vf2"),
        ];

        for (const candidate of candidates) {
            const response = await this.robustFetch(candidate, 0);
            if (response && response.ok) {
                return candidate;
            }
        }

        // Aucune VF trouvée → garder le VOSTFR
        return subUrl;
    }

    // ── Épisodes ─────────────────────────────────────────────

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const animeUrl = id.split("#")[0];
        const movieIndex = id.split("#")[1];

        const result = await this.fetchEpisodesJs(animeUrl);

        if (!result) {
            return [];
        }

        const episodeArrays = this.parseEpisodeArrays(result.js);

        if (episodeArrays.length === 0) {
            return [];
        }

        // ── Films ──
        if (movieIndex !== undefined) {
            const movieIdx = parseInt(movieIndex, 10);
            const movieUrls: string[] = [];

            for (const voiceArray of episodeArrays) {
                if (voiceArray[movieIdx]) {
                    movieUrls.push(voiceArray[movieIdx]);
                }
            }

            if (movieUrls.length > 0) {
                return [
                    {
                        id: movieUrls.join(","),
                        url: id,
                        number: 1,
                    },
                ];
            }

            return [];
        }

        // ── Séries ──
        const groups = this.groupEpisodesByIndex(episodeArrays);

        return groups.map((episodeUrls, episodeIndex) => ({
            id: episodeUrls.join(","),
            url: id,
            number: episodeIndex + 1,
        }));
    }

    // ── Serveur d'épisode ────────────────────────────────────

    async findEpisodeServer(
        episode: EpisodeDetails,
        _server: string
    ): Promise<EpisodeServer> {
        this._Server = _server;

        const servers = episode.id.split(",");

        const serverUrl = servers.find(server => {
            const parts = server.split("/");
            const domain = parts[2];
            if (!domain) return false;

            const domainParts = domain.split(".");
            const serverName =
                domainParts.length >= 3
                    ? domainParts[1]
                    : domainParts[0];

            return serverName === _server;
        });

        if (serverUrl && _server !== "") {
            const videoSources = await this.HandleServerUrl(serverUrl);

            if (videoSources.length > 0) {
                const referer = serverUrl
                    .split("/")
                    .slice(0, 3)
                    .join("/");

                return {
                    headers: { referer },
                    server: _server,
                    videoSources,
                };
            }
        }

        return <EpisodeServer>{
            headers: {},
            server: "",
            videoSources: [],
        };
    }
}
