# Tarkov Tracker

Compagnon de bureau pour Escape from Tarkov : ce qu'il manque pour monter la planque, avec une
estimation du coût au prix moyen du flea market (PvP et PvE séparés).

> Projet personnel, non affilié à Battlestate Games. L'outil ne touche jamais au jeu : il lit
> seulement les données publiques de [tarkov.dev](https://tarkov.dev).

## Installation (Windows)

Télécharge `tarkov-tracker-windows-x64.exe` dans les
[Releases](../../releases/latest) et lance-le : aucune installation. Le programme n'étant pas
signé, Windows peut afficher « Windows a protégé votre ordinateur » : *Informations
complémentaires* → *Exécuter quand même*.

## Développement

```
npm install
npm run dev        # lance l'app
npm run typecheck
npm run build:win  # exe Windows (depuis Windows ou la CI)
```

## Données

Fichiers JSON statiques de `json.tarkov.dev` (items, planque, prix du flea, traductions), mis en
cache 15 minutes sur le disque. Voir `src/main/tarkov.ts`.
