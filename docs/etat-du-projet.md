# État du projet et reprise

Document de reprise, rédigé le 26/11/2026 à la fin de la session de travail. Il dit où en est le
tracker, comment il est construit, ce qui a été mesuré (y compris ce qui n'a PAS marché), comment
tester, et quoi faire ensuite. À lire avant de reprendre.

## 1. But du projet

Un tracker de bureau (Electron + React + TypeScript) pour Escape from Tarkov, qui sait **ce qui
manque au joueur** pour monter sa planque et faire ses quêtes, en reflétant son vrai inventaire :

1. calculer ce qu'il manque pour chaque zone de la planque, et dans quel ordre s'en occuper ;
2. suivre le marché (flea) : favoris, classement, prix par case ;
3. suivre l'avancement des quêtes sans saisie à la main ;
4. **miroir de l'inventaire** : lire le stash du joueur par capture d'écran et en tirer les quantités.

Contraintes du propriétaire : le risque de ban est la préoccupation numéro un ; l'utilisateur ne doit
scanner qu'une fois (puis le tracker se met à jour) ; l'inventaire est un **instantané qui remplace**
le précédent, jamais un cumul.

## 2. Ce qui existe (au 26/11/2026)

| Onglet | État | Fichiers clés |
|---|---|---|
| **Planque** | Fonctionne. Vue « Priorités » (ordre des améliorations), réglage des niveaux par zone, « Marquer comme construite » (monte le niveau et retire les objets de l'inventaire), vues « Par item » et « Par zone ». | `src/shared/priorities.ts`, `src/renderer/src/pages/HideoutPriorities.tsx`, `HideoutPage.tsx`, `src/main/tarkov.ts` |
| **Marché** | Fonctionne. Prix tarkov.dev (cache 15 min), favoris, classement par prix par case, variation 48 h. | `src/main/market.ts`, `MarketPage.tsx` |
| **Quêtes** | Fonctionne. Import ponctuel depuis les logs du jeu, filtre « En cours » par défaut, objectifs / prérequis / objets et prix, statut modifiable. | `src/main/questLogs.ts`, `src/main/tasks.ts`, `src/shared/quests.ts`, `QuestsPage.tsx` |
| **Scan inventaire** | Capture des pages de la « Recherche d'objet » du stash, puis **reconnaissance des objets** (nouveau, en test). | voir §4 |

Pas encore fait : lecture de l'argent et des quantités de piles, équipement porté / présentoirs /
mannequin, carte des quêtes, comparaison entre deux scans, mémoire des confirmations (voir §7).

## 3. Architecture

- `src/main` : processus principal (accès disque, réseau, logs, capture d'écran, OCR).
- `src/preload/index.ts` : pont IPC exposé à l'interface (`window.api`).
- `src/renderer` : interface React.
- `src/shared` : fonctions pures, partagées et testables sans Electron.
- Données utilisateur dans `app.getPath('userData')` : `progress-<mode>.json` (niveaux de planque,
  inventaire, quêtes), `hideout-cache-v2-*`, `market-cache-*`, `tasks-cache-v2-*`, `catalog-v2-*`,
  `grid-cache/` (images de référence WebP). Scans dans `Documents/Tarkov Tracker/scans/<date>/`.
- PvP et PvE sont séparés partout (fichiers de progression distincts).

Données : fichiers JSON statiques de `json.tarkov.dev` (planque, objets, quêtes, traductions fr).
tarkov.dev n'indique pas ce qui se trouve en raid, et ne donne pas les « Kappa » complets (13 seulement).

## 4. Le scan et la reconnaissance des objets (le gros chantier)

### 4.1 Capture (`src/main/scan.ts`, `pageCollector.ts`, `searchWindow.ts`, `pagerGlyphs.ts`)

- Capture passive de la fenêtre du jeu (`desktopCapturer`), jeu en **fenêtré sans bordure, 1920×1080**.
- Détecte la fenêtre « Recherche d'objet » (barre de titre de couleur exacte), lit la pagination par
  modèles de chiffres (jusqu'à 2 chiffres, donc 99 pages) et enregistre **une image par page**, dès
  qu'elle est stable. Les pages manquantes sont signalées (« Pages à voir »), à partir du plus grand
  numéro vu : rien n'est figé à 13 pages.
- `pages.json` mémorise pour chaque page son numéro, son fichier et **la position de la grille**
  (`gx`, `gy`) : indispensable à la reconnaissance (les scans d'avant cette version n'en ont pas).
- Plafond de 150 images par session. Journal dans `scan.log`.

### 4.2 Reconnaissance (lancée par « Analyser le dernier scan »)

Pipeline, dans l'ordre :

1. **Catalogue et images** (`src/main/recognition.ts`) : objets tarkov.dev (taille, types, pile,
   image de grille 64 px/case), images téléchargées une fois et mises en cache sur disque.
   Electron ne décode pas le WebP (`nativeImage`) : le décodage se fait côté interface
   (`createImageBitmap`).
2. **Comparaison des icônes** (`src/shared/recognition.ts`, dans des **workers** : la moitié des
   cœurs, 6 au plus) : pour chaque case occupée, essai de toutes les tailles d'objet (≤ 8×4) ;
   corrélation normalisée centrée par canal, en ignorant le nom (haut), l'étoile et la coche /
   quantité (bas) ; pénalité de couleur moyenne (`colorWeight = 1`) ; recherche en deux temps
   (`coarseKeep = 48` : tri grossier sur 1 pixel sur 4, puis comparaison exacte des 48 meilleurs).
3. **Lecture du nom** (`src/main/ocr.ts`, `src/shared/labels.ts`) : l'étiquette (17 px du haut de la
   case) est préparée (inversée, agrandie ×4 / ×4 contraste étiré / ×6) et lue par l'OCR intégré à
   Windows (`Windows.Media.Ocr` via PowerShell, images dans un dossier temporaire supprimé). Trois
   lectures par case.
4. **Croisement nom + icône** (`src/shared/names.ts`) : `resolveNames` rend un verdict
   `match` (le nom concorde avec un candidat de l'icône), `found` (l'icône n'a pas proposé l'objet
   mais un seul objet de même taille porte ce nom), `contradict` (un nom, même court, ne ressemble à
   aucun candidat), `unknown` (nom illisible). Un nom lu identique écarte les noms seulement voisins,
   sauf ceux qui commencent par le nom lu (le jeu coupe les noms longs). Quand plusieurs objets
   portent le nom, l'icône les départage (`refineWithIcon`, avec la **couleur de l'objet seul**) ;
   sans nom lisible, la couleur reclasse les 5 meilleurs (`refineByColor`).
5. **Décision** (`src/shared/decision.ts`) : `judge` dit si une case est « fiable » (comptée sans
   confirmation) ; `usefulness` dit si elle concerne un objet de la planque ou d'une quête en cours.
6. **Orchestration** (`src/renderer/src/recognition/analysisStore.ts`) : l'analyse vit hors des
   composants, donc **continue quand on change d'onglet** ; dogtags écartés ; cases dont presque tous
   les candidats sont des munitions / grenades / pièces d'arme écartées de la liste « utile » ; l'argent
   n'est pas un objet « utile » ; en mode dev, écrit `analysis.json` à côté du scan.
7. **Écran** (`ScanAnalysis.tsx`) : « À confirmer » (objets utiles douteux, cases identiques
   regroupées pour une seule confirmation), « Reconnus avec certitude », « Enregistrer dans
   l'inventaire » (remplace l'inventaire ; les piles ne sont pas comptées, ce qui était saisi est gardé).

### 4.3 Règles de fiabilité et leur preuve

Mesures sur 556 cases dont l'objet était connu (étiquetées par accord nom + icône), puis sur 600 cases
pour le croisement avec le nom :

- Le **score d'icône seul est un mauvais indicateur** (à 0,8, un quart de réponses fausses).
  **L'écart avec le deuxième candidat** est le bon : écart ≥ 0,1 et score ≥ 0,4 → 280 sur 280 justes ;
  score ≥ 0,7 et écart ≥ 0,05 → 295 sur 296 ; l'une ou l'autre → 63 % des cases, 99,7 % justes.
- Nom + icône d'accord : **546 bons choix sur 546, 0 mauvais** (600 cases). Trois lectures de nom
  combinées : 91 % des noms lus (une seule : 80-84 %).
- Un seul objet de même taille porte le nom lu : 401 sur 401 justes.
- Départage par l'icône parmi des objets de même nom : 33 sur 33 justes.
- Couleur moyenne dans le score : cases acceptées d'office 63 % → 67 %.

### 4.4 Ce qui a été essayé et n'a PAS marché (ne pas refaire)

- Restreindre la recherche aux seuls objets utiles : beaucoup de faux positifs (un objet inutile est
  pris pour un objet utile). Il faut comparer au catalogue complet.
- Apprendre des captures validées comme modèles supplémentaires : 87,1 % → 82,6 % (pire, même avec
  pénalité).
- Faire pivoter les modèles de 90° : aucun gain.
- Corrélation pondérée par l'objet : 81 % → 76 %, et choisit la mauvaise lampe.
- Mémoire d'étiquettes d'un scan à l'autre : très fiable (99,8 %) mais ne récupère que 12-14 cases.

### 4.5 Résultats sur un scan neuf (scan du 25/11/2026, 13 pages, PvE)

- 887 cases, 91 dogtags écartés, **664 fiables, 6 utiles à confirmer (5 groupes)**, 69 s au total
  (pages 46 s, noms 16 s) sur 16 cœurs avec 3 workers (depuis : la moitié des cœurs, 6 au plus).
- Audit visuel : parmi les 211 cases **utiles** acceptées, les 35 qui reposent sur un seul signal sont
  toutes justes. Les erreurs trouvées touchaient des objets inutiles (« Eau » classée Wilston, « RC2 »
  classée HX-QD, dollars classés euros : nom de 3 lettres ignoré, corrigé depuis) et deux erreurs de
  **taille** (voir §7).
- Cas restants à confirmer par l'utilisateur : Clé USB sécurisée / chiffrée (même nom et même icône),
  SpecterDR / FDE, et trois noms illisibles (Zm apt. 2 = « Zm apt. 20 » tronqué, USB militaire, Code 2).

## 5. Quêtes depuis les logs (`questLogs.ts`, `shared/quests.ts`)

- Lecture **ponctuelle et en lecture seule** de `C:\Battlestate Games\Escape from Tarkov\Logs`
  (fichiers `*notifications*.log`, messages `ChatMessageReceived` de type 10 début / 11 échec / 12 fin).
  Jamais de surveillance continue, jamais le texte des messages.
- Mode PvE / PvP déduit de l'adresse du serveur écrite dans les journaux de chaque session.
- Wipes : une quête terminée puis recommencée marque un nouveau wipe, placé au plus long silence.
- Les logs ne donnent ni l'avancement des objectifs, ni la planque, ni le niveau, ni l'inventaire.
- Aide aux quêtes sans quitter le tracker (cartes, captures du wiki) : voir `docs/aide-quetes.md`.

## 6. Risque de ban

Aucune confirmation officielle de Battlestate. Le tracker ne lit que des **captures d'écran** de la
fenêtre du jeu et, ponctuellement, des **fichiers de logs** sur le disque ; il ne touche ni à la
mémoire du jeu ni à ses fichiers, et n'injecte rien. TarkovMonitor (outil connu) lit aussi les logs et
déclare n'avoir « aucune information officielle de BSG ». À garder : pas de surveillance continue des
logs, pas de raccourci clavier dans le jeu. À faire : demander à Battlestate.

## 7. Prochaines étapes (par ordre de valeur)

1. **Erreurs de taille** : un objet 1×2 ou 2×2 retenu alors que ce sont deux petits objets (« Pass de
   presse », « Caiman » dans l'audit). Piste : un second nom est visible dans une sous-case de
   l'objet ; vérifier l'absence d'étiquette dans les sous-cases.
2. **Mémoire des confirmations** : quand l'utilisateur confirme une case, garder l'empreinte de son
   étiquette → objet (concordance mesurée à 99,8 %), la persister, et ne l'utiliser que si
   l'étiquette ET l'icône concordent (évite les faux positifs). Règle aussi OLOLO, USB, Code 2.
3. **Comparaison entre deux scans** : « +3 Relais, −1 Cisailles » ; l'inventaire reste un instantané.
4. **Argent et quantités** : chiffres en police fixe, lisibles par modèles comme les numéros de page ;
   l'argent est dans la barre du haut. Un seul des 104 objets de planque recherchés est empilable, donc
   la priorité vient des euros / roubles / dollars.
5. **Lecture des noms courts ou en gras** (USB, OLOLO, Code 2, « Zm apt. 20 » lu « Zm apte 2 ») :
   reconnaissance de glyphes maison, ou lectures OCR supplémentaires sur les seules cases douteuses
   (6 réglages = 92 % au lieu de 90 %).
6. Équipement porté, présentoirs d'armes et d'équipement, mannequin ; carte des quêtes
   (`docs/aide-quetes.md`) ; page « Que vendre » liant l'inventaire au marché.
7. Munitions et grenades : écartées pour l'instant, à affiner plus tard.
8. Publier une version : `package.json` est en 0.1.2, les nouveautés ne sont pas dans une release.

## 8. Tester et déboguer

```
npm install
npm run dev              # l'interface se recharge à chaud, PAS le processus principal ni le preload
npm run typecheck
```

- Après toute modification de `src/main` ou `src/preload` : **couper et relancer** `npm run dev`.
- Scan : onglet « Scan inventaire » → « Démarrer le scan » → Recherche d'objet (filtre « cube », stash
  seulement) → tourner les pages une par une → « Terminer le scan » → « Analyser le dernier scan ».
  Un nouveau scan devient « le dernier » : pour repartir à zéro, renommer `scans` (ex. `scans-anciens`).
- En mode dev : bouton « Copier la liste à confirmer (dev) » et fichier `analysis.json` écrit dans le
  dossier du scan. La ligne « Durée » donne le temps de chaque étape, le nombre de workers et de cœurs.
- Contrôle de la précision : `python tools/audit_sheet.py <dossier du scan>` fabrique des planches
  (vignette, objet retenu, nom lu) à parcourir à l'œil pour repérer les erreurs.
- Lint : deux erreurs **déjà présentes avant ce chantier** : `compute.ts:19` (type de retour manquant)
  et `HideoutPage.tsx:42` (`setState` dans un effet).

## 9. Pièges connus

- Fichiers en fins de ligne CRLF (Windows) : attention aux remplacements de texte automatiques.
- Le même nom court peut désigner plusieurs objets (Lampe / Lampe EN / Lampe UV, Clé USB sécurisée /
  chiffrée, Dort. 203 / 204 / 220…) : le nom seul ne tranche pas, d'où le départage par l'icône.
- Les noms affichés dans le jeu sont coupés à la largeur de la case.
- Les images de référence de tarkov.dev portent des étiquettes en anglais : la zone du nom est
  masquée à la comparaison.
- Les scans d'avant l'enregistrement de `gx` / `gy` ne sont pas analysables.
- Résolution : seule 1920×1080 est prise en charge pour la lecture de la Recherche d'objet.
