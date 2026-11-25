import type { HideoutReq, HideoutStation, Progress, ReqKind } from './types'

export interface MissingItem {
  itemId: string
  name: string
  shortName: string
  iconLink: string | null
  kind: ReqKind
  unitPrice: number | null
  needed: number
  owned: number
  missing: number
  /** Coût estimé du manquant (null si prix inconnu ou item FIR) */
  cost: number | null
  stations: string[]
}

/** Niveaux restant à construire pour une zone (strictement au-dessus du niveau actuel). */
export function remainingLevels(station: HideoutStation, progress: Progress) {
  const current = progress.stationLevels[station.id] ?? 0
  return station.levels.filter((l) => l.level > current)
}

/** Cumul des items nécessaires sur toutes les zones sélectionnées, moins l'inventaire. */
export function computeMissing(
  stations: HideoutStation[],
  progress: Progress,
  opts: { onlyNextLevel?: boolean } = {}
): MissingItem[] {
  const acc = new Map<string, MissingItem>()
  for (const station of stations) {
    let levels = remainingLevels(station, progress)
    if (opts.onlyNextLevel) levels = levels.slice(0, 1)
    for (const lvl of levels) {
      for (const req of lvl.requirements) addReq(acc, req, station.name)
    }
  }
  const items = [...acc.values()]
  for (const it of items) {
    it.owned = progress.inventory[it.itemId] ?? 0
    it.missing = Math.max(0, it.needed - it.owned)
    it.cost = it.kind !== 'fir' && it.unitPrice != null ? it.missing * it.unitPrice : null
  }
  return items.sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1))
}

function addReq(acc: Map<string, MissingItem>, req: HideoutReq, stationName: string): void {
  const existing = acc.get(req.itemId)
  if (existing) {
    existing.needed += req.count
    // Si une zone exige du FIR pour cet item, tout le besoin est traité en FIR par prudence
    if (req.kind === 'fir') existing.kind = 'fir'
    if (!existing.stations.includes(stationName)) existing.stations.push(stationName)
    return
  }
  acc.set(req.itemId, {
    itemId: req.itemId,
    name: req.name,
    shortName: req.shortName,
    iconLink: req.iconLink,
    kind: req.kind,
    unitPrice: req.unitPrice,
    needed: req.count,
    owned: 0,
    missing: 0,
    cost: null,
    stations: [stationName]
  })
}

export const formatRub = (n: number | null): string =>
  n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} ₽`
