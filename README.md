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
- `payload.ts` — Provider TypeScript (v2.2.7)
- `test_parser.js` — Tests du parseur et des lecteurs (31 vérifications, `node test_parser.js`)

**Corrections v2.2.7 :** la liste d'épisodes était vide parce que `episodes.js` répond **403 sans
`Referer`** — le provider envoie désormais un UA et un Referer dérivé de la cible. Le packer du
site peut utiliser la **base 62**, que `Number.prototype.toString()` refuse
(`toString(62)` → exception qui annulait toute l'extraction) : AnsEmbed remonte à nouveau son
`master.m3u8`. Embed4me passe par son **API + AES-CBC** plutôt que par sa page (délai borné à
15 s au lieu de 134 s), les faux flux (Big Buck Bunny) et les doublons sont filtrés. Sibnet reste
désactivé (HTTP 403 quel que soit le Referer).

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

**Recherche AJAX :** `POST /wp-admin/admin-ajax.php` (`action=wp-manga-search-manga&title=…`)
répond en ~500 octets (titre + URL) contre 175 Ko pour la page de résultats. Les requêtes
longues sont retentées en variantes légères (avant « : », sans numéro de saison) ; la page
n'est qu'un dernier recours, et les réponses sont mises en cache 5 min (pages 30 s).

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

**Corrections v2.2.3 — chapitres téléchargés enfin lisibles :** l'identifiant de chapitre
contenait le titre **déjà URL-encodé** (`Kaoru%20Hana%20…`). Seanime tire de cet identifiant à la
fois un nom de dossier et un chemin d'URL ; l'échappement prévu pour les espaces (`$SPACE$`) était
donc contourné, et le serveur décodait `%20` en espace au moment de servir le fichier → **404 sur
chaque page**, lecteur blanc, alors que la lecture en ligne fonctionnait. L'identifiant porte
maintenant le titre brut et l'encodage se fait au moment de construire l'URL de l'image.

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
- **Chercher l'endpoint AJAX du thème avant de parser des pages.** Sur les sites WordPress
  (wp-manga/Madara), la page de résultats pèse 150–200 Ko alors que
  `POST /wp-admin/admin-ajax.php` (`action=wp-manga-search-manga&title=…`) répond en ~500
  octets avec titre + URL. Même logique qu'`anime-sama` avec `fragment.php`. Ne garder le
  parsing de page qu'en repli, et jamais mot par mot : une variante raccourcie (avant « : »,
  sans numéro de saison) coûte moins cher qu'un téléchargement complet.
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
