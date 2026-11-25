export type GameMode = 'regular' | 'pve'

export type ReqKind = 'flea' | 'trader' | 'fir' | 'currency'

export interface HideoutReq {
  itemId: string
  name: string
  shortName: string
  iconLink: string | null
  count: number
  /** fir = à trouver en raid, flea = achetable sur le marché, trader = achetable chez un marchand uniquement, currency = roubles/dollars/euros */
  kind: ReqKind
  /** Prix moyen unitaire en roubles (null si inconnu) */
  unitPrice: number | null
  priceSource: 'flea-avg' | 'flea-low' | 'trader' | 'base' | null
}

export interface HideoutLevel {
  level: number
  requirements: HideoutReq[]
}

export interface HideoutStation {
  id: string
  name: string
  imageLink: string | null
  levels: HideoutLevel[]
}

export interface HideoutData {
  mode: GameMode
  stations: HideoutStation[]
  fetchedAt: number
  /** true si les données viennent du cache disque (API injoignable ou cache encore frais) */
  fromCache: boolean
  error?: string
}

/** done = terminée, active = commencée, failed = échouée. Une quête absente n'est pas commencée. */
export type QuestStatus = 'done' | 'active' | 'failed'

/** D'où vient l'état des quêtes enregistré (pour l'afficher et savoir quand il a été importé). */
export interface QuestsImportInfo {
  at: number
  source: 'logs'
  /** Messages de quête lus dans les logs pour le wipe en cours */
  events: number
  /** Début et fin de la période couverte (ms) */
  since: number | null
  until: number | null
}

export interface Progress {
  /** Niveau actuel de chaque zone (0 = non construite) */
  stationLevels: Record<string, number>
  /** Quantité possédée par item */
  inventory: Record<string, number>
  /** État des quêtes par identifiant de quête */
  quests: Record<string, QuestStatus>
  /** Quêtes comptées terminées parce qu'une quête suivante est commencée (aucun message de fin dans les logs) */
  questsInferred: string[]
  questsImport: QuestsImportInfo | null
}

export const emptyProgress = (): Progress => ({
  stationLevels: {},
  inventory: {},
  quests: {},
  questsInferred: [],
  questsImport: null
})

export interface UpdateState {
  kind: 'disabled' | 'up-to-date' | 'available' | 'downloading' | 'failed'
  version: string
  /** Dernière version publiée (available, downloading) */
  latest?: string
  /** Raison de l'état : pourquoi désactivée, erreur de vérification ou d'installation */
  message?: string
  /** Heure de la dernière vérification terminée (ms) */
  checkedAt?: number
}

export interface ScanPage {
  /** Numéro de page lu dans la pagination du jeu, null s'il n'a pas pu être lu */
  page: number | null
  file: string
}

/** État de la lecture de la fenêtre « Recherche d'objet » (stash). */
export interface SearchScan {
  /** La fenêtre est visible dans la dernière capture */
  active: boolean
  /** Pages enregistrées : une image par page, quelle que soit la vitesse à laquelle tu les tournes */
  pages: ScanPage[]
  /** Page affichée en ce moment, null si inconnue */
  current: number | null
  /** Pages que la pagination a montrées mais qui n'ont pas encore été enregistrées */
  missing: number[]
}

export interface ScanStatus {
  running: boolean
  /** Fenêtre du jeu trouvée dans la dernière capture */
  found: boolean
  width: number
  height: number
  /** Captures faites / images enregistrées sur disque pendant cette session */
  frames: number
  saved: number
  /** Image noire : le jeu est en plein écran exclusif, la capture ne voit rien */
  black: boolean
  dir: string
  message: string
  /** Aperçu (data URL) de la dernière capture */
  preview: string | null
  search: SearchScan
  /** Dernières lignes du journal de la session (le journal complet est dans scan.log, dans le dossier de la session) */
  log: string[]
}

/** Un objet du flea market, avec les prix utiles à l'affichage. Prix en roubles. */
export interface MarketItem {
  id: string
  name: string
  shortName: string
  iconLink: string | null
  /** Taille en cases : sert au prix par case */
  slots: number
  avg24h: number | null
  low24h: number | null
  high24h: number | null
  /** Variation du prix sur 48 h, en % (null si inconnue) */
  change48hPct: number | null
  /** Nombre d'offres en vente : une liquidité faible veut dire qu'il se vend mal */
  offers: number
  /** Types de tarkov.dev (barter, keys, meds, provisions…) */
  types: string[]
  /** Vendable sur le flea (faux pour les objets réservés aux marchands ou aux quêtes) */
  onFlea: boolean
}

export interface MarketData {
  mode: GameMode
  items: MarketItem[]
  fetchedAt: number
  fromCache: boolean
  error?: string
}

/** Un objet demandé par un objectif de quête. */
export interface QuestObjectiveItem {
  id: string
  name: string
  iconLink: string | null
  /** Objet de quête (n'existe pas sur le flea) */
  questItem: boolean
}

export interface QuestObjective {
  id: string
  /** visit, shoot, giveItem, findItem, plantItem, extract, mark… */
  type: string
  /** Texte de l'objectif, en français */
  text: string
  count: number | null
  optional: boolean
  /** Objet à ramener en raid (trouvé en raid) */
  foundInRaid: boolean
  /** Objets acceptés (vide si trop nombreux : voir itemChoices) */
  items: QuestObjectiveItem[]
  /** Nombre d'objets différents acceptés, quand la liste est trop longue pour être affichée */
  itemChoices: number
  /** Cartes concernées (noms français) */
  maps: string[]
  /** L'objectif a une position connue sur la carte */
  located: boolean
}

/** Une quête du jeu, avec ce qu'il faut pour l'afficher et déduire ses prérequis. */
export interface QuestTask {
  id: string
  name: string
  traderId: string
  trader: string
  minLevel: number
  /** Quêtes à terminer avant celle-ci */
  requires: string[]
  objectives: QuestObjective[]
  /** Cartes de la quête (toutes celles de ses objectifs) */
  maps: string[]
  experience: number
  /** Peut être recommencée après l'avoir terminée */
  restartable: boolean
  /** Any, USEC ou BEAR */
  faction: string
  wikiLink: string | null
}

export interface TasksData {
  mode: GameMode
  tasks: QuestTask[]
  fetchedAt: number
  fromCache: boolean
  error?: string
}

export type QuestEventKind = 'start' | 'fail' | 'done'

/** Un message de quête du jeu : début, échec ou fin. */
export interface QuestEvent {
  id: string
  kind: QuestEventKind
  /** Heure du message (ms) */
  at: number
}

/** Résultat de la lecture des logs, à valider par l'utilisateur avant d'être appliqué. */
export interface QuestLogImport {
  ok: boolean
  /** L'utilisateur a fermé la fenêtre de choix du dossier */
  canceled?: boolean
  error?: string
  dir: string
  /** Fichiers de notifications lus */
  files: number
  /** Messages de quête distincts lus, tous wipes confondus */
  totalEvents: number
  /** Messages de quête écartés parce qu'ils viennent de l'autre mode ou d'une session au mode inconnu */
  otherMode: number
  /** Modes (autres que celui demandé) dans lesquels les logs contiennent des quêtes */
  otherModes: GameMode[]
  /** Wipes repérés avant le dernier (une quête terminée puis recommencée = nouveau wipe) */
  wipes: number
  /** Messages du wipe en cours, début et fin de la période */
  events: number
  since: number | null
  until: number | null
  quests: Record<string, QuestStatus>
  inferred: string[]
  /** Quêtes des logs que les données de tarkov.dev ne connaissent pas */
  unknown: number
}
