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

Bastien ([@3ldcm](https://github.com/3ldcm))
