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

Payload : base64url de `1|<partyId>|<nom>|<aaaa-mm-jj>|<cocktail1>~<cocktail2>…[|<signature>]`.
La signature (prénom de l'hôte, facultative) ferme la marche : les pages
affichent alors « Le bar d'Oscar » en tête et « Cocktails, carte et service
de commande imaginés par Oscar » en pied. Les liens à 5 champs restent valides.

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
   Il peut aussi **retirer un avis** (la commande reste servie, l'invité
   peut renoter) ou **supprimer une commande** (essai, doublon) — dans
   l'app (menu « … » d'une commande servie, croix sur chaque avis du
   bilan) comme sur `bar.html`.
3. **Le barman** voit pour chaque commande la **recette en doses de gobelet
   doseur**, déjà multipliée par le nombre de verres (bouton « Recette »),
   et en tête de liste « À préparer » : les cocktails en cours regroupés
   (« Mojito × 5 ») — un appui ouvre la recette pour toute la série, avec
   +/− pour ajuster. Les recettes voyagent dans la carte de la soirée
   (`soirees.carte[].recette` : `verre`, `garniture`, `ingredients[]`
   `{nom, dose?, texte}`, `etapes[]` ; `dose` absente = quantité libre) que
   l'app publie dès qu'on ouvre l'aperçu du menu ou le bar en direct. Une
   soirée publiée avant cette version affiche « recette pas encore envoyée »
   jusqu'à la prochaine ouverture dans l'app.
4. **Le comptoir (iPad)** : sur un écran d'au moins 740 × 560 px, `bar.html`
   passe en mode comptoir, pensé pour un rush d'une trentaine de commandes
   et une tablette posée sur le bar. **Plein écran** (lancé par « Commencer
   le service », bouton ⛶ ensuite) et **deux colonnes seulement** :
   ① **À lancer** — un **lot par cocktail** sur une seule rangée (verres,
   commandes, attente, lieux, précisions des invités), le plus ancien en
   haut : 30 commandes / 8 cocktails tiennent sur un écran ; « Lancer » part
   avec tout le lot, ▾ détaille chaque commande (lancer ou annuler une
   seule) ; ② **Au shaker** — les **séries** par cocktail, aussi compactes
   (même rangée, teintée d'or) avec « Tout servi ✓ » au bout ; ▾ ouvre la
   **tournée par lieu** (« Servir ✓ » la Terrasse d'un geste, ou commande
   par commande) et « Ajouter à la série ». Dans les deux colonnes, **un
   appui sur la rangée ouvre la recette** en doses pour tout le lot (avec
   ± et les étapes), en cas d'oubli. Après chaque changement, les boutons
   ignorent un second appui trop rapproché (0,45 s) : la rangée suivante
   qui remonte sous le doigt n'est pas servie par un rebond. Les **servies** sont derrière le petit onglet « Servies · N »
   (tiroir à droite, « ⋯ » pour rouvrir ou supprimer). L'écran de départ
   active aussi le son et garde l'écran allumé (Wake Lock) ; « Servi » se
   rattrape par « Annuler » dans le message ; pause et ruptures restent
   dans l'en-tête. Sur téléphone, rien ne change.

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

## Tester le SQL sans toucher à la production

`outils/` contient une réplique locale de Supabase sur un **vrai
PostgreSQL** (PGlite) : mêmes rôles `anon`, mêmes droits par défaut, mêmes
réponses d'erreur que l'API. Elle exécute `setup.sql` puis `commandes.sql`
deux fois (ré-exécutabilité), et `test_api.mjs` rejoue 65 vérifications
(commandes, file, ruptures, pause, annulation, avis, suppressions, sécurité).

```
cd outils && npm install
npm run base      # terminal 1 : la base locale sur http://127.0.0.1:8799
npm test          # terminal 2
```

Pour brancher le site dessus : servir le dossier et poser
`tchin:config` = `{"SUPABASE_URL": "http://127.0.0.1:8799", "SUPABASE_ANON_KEY": "local"}`.
