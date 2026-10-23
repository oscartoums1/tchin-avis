# Tchin — le site des invités

Le site que les invités ouvrent en scannant le QR code du menu imprimé par
l'app Tchin. Il affiche **exactement les cocktails de la soirée** (la
sélection voyage dans l'URL, encodée par l'app — aucune base nécessaire pour
imprimer un menu).

| Page | Lien | Pour qui |
| --- | --- | --- |
| `commande.html` | `#c=<payload>` | **Les invités commandent** (QR des menus actuels) |
| `bar.html` | `#b=<payload>.<clé>` | L'équipe gère les commandes (lien secret partagé depuis l'app) |
| `index.html` | `#m=` / `#r=` | Avis par cocktail — l'ancien système, gardé pour les menus déjà imprimés |

Payload : base64url de `1|<partyId>|<nom>|<aaaa-mm-jj>|<cocktail1>~<cocktail2>…`.

## Le bar en direct (commandes)

1. **L'invité** scanne le QR du menu → donne son prénom (une fois) → touche
   un cocktail → quantité, **où il est** (les lieux de la salle définis dans
   l'app, ou un endroit libre) et une précision éventuelle → « Commander ».
   Il suit ensuite sa commande en direct : reçue (avec sa place dans la
   file et l'attente estimée) → en préparation → servie. Une fois servi, il
   note **le cocktail, la rapidité, le service et l'expérience** (1 à 5) et
   laisse un mot s'il veut. Il peut annuler tant que rien n'est commencé.
2. **L'hôte**, dans l'app (Soirée → Bar en direct), reçoit les commandes en
   temps réel (son, vibration, toast) avec le prénom et l'endroit, les fait
   avancer en un tap, voit le bilan (verres servis, attente moyenne, avis,
   commentaires), met le bar en pause avec un message, déclare des
   ruptures, et peut partager le lien `bar.html` à qui l'aide au bar.

La page et l'app se resynchronisent toutes les 3 à 5 secondes (pas de
WebSocket : robuste sur un réseau de salle des fêtes).

### Sécurité

La clé « anon » est publique (elle est dans `config.js`) : elle n'a **aucun
accès direct** aux tables `soirees` et `commandes` (RLS sans policy +
droits retirés). Tout passe par des fonctions de la base :

- l'hôte présente la **clé secrète de la soirée**, générée par l'app et
  gardée sur son téléphone (la base n'en stocke que l'empreinte SHA-256) ;
  le QR des invités ne la contient pas ;
- chaque invité a un **jeton aléatoire** dans son navigateur : il ne voit,
  n'annule et ne note que ses propres commandes.

## Mise en service

1. **GitHub Pages** — Settings → Pages → « Deploy from a branch » → `main`,
   `/ (root)`. Le site vit sur `https://oscartoums1.github.io/tchin-avis/`
   (`GuestSite.baseURL` dans l'app).
2. **Supabase** — projet gratuit, puis SQL Editor → New query :
   - `setup.sql` (les avis, ancien système) ;
   - **`commandes.sql`** (le bar en direct) → Run. La dernière ligne du
     résultat doit afficher **« Bar en direct installé et vérifié ✓ »** : le
     script se teste lui-même de bout en bout et ne laisse aucune trace.
     Ré-exécutable sans risque.
3. URL du projet et clé « anon public » dans **`config.js`** (une seule
   source pour toutes les pages) — et dans `LiveBarBackend.swift` côté app.

⚠️ L'offre gratuite de Supabase **met le projet en pause après 7 jours sans
activité** (l'adresse du projet ne répond plus du tout). Avant une soirée :
dashboard Supabase → le projet → « Restore project », puis ouvrir le bar
dans l'app pour vérifier.

## Notes

- Aucun build : HTML/CSS/JS vanilla, zéro dépendance (hors polices Google).
  Déployer = commit + push. `commun.js` regroupe le décodage du lien et les
  appels à la base pour `commande.html` et `bar.html`.
- Avis par cocktail (`index.html`) : ré-envoyer met à jour (contrainte unique
  soirée + prénom + cocktail) ; l'hôte peut mettre un avis à la corbeille
  (`party_id` préfixé `corbeille:`, récupérable) ; « Je n'y ai pas goûté »
  reste local.
- Test local : servir le dossier (`python3 -m http.server`) et poser une
  config de test :
  `localStorage.setItem('tchin:config', JSON.stringify({SUPABASE_URL:"…", SUPABASE_ANON_KEY:"…"}))`.
