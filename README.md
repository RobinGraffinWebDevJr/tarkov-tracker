# Tarkov Tracker

Compagnon de bureau pour Escape from Tarkov : ce qu'il manque pour monter la planque, avec une
estimation du coût au prix moyen du flea market (PvP et PvE séparés).

> Projet personnel, non affilié à Battlestate Games. Les données du jeu viennent de
> [tarkov.dev](https://tarkov.dev). Certaines fonctions lisent l'écran du jeu (capture de sa fenêtre)
> ou, ponctuellement et en lecture seule, ses fichiers de logs sur le disque : aucun accès à la
> mémoire du jeu, aucune injection. Battlestate n'a pas confirmé officiellement que ce soit sans
> risque pour un compte : voir `docs/etat-du-projet.md`, §6.

## Fonctions

- **Planque** : ce qu'il manque pour chaque zone, priorités d'amélioration dans l'ordre, coût estimé.
- **Marché** : prix du flea, favoris, classement par prix par case.
- **Quêtes** : avancement importé une fois depuis les logs du jeu, objectifs, objets et prix.
- **Scan inventaire** *(en test)* : lit les pages de la « Recherche d'objet » du stash et reconnaît
  les objets (icône + nom lu par l'OCR de Windows) pour refléter l'inventaire.

État détaillé, architecture, mesures et prochaines étapes : [`docs/etat-du-projet.md`](docs/etat-du-projet.md).

## Installation (Windows)

Télécharge `tarkov-tracker-windows-x64.exe` dans les
[Releases](../../releases/latest) et lance-le : aucune installation. Le programme n'étant pas
signé, Windows peut afficher « Windows a protégé votre ordinateur » : *Informations
complémentaires* → *Exécuter quand même*.

## Développement

```
npm install
npm run dev        # lance l'app (couper et relancer après toute modification de src/main ou src/preload)
npm run typecheck
npm run build:win  # exe Windows (depuis Windows ou la CI)
```

## Données

Fichiers JSON statiques de `json.tarkov.dev` (items, planque, prix du flea, traductions), mis en
cache 15 minutes sur le disque. Voir `src/main/tarkov.ts`.
