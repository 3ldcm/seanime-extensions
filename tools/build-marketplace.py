#!/usr/bin/env python3
"""Génère la marketplace Seanime (marketplace.json) et le catalogue statique (docs/index.html).

Usage :  python3 tools/build-marketplace.py
Sorties :
  marketplace.json  — format attendu par le champ « Marketplace URL » de Seanime
                       (tableau JSON d'extensions, cf. internal/extension_repo/marketplace.go)
  docs/index.html   — catalogue visuel (GitHub Pages), même données

Règle : ne jamais inventer une version — la version affichée vient du manifeste,
et le payload affiché est comparé au manifeste pour que le lien d'installation
pointe toujours vers le bon fichier.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
RAW = "https://raw.githubusercontent.com/3ldcm/seanime-extensions/refs/heads/main"

# Type du manifeste -> libellé et regroupement d'affichage
TYPE_LABEL = {
    "onlinestream-provider": "Streaming",
    "manga-provider": "Manga",
    "anime-torrent-provider": "Torrent",
    "plugin": "Plugin",
    "custom-source": "Source",
}

# Notes courtes par extension (le README garde le détail)
NOTES = {
    "anime-sama": [
        "Referer anti-hotlink : `episodes.js` répondait 403 et la liste d'épisodes restait vide.",
        "Packer base 62 repaired (`Number.toString(62)` threw et annulait toute l'extraction).",
        "Embed4me passe par son API + AES-CBC, délai borné à 15 s au lieu de 134 s.",
        "Faux flux (Big Buck Bunny) et doublons filtrés. Sibnet désactivé (403 quel que soit le Referer).",
    ],
    "anime-sama-ansembed": [
        "Provider dédié au seul lecteur AnsEmbed, indépendant du provider Anime-Sama.",
    ],
    "anime-sama-manga": [
        "Recherche via `GET /catalogue/fragment.php?search=…&type[]=Scans` (le HTML de `/catalogue/` ne contient plus aucune carte).",
        "Identifiant de chapitre sans texte URL-encodé : les chapitres téléchargés répondaient 404 sur chaque page.",
        "⚠️ Désinstaller d'abord l'original (`animesamamanga` de pal-droid) : même `id`, les deux ne peuvent pas coexister.",
    ],
    "chrome-cast": [
        "Cast natif via Remote Playback API (`video.remote.prompt()`) et non l'URL MP4 brute.",
        "Tampon d'épisode en attente + sélection de source plus fine.",
        "Permission `dom-script-manipulation` requise pour injecter les contrôles dans le lecteur.",
    ],
    "franime": [
        "Basé sur l'API publique `api.franime.fr`.",
    ],
    "sushiscan": [
        "User-Agent navigateur toujours envoyé : Cloudflare répond 403 sur un UA vide.",
        "Bypass FlareSolverr optionnel (activé par défaut = non).",
    ],
    "voir-anime": [
        "Version stable historique du provider VoirAnime.",
    ],
    "voir-anime-v2": [
        "Recherche AJAX `POST /wp-admin/admin-ajax.php` : ~500 o au lieu d'une page de 175 Ko.",
        "Cache : réponses 5 min, pages épisode/série 30 s.",
        "Lecteurs exposés : `mytv` et `stape` uniquement — les seuls qui renvoient un flux.",
        "Redirections JS suivies, faux flux filtrés, reconstruction Streamtape corrigée.",
    ],
}

# Ordre d'affichage
ORDER = [
    "voir-anime-v2",
    "voir-anime",
    "anime-sama",
    "anime-sama-ansembed",
    "franime",
    "anime-sama-manga",
    "sushiscan",
    "chrome-cast",
]


def payload_file(manifest: dict, ext_dir: str) -> str:
    """Fichier réel du payload (provider.js, main.ts, payload.ts, plugin.ts)."""
    uri = manifest.get("payloadURI") or ""
    if uri:
        return uri.rsplit("/", 1)[-1]
    for cand in ("payload.ts", "payload.js", "provider.js", "main.ts", "plugin.ts"):
        if os.path.isfile(os.path.join(ext_dir, cand)):
            return cand
    return ""


def collect():
    items = []
    for ext in ORDER:
        ext_dir = os.path.join(ROOT, ext)
        mpath = os.path.join(ext_dir, "manifest.json")
        if not os.path.isfile(mpath):
            print(f"  ! {ext}: manifeste absent, ignoré", file=sys.stderr)
            continue
        manifest = json.load(open(mpath, encoding="utf-8"))
        pfile = payload_file(manifest, ext_dir)
        icon_file = next(
            (c for c in ("icon.png", "icon.jpg", "icon.jpeg", "icon.webp")
             if os.path.isfile(os.path.join(ext_dir, c))), "")
        icon = f"{RAW}/{ext}/{icon_file}" if icon_file else ""
        items.append(
            {
                "dir": ext,
                "name": manifest.get("name") or ext,
                "version": manifest.get("version") or "0.0.0",
                "id": manifest.get("id") or ext,
                "type": manifest.get("type") or "onlinestream-provider",
                "typeLabel": TYPE_LABEL.get(manifest.get("type", ""), "Autre"),
                "lang": manifest.get("lang") or "",
                "author": manifest.get("author") or "",
                "description": manifest.get("description") or "",
                "language": manifest.get("language") or "typescript",
                "icon": icon,
                "install": f"{RAW}/{ext}/manifest.json",
                "payload": f"{RAW}/{ext}/{pfile}" if pfile else "",
                "source": f"https://github.com/3ldcm/seanime-extensions/tree/main/{ext}",
                "notes": NOTES.get(ext, []),
                "experimental": "expérimental" in (manifest.get("description") or "").lower()
                or "experimental" in (manifest.get("description") or "").lower(),
            }
        )
    return items


def marketplace_entries(items):
    """Format attendu par le champ « Marketplace URL » de Seanime.

    Le backend (internal/extension_repo/marketplace.go) fait :
        json.Unmarshal(body, &[]extension.Extension)
    puis ne garde que les entrées avec ID et ManifestURI non vides.
    Le fichier DOIT donc être un tableau JSON — pas une page HTML.
    """
    out = []
    for it in items:
        out.append(
            {
                "id": it["id"],
                "name": it["name"],
                "version": it["version"],
                "description": it["description"],
                "author": it["author"],
                "manifestURI": it["install"],
                "payloadURI": it["payload"],
                "icon": it["icon"],
                "type": it["type"],
                "language": it["language"],
                "lang": it["lang"] or "multi",
                "website": "https://github.com/3ldcm/seanime-extensions",
                "readme": "https://github.com/3ldcm/seanime-extensions",
                "notes": "\n".join("- " + n for n in it["notes"]),
            }
        )
    return out


def main():
    items = collect()
    os.makedirs(DOCS, exist_ok=True)

    mp_path = os.path.join(ROOT, "marketplace.json")
    entries = marketplace_entries(items)
    payload = json.dumps(entries, ensure_ascii=False, indent=2) + "\n"
    with open(mp_path, "w", encoding="utf-8") as f:
        f.write(payload)
    print(f"{len(entries)} extensions écrites dans {mp_path}")

    # copie servie par GitHub Pages (docs/ est la racine du site)
    with open(os.path.join(DOCS, "marketplace.json"), "w", encoding="utf-8") as f:
        f.write(payload)
    print(f"{len(entries)} extensions écrites dans {os.path.join(DOCS, 'marketplace.json')}")

    out = os.path.join(DOCS, "index.html")
    with open(out, encoding="utf-8") as f:
        template = f.read()
    html = template.replace("/*__DATA__*/[]", json.dumps(items, ensure_ascii=False))
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"{len(items)} extensions écrites dans {out}")
    for it in items:
        print(f"  - {it['name']:22} {it['version']:8} {it['typeLabel']}")


if __name__ == "__main__":
    main()
