/**
 * Anime-Sama Seanime provider — REFERENCE / HANDOFF
 *
 * IMPORTANT:
 * Le provider final exact validé hier doit être récupéré depuis le dépôt GitHub
 * existant de l'utilisateur. Ce fichier sert de référence pour la correction
 * critique de l'ordre des épisodes.
 */

const BASE_URL = "https://anime-sama.to";

function unique(values) {
    const out = [];
    const seen = {};
    for (const value of values || []) {
        if (!value || seen[value]) continue;
        seen[value] = true;
        out.push(value);
    }
    return out;
}

function extractProviderArrays(jsText) {
    const arrays = [];
    const re = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(\[[\s\S]*?\])\s*;/g;
    let match;

    while ((match = re.exec(jsText)) !== null) {
        try {
            const arr = JSON.parse(
                match[2]
                    .replace(/'/g, '"')
                    .replace(/,\s*\]/g, "]")
            );
            if (Array.isArray(arr) && arr.some(v => typeof v === "string" && /^https?:\/\//.test(v))) {
                arrays.push(arr);
            }
        } catch (_) {}
    }
    return arrays;
}

function buildEpisodeGroups(providerArrays) {
    const maxLength = providerArrays.reduce((m, arr) => Math.max(m, arr.length), 0);
    const episodes = [];

    console.log(`[EPISODES] Provider arrays: ${providerArrays.length}`);

    for (let i = 0; i < maxLength; i++) {
        const urls = unique(
            providerArrays
                .map(arr => arr[i])
                .filter(v => typeof v === "string" && /^https?:\/\//.test(v))
        );

        if (!urls.length) continue;

        const number = i + 1;
        console.log(`[EPISODES] Group ${i} => episode ${number} ${JSON.stringify(urls)}`);
        episodes.push({ number, urls });
    }

    console.log(`[EPISODES] Groups: ${episodes.length}`);
    console.log(`[EPISODES] Returned numbers: ${JSON.stringify(episodes.map(e => e.number))}`);
    return episodes;
}

function getEpisodeByNumber(groups, episodeNumber) {
    const n = Number(episodeNumber);
    return groups.find(ep => Number(ep.number) === n) || null;
}

globalThis.AnimeSamaEpisodeFix = {
    BASE_URL,
    extractProviderArrays,
    buildEpisodeGroups,
    getEpisodeByNumber,
};
