# seanime-extensions

Extensions pour [Seanime](https://github.com/Seanime/Seanime) — streaming providers et plugins.

## Extensions

### 🎬 Anime-Sama (Streaming Provider)

Fournisseur de streaming Anime-Sama pour Seanime.

**Installation :** Seanime → Extensions → Add extensions → coller l'URL :
```
https://raw.githubusercontent.com/3ldcm/seanime-extensions/main/anime-sama/manifest.json
```

**Fichiers :**
- `manifest.json` — Métadonnées extension
- `provider.js` — Provider fonctionnel (⚠️ à récupérer)
- `provider-reference.js` — Référence logique corrigée (épisodes par index)

### 🎬 Anime-Sama | AnsEmbed (Streaming Provider)

Provider Anime-Sama indépendant dédié uniquement au lecteur AnsEmbed.

**Installation :** Seanime → Extensions → Add extensions → coller l'URL :
```
https://raw.githubusercontent.com/3ldcm/seanime-extensions/main/anime-sama-ansembed/manifest.json
```

**Fichiers :**
- `manifest.json` — Métadonnées extension
- `payload.ts` — Provider TypeScript dédié AnsEmbed

### 🎬 VoirAnime (Streaming Provider)

Provider VoirAnime pour Seanime.

**Installation :** Seanime → Extensions → Add extensions → coller l'URL :
```
https://raw.githubusercontent.com/3ldcm/seanime-extensions/main/voir-anime/manifest.json
```

**Fichiers :**
- `manifest.json` — Métadonnées extension
- `payload.ts` — Provider TypeScript

### 🎬 VoirAnime V2 (Streaming Provider expérimental)

Provider VoirAnime séparé pour tester les correctifs sans casser la version stable.

**Installation :** Seanime → Extensions → Add extensions → coller l'URL :
```
https://raw.githubusercontent.com/3ldcm/seanime-extensions/main/voir-anime-v2/manifest.json
```

**Fichiers :**
- `manifest.json` — Métadonnées extension
- `payload.ts` — Provider TypeScript

### 🎬 FRAnime (Streaming Provider expérimental)

Provider FRAnime séparé basé sur l'API publique `api.franime.fr`.

**Installation :** Seanime → Extensions → Add extensions → coller l'URL :
```
https://raw.githubusercontent.com/3ldcm/seanime-extensions/main/franime/manifest.json
```

**Fichiers :**
- `manifest.json` — Métadonnées extension
- `payload.ts` — Provider TypeScript

### 📖 Anime-Sama | Manga (Manga Provider)

Provider scans/webtoons Anime-Sama pour Seanime. Fork du provider « AnimeSama (Manga) »
de pal & Rafou376 (v2.1.0), corrigé pour le catalogue de 2026-10 : la recherche passe
désormais par `GET /catalogue/fragment.php?search=…` (JSON) au lieu du HTML de
`/catalogue/?search=…`, qui ne contient plus aucune carte.

**Installation :** Seanime → Extensions → Add extensions → coller l'URL :
```
https://raw.githubusercontent.com/3ldcm/seanime-extensions/main/anime-sama-manga/manifest.json
```

⚠️ Désinstaller d'abord la version d'origine (`animesamamanga` de Pal-droid) : même `id`,
les deux ne peuvent pas coexister.

**Fichiers :**
- `manifest.json` — Métadonnées extension
- `provider.js` — Provider JavaScript (recherche fragment.php + cartes `as-carte`)
- `test_parser.js` — Fixtures du parseur (`node test_parser.js`)

### 📺 Chrome Cast (Plugin)

Plugin expérimental pour activer la lecture distante / Cast natif dans Seanime Web.

**Installation :** Seanime → Extensions → Add extensions → coller l'URL :
```
https://raw.githubusercontent.com/3ldcm/seanime-extensions/main/chrome-cast/manifest.json
```

**Fichiers :**
- `manifest.json` — Métadonnées plugin
- `plugin.ts` — Plugin TypeScript
- `manual-browser-test.js` — Test manuel dans la console navigateur

## Notes techniques

- **Anime-Sama :** reconstruire les épisodes par index de lecteur dans `episodes.js`, ne pas concaténer les tableaux puis renuméroter.
- **Sibnet :** nécessite le header `Referer: https://video.sibnet.ru` — sans quoi → 403.
- **Chrome Cast :** privilégier `video.remote.prompt()` (Remote Playback API) plutôt que d'envoyer directement l'URL MP4 Sibnet au Chromecast.

## Auteur

LdCm ([@3ldcm](https://github.com/3ldcm))
