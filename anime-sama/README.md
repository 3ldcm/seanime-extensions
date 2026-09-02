# Anime-Sama provider

Le provider exact validé doit être récupéré depuis le dépôt GitHub existant de l'utilisateur.

`provider-reference.js` contient uniquement la logique critique reconstruite :
- regroupement des lecteurs par index d'épisode ;
- épisode 1 = groupe 0 ;
- test connu : Sibnet `videoid=6227176`.

Ne pas écraser un `provider.js` fonctionnel avec ce fichier sans comparaison.
