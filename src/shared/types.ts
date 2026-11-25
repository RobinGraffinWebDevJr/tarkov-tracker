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

export interface Progress {
  /** Niveau actuel de chaque zone (0 = non construite) */
  stationLevels: Record<string, number>
  /** Quantité possédée par item */
  inventory: Record<string, number>
}

export const emptyProgress = (): Progress => ({ stationLevels: {}, inventory: {} })

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
}
