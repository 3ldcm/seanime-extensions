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
 readonly SEANIME_API = "http://127.0.0.1:43211/api/v1/proxy?url=";

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

 getSettings(): Settings {
 return {
 episodeServers: this.SUPPORTED_SERVERS,
 supportsDub: true,
 };
 }

 private proxyFetch(
 targetUrl: string
 ): Promise<Response> {

 return fetch(
 `${this.SEANIME_API}${encodeURIComponent(targetUrl)}`
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

 /*
 * ======================================================
 * NORMALISATION DES TITRES
 * ======================================================
 */

 private normalizeTitle(
 value: string
 ): string {

 return value
 .toLowerCase()
 .normalize("NFD")
 .replace(
 /[\u0300-\u036f]/g,
 ""
 )
 .replace(
 /[^a-z0-9]+/g,
 " "
 )
 .trim()
 .replace(
 /\s+/g,
 " "
 );
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

 /*
 * Calcule à quel point un résultat Anime-Sama
 * correspond à la requête Seanime.
 */

 private scoreSearchResult(
 query: string,
 title: string,
 url: string
 ): number {

 const normalizedQuery =
 this.normalizeTitle(
 query
 );

 const normalizedTitle =
 this.normalizeTitle(
 title
 );

 const slug =
 this.getSlugFromUrl(
 url
 );

 const normalizedSlug =
 this.normalizeTitle(
 slug.replace(
 /-/g,
 " "
 )
 );

 if (
 normalizedQuery === ""
 ) {
 return 0;
 }

 let score = 0;

 /*
 * Correspondance parfaite du slug.
 *
 * Exemple :
 *
 * Sozai Saishuka no Isekai Ryokouki
 *
 * ->
 *
 * sozai-saishuka-no-isekai-ryokouki
 */

 if (
 normalizedSlug ===
 normalizedQuery
 ) {
 score += 1000;
 }

 /*
 * Correspondance parfaite du titre.
 */

 if (
 normalizedTitle ===
 normalizedQuery
 ) {
 score += 900;
 }

 /*
 * Le titre contient exactement
 * la requête.
 */

 if (
 normalizedTitle.includes(
 normalizedQuery
 )
 ) {
 score += 500;
 }

 /*
 * Le slug contient la requête.
 */

 if (
 normalizedSlug.includes(
 normalizedQuery
 )
 ) {
 score += 450;
 }

 /*
 * La requête contient le titre/slug.
 */

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

 /*
 * Comparaison mot par mot.
 */

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
 score +=
 Math.round(
 (
 titleMatches /
 queryWords.length
 ) * 200
 );

 score +=
 Math.round(
 (
 slugMatches /
 queryWords.length
 ) * 300
 );
 }

 return score;
 }

 /*
 * ======================================================
 * RÉCUPÉRATION DES SAISONS
 * ======================================================
 */

 private async fetchAnimeSeasons(
 rawAnimeUrl: string
 ): Promise<AnimeSeason[]> {

 try {
 const animeUrl =
 rawAnimeUrl.replace(
 Provider.TRAILING_SLASH_RE,
 ""
 );

 const response =
 await this.proxyFetch(
 animeUrl
 );

 if (
 !response.ok
 ) {
 return [];
 }

 const html =
 await response.text();

 const $ =
 await LoadDoc(
 html
 );

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

 const scripts =
 $("div.flex.flex-wrap")
 .find("script")
 .text();

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
 rawPanneaux.push({
 seasonName:
 match[1],

 seasonStem:
 match[2]
 });
 }

 const seenNames =
 new Set<string>();

 const dedupedPanneaux =
 rawPanneaux.filter(
 ({
 seasonName
 }) => {

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

 /*
 * FILMS
 */

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
 i <
 moviePlayers.length;
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

 /*
 * SÉRIES
 */

 return [
 {
 title:
 `${animeName} ${seasonName}`,

 url:
 `${animeUrl}/${seasonStem}`,

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

 return seasonGroups.flat();

 } catch (
 error
 ) {
 console.error(
 "Error fetching anime seasons:",
 error
 );

 return [];
 }
 }

 /*
 * ======================================================
 * EPISODES.JS
 * ======================================================
 */

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

 if (
 !pageResponse.ok
 ) {
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

 if (
 !jsResponse.ok
 ) {
 return null;
 }

 return {
 js:
 await jsResponse.text(),

 pageHtml
 };
 }

 /*
 * ======================================================
 * EXTRACTION DES TABLEAUX eps*
 * ======================================================
 */

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
 .slice(
 1,
 -1
 )
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
 "[EPISODES] Number of provider arrays:",
 episodeArrays.length
 );

 console.log(
 "[EPISODES] Array lengths:",
 episodeArrays.map(
 array =>
 array.length
 )
 );

 return episodeArrays;
 }

 /*
 * ======================================================
 * GROUPEMENT PAR NUMÉRO D'ÉPISODE
 * ======================================================
 */

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
 arr =>
 arr.length
 )
 );

 const groups:
 string[][] = [];

 for (
 let episodeIndex = 0;
 episodeIndex <
 maxEpisodes;
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

 /*
 * ======================================================
 * FILMS / PLAYERS
 * ======================================================
 */

 private async fetchPlayers(
 url: string
 ): Promise<string[][]> {

 try {
 const result =
 await this.fetchEpisodesJs(
 url
 );

 if (
 !result
 ) {
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

 } catch (
 error
 ) {
 console.error(
 "Error fetching players:",
 error
 );

 return [];
 }
 }

 /*
 * ======================================================
 * SERVEURS VIDÉO
 * ======================================================
 */

 private async HandleServerUrl(
 serverUrl: string
 ): Promise<VideoSource[]> {

 const req =
 await this.proxyFetch(
 serverUrl
 );

 if (
 !req.ok
 ) {
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

 while (
 c--
 ) {
 if (
 k[c]
 ) {
 p =
 p.replace(
 new RegExp(
 "\\b" +
 c.toString(
 a
 ) +
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

 if (
 unpackMatch
 ) {
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
 .split(
 "|"
 );

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

 const videoUrls =
 searchSource.match(
 Provider.VIDEO_URL_RE
 ) || [];

 const videos:
 VideoSource[] = [];

 let origin = "";

 try {
 const urlObj =
 new URL(
 serverUrl
 );

 origin =
 urlObj.origin;

 } catch (
 error
 ) {
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

 /*
 * ======================================================
 * RECHERCHE
 * ======================================================
 *
 * FIX :
 *
 * L'ancien provider faisait :
 *
 * searchResults.first()
 *
 * et pouvait donc sélectionner un anime complètement
 * différent.
 *
 * Maintenant tous les résultats sont comparés.
 */

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
 .join(
 " "
 );

 continue;
 }

 const html =
 await response.text();

 const $ =
 await LoadDoc(
 html
 );

 const searchResults =
 $(
 "#list_catalog > div a"
 );

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
 .join(
 " "
 );

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
 searchResults.eq(
 i
 );

 const href =
 result.attr(
 "href"
 ) || "";

 if (
 !href
 ) {
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
 {
 title:
 resultTitle.trim(),

 url:
 href,

 slug:
 this.getSlugFromUrl(
 href
 ),

 score
 }
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

 /*
 * Sécurité :
 *
 * si jamais aucun href exploitable
 * n'a été trouvé.
 */

 if (
 !bestAnimeUrl
 ) {
 console.log(
 "[SEARCH] No usable candidate"
 );

 return [];
 }

 console.log(
 "[SEARCH] Selected:",
 {
 query:
 tempquery,

 title:
 bestTitle,

 url:
 bestAnimeUrl,

 score:
 bestScore
 }
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

 /*
 * VF
 */

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
 dubUrl +
 "1";

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

 /*
 * ======================================================
 * ÉPISODES
 * ======================================================
 *
 * FIX :
 *
 * episodes.js contient déjà les vidéos
 * dans l'ordre correct.
 *
 * group[0] = épisode 1
 * group[1] = épisode 2
 * etc.
 *
 * Pas de parseSeasonEpisodes()
 * Pas de reverse()
 */

 async findEpisodes(
 id: string
 ): Promise<EpisodeDetails[]> {

 const animeUrl =
 id.split(
 "#"
 )[0];

 const movieIndex =
 id.split(
 "#"
 )[1];

 const result =
 await this.fetchEpisodesJs(
 animeUrl
 );

 if (
 !result
 ) {
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

 /*
 * ==================================================
 * FILMS
 * ==================================================
 */

 if (
 movieIndex !==
 undefined
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

 /*
 * ==================================================
 * SÉRIES
 * ==================================================
 */

 const groups =
 this.groupEpisodesByIndex(
 episodeArrays
 );

 console.log(
 "[EPISODES] Number of video groups:",
 groups.length
 );

 groups.forEach(
 (
 episodeUrls,
 episodeIndex
 ) => {

 const number =
 episodeIndex +
 1;

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
 episode =>
 episode.number
 )
 );

 return episodeDetails;
 }

 /*
 * ======================================================
 * SÉLECTION SERVEUR
 * ======================================================
 */

 async findEpisodeServer(
 episode: EpisodeDetails,
 _server: string
 ): Promise<EpisodeServer> {

 this._Server =
 _server;

 const servers =
 episode.id.split(
 ","
 );

 const serverUrl =
 servers.find(
 server => {

 const parts =
 server.split(
 "/"
 );

 const domain =
 parts[2];

 if (
 !domain
 ) {
 return false;
 }

 const domainParts =
 domain.split(
 "."
 );

 const serverName =
 domainParts.length >= 3
 ? domainParts[1]
 : domainParts[0];

 return (
 serverName ===
 _server
 );
 }
 );

 if (
 serverUrl &&
 _server !== ""
 ) {
 console.log(
 `Handling server URL: ${serverUrl}`
 );

 const videoSources =
 await this.HandleServerUrl(
 serverUrl
 );

 if (
 videoSources.length >
 0
 ) {
 const referer =
 serverUrl
 .split(
 "/"
 )
 .slice(
 0,
 3
 )
 .join(
 "/"
 );

 return {
 headers: {
 referer:
 referer
 },

 server:
 _server,

 videoSources:
 videoSources
 };
 }
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
