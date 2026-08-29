# Tchin — Vos avis

Le site que les invités ouvrent en scannant le QR code du menu imprimé par
l'app Tchin. Il affiche **exactement les cocktails de la soirée** (la
sélection voyage dans l'URL, encodée par l'app — aucune base nécessaire pour
imprimer un menu), demande le **prénom** de l'invité, puis recueille une
**note sur 10** et un commentaire par cocktail.

- `…/#m=<payload>` — le parcours invité (prénom → notes → envoi) ;
- `…/#r=<payload>` — la vue hôte (moyennes, nombre d'avis, commentaires),
  ouverte depuis l'app via « Voir les avis des invités ».

Chaque avis enregistré est rattaché à **Soirée → Cocktail → Invité**
(`party_id`, `cocktail`, `guest_name`, `rating`, `comment`).

## Mise en service (une seule fois)

1. **GitHub Pages** — sur ce dépôt : Settings → Pages → « Deploy from a
   branch » → branche `main`, dossier `/ (root)` → Save.
   Le site vit alors sur `https://oscartoums1.github.io/tchin-avis/`
   (l'URL que l'app met déjà dans les QR codes — `ReviewSite.baseURL`).

2. **Supabase** (le stockage des avis) —
   1. créer un projet sur [supabase.com](https://supabase.com) (offre gratuite) ;
   2. SQL Editor → coller le contenu de `setup.sql` → Run ;
   3. Settings → API : copier « Project URL » et la clé « anon public » ;
   4. les coller dans le bloc `TCHIN_CONFIG` en haut d'`index.html`, commit, push.

Sans l'étape 2, le site fonctionne quand même en mode dégradé : l'invité
compose ses avis puis les **envoie par message** à l'hôte (feuille de
partage), au lieu de les déposer dans la base.

## Notes

- Ré-envoyer ses avis **met à jour** les précédents (contrainte unique
  soirée + prénom + cocktail, envoi en `merge-duplicates`) — pas de doublons.
- Deux invités qui partagent le même prénom à la même soirée écrasent
  mutuellement leurs avis : qu'ils ajoutent une initiale (« Léa B. »).
- La clé « anon public » est faite pour être publiée côté client ; la RLS
  ne permet que déposer/mettre à jour/lire des avis, rien d'autre.
- Test local : servir le dossier (`python3 -m http.server`) et passer une
  config de test via
  `localStorage.setItem('tchin:config', JSON.stringify({SUPABASE_URL:"…", SUPABASE_ANON_KEY:"…"}))`.
