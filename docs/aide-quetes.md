# Aide aux quêtes (histoire) sans quitter le tracker : réflexion

Statut : **idée à approfondir plus tard**, rien n'est implémenté. Document rédigé le 25/11/2026.

## Ce que l'on veut

Pour les quêtes, surtout celles de l'histoire (celles qui demandent de chercher un endroit, un objet,
une action précise), le joueur doit pouvoir **voir l'aide dans le tracker**, sans ouvrir le wiki :

- la **carte du jeu** concernée, avec l'emplacement de l'objectif ;
- les **captures d'aide** que le wiki Fandom propose pour la quête ;
- uniquement pour **les quêtes que le joueur doit encore faire** (en cours ou disponibles), pas pour
  toutes. On ne veut pas embarquer tout le contenu avec l'application.

Aujourd'hui, l'onglet Quêtes affiche les objectifs en français et un lien « Page du wiki » : l'aide est
déléguée à Fandom, le joueur quitte le tracker.

## Ce qui est déjà disponible sans Fandom (vérifié)

Source : tarkov.dev (`https://json.tarkov.dev/{mode}/tasks`, `maps`) et son dépôt
`the-hideout/tarkov-dev` (licence **MIT**, actif).

- 499 quêtes PvE, 1 384 objectifs, textes en français.
- **429 objectifs ont une zone** avec position, taille et contour en coordonnées du jeu.
  Les objets de quête ont des `possibleLocations` (liste de positions par carte).
- Les cartes ont leurs extractions, points d'apparition et conteneurs.
- `src/data/maps.json` du dépôt tarkov-dev donne, pour chaque carte : le **SVG**
  (`https://assets.tarkov.dev/maps/svg/<Carte>.svg`), les **tuiles**, la **rotation**, la
  **transformation** coordonnées du jeu → pixels, et les **étages**.
- `assets.tarkov.dev` est déjà autorisé dans la politique de sécurité du tracker.

Ce qui manque côté tarkov.dev : les objectifs sans position (compétences, niveaux de marchand, certains
« tuer »), et tout **commentaire de joueur** du type « l'objet est derrière la porte rouge, à droite ».
C'est précisément ce que le wiki apporte en plus.

## Ce que le wiki Fandom offre (partiellement vérifié)

Vérifié le 25/11/2026 :

- L'**API MediaWiki** répond : `https://escapefromtarkov.fandom.com/api.php` (requêtes
  `action=query`, `prop=images`, `meta=siteinfo`…). On peut donc lister les images d'une page et lire
  le texte sans « scraper » du HTML.
- La licence déclarée par le wiki est **CC BY-NC-SA** (`rightsinfo`). Donc **non commerciale**,
  **attribution** obligatoire, **partage à l'identique**.
- Le serveur est derrière **Cloudflare** : `robots.txt` a renvoyé une page « Just a moment… » (défi
  anti-robot). L'API a répondu, mais l'accès automatisé peut être bloqué ou limité sans prévenir.

Non vérifié (à tester avant de s'engager) :

- Quelles images d'aide existent réellement pour les quêtes de l'histoire, et sous quelle licence
  **chacune** : sur Fandom, la licence du texte ne couvre pas forcément les captures du jeu, qui
  appartiennent à Battlestate Games et sont souvent déposées en « usage loyal » sur le wiki. Les
  rediffuser dans une application n'est pas la même chose que les afficher sur le wiki.
- Les conditions d'utilisation de Fandom pour l'accès automatisé.
- La stabilité de l'API (limites de débit, blocages Cloudflare selon l'adresse).

## Options

| Option | Idée | Avantages | Limites |
|---|---|---|---|
| A. Lien externe (actuel) | « Page du wiki » ouvre Fandom | Aucun souci de licence, rien à maintenir | Le joueur quitte le tracker |
| B. Page du wiki intégrée | Afficher la page Fandom dans une fenêtre du tracker | Aucun contenu copié | À tester : le site peut interdire l'intégration (en-têtes), pubs et défi Cloudflare dans la fenêtre ; ce n'est pas une vraie intégration |
| C. Contenu du wiki via l'API, à la demande | Pour une quête donnée, récupérer texte et images par l'API, les afficher et les garder en cache | Ce que tu décris : dans le tracker, seulement les quêtes utiles | Licence CC BY-NC-SA (non commercial, attribution, partage à l'identique) ; images à vérifier une par une ; risque de blocage Cloudflare ; contenu à nettoyer (le wikitexte n'est pas de l'HTML propre) |
| D. Contenu maison | Nos propres cartes et marqueurs (données tarkov.dev, MIT), nos propres textes d'aide | Aucun risque de licence ni de blocage, fonctionne hors ligne | Pas de captures « où chercher » : on a la position, pas le commentaire d'un joueur |
| E. Hybride (recommandé à étudier) | D en base (carte + position + objectifs), puis pour chaque quête un bouton « Voir l'aide du wiki » qui affiche le texte et les images par l'API **à la demande**, avec attribution et lien vers la page d'origine | Meilleure expérience, peu de stockage, la source est toujours citée | Cumule les limites de C ; doit rester non commercial |

## Recommandation provisoire

1. Faire d'abord **D** : la carte avec les zones des objectifs, c'est ce qui a le plus de valeur et ne
   dépend de personne. C'est l'étape « Carte » déjà prévue.
2. Tester **C** sur 3 ou 4 quêtes d'histoire avant de décider : voir ce que l'API renvoie vraiment
   (texte, images, licence de chaque fichier) et si Cloudflare laisse passer un client de bureau.
3. Si les images ont une licence réutilisable, ou si l'on accepte de ne montrer que du texte et des
   liens vers les images sur le site d'origine, passer à **E**. Sinon rester sur **D + A**.

## Règles à respecter si on utilise le contenu du wiki

- Citer la source (nom de la page, lien, licence) à côté de chaque contenu repris.
- Usage non commercial uniquement. Si le tracker devait un jour être payant ou comporter de la
  publicité, ce contenu devrait être retiré.
- Ne stocker que ce qui sert au joueur (quêtes en cours ou disponibles), avec une durée de cache
  limitée, et pas de copie de tout le wiki.
- Limiter le débit des requêtes et prévoir un repli propre (lien externe) si l'accès est refusé.
- Les captures de jeu restent la propriété de Battlestate Games : ne les afficher que si le test
  montre que leur licence ou leur usage le permet.

## Questions ouvertes

- Que veut-on afficher exactement pour une quête d'histoire : la carte annotée, le texte du guide, les
  captures d'écran, ou les trois ?
- Le tracker restera-t-il gratuit et non commercial ? (conditionne l'usage du contenu Fandom)
- Accepte-t-on une dépendance à un site externe susceptible de bloquer l'accès ?
- Existe-t-il une source communautaire plus ouverte pour des captures d'aide (à chercher) ?

## Prochaines étapes quand on y revient

1. Construire la carte (option D) avec les zones des objectifs.
2. Script de test : pour 5 quêtes d'histoire, récupérer via `api.php` la liste des images, leur licence
   (`prop=imageinfo&iiprop=extmetadata`) et le texte (`action=parse`), et noter ce qui est exploitable.
3. Décider entre D + A et E selon le résultat.
