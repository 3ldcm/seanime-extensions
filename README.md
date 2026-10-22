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

**Lecteurs exposés :** `mytv` et `stape` uniquement — les seuls qui peuvent réellement
renvoyer un flux (vérifié le 2026-10-22 : myTV 4/4 épisodes en HTTP 200, Streamtape 2/2).
Les autres lecteurs du site restent codés mais ne sont pas proposés : `voe` (voe.sx →
miroir, source construite depuis un blob obfusqué par un loader dépendant du DOM), `moon`
(mfw09.org, handshake empreinte/AES-GCM), `fhd1` (my.mail.ru, 404 partout), `sb`
(streamhide.to, injoignable depuis l'hôte de test).

**Installation :** Seanime → Extensions → Add extensions → coller l'URL :
```
https://raw.githubusercontent.com/3ldcm/seanime-extensions/main/voir-anime-v2/manifest.json
```

**Fichiers :**
- `manifest.json` — Métadonnées extension
- `payload.ts` — Provider TypeScript
- `test_parser.js` — Tests (`node test_parser.js`) : redirection JS, filtre des faux flux,
  reconstruction Streamtape (4 formes d'expression réelles)

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
désormais par `GET /catalogue/fragment.php?search=…&type[]=Scans` (JSON) au lieu du
HTML de `/catalogue/?search=…`, qui ne contient plus aucune carte. Le filtre manga
`type[]=Scans` est celui du site (il garde les webtoons comme « Infinite Mage »).

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

- **Manifestes :** lancer `python3 check-manifests.py` avant de committer. Seanime refuse
  l'installation si un manifeste échoue à son « sanity check » (`author` ≤ 25 **octets**,
  `name` ≤ 50, `id` 3–40 alphanumérique, version semver stricte) et affiche
  « failed sanity check, extension author is too long ».
- **Streamtape :** l'URL est construite par JS dans la page et la découpe change à chaque
  chargement (préfixe aléatoire dans le littéral, un ou deux `.substring()` chaînés).
  N'appliquer que le premier `.substring()` produit `dget_video` (404) ou un hôte bidon
  (`stredamtape.com`) : évaluer l'expression telle quelle, après avoir vérifié qu'elle ne
  contient que des littéraux, `+`, parenthèses et `.substring()`.
- **Lecteurs annoncés :** n'exposer que les lecteurs capables de renvoyer un flux ; un
  lecteur annoncé mais mort est pire qu'un lecteur absent (l'utilisateur choisit et n'obtient
  rien). Garder le code et un log explicite pour les autres.
- **Faux flux :** les pages de lecteurs embarquent des vidéos de test
  (`test-videos.co.uk/Big_Buck_Bunny`) — à rejeter, sinon Seanime « réussit » en jouant 10 s.
- **Anime-Sama :** reconstruire les épisodes par index de lecteur dans `episodes.js`, ne pas concaténer les tableaux puis renuméroter.
- **Sibnet :** nécessite le header `Referer: https://video.sibnet.ru` — sans quoi → 403.
- **Chrome Cast :** privilégier `video.remote.prompt()` (Remote Playback API) plutôt que d'envoyer directement l'URL MP4 Sibnet au Chromecast.

## Auteur

LdCm ([@3ldcm](https://github.com/3ldcm))
