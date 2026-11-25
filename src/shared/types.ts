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
