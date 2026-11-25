import type { HideoutStation, Progress, ReqKind } from './types'

export interface UpgradeItem {
  itemId: string
  name: string
  shortName: string
  iconLink: string | null
  kind: ReqKind
  unitPrice: number | null
  needed: number
  /** Part de l'inventaire réservée à cette amélioration (un même objet n'est compté qu'une fois) */
  covered: number
  missing: number
  /** Coût du manquant (null si à trouver en raid ou prix inconnu) */
  cost: number | null
}

/**
 * ready : tout est là, la zone peut être construite.
 * buyable : il manque seulement des objets achetables (flea, marchand, argent).
 * raid : il manque au moins un objet à trouver en raid.
 * blocked : une autre zone doit d'abord monter de niveau.
 */
export type UpgradeState = 'ready' | 'buyable' | 'raid' | 'blocked'

export interface Upgrade {
  stationId: string
  stationName: string
  imageLink: string | null
  level: number
  items: UpgradeItem[]
  state: UpgradeState
  /** Coût des objets manquants achetables */
  buyCost: number
  /** Nombre d'objets à trouver en raid qu'il manque */
  firMissing: number
  /** Part des objets déjà réunie, de 0 à 1 */
  progress: number
  /** Zones à monter d'abord, par ex. « Générateur niveau 2 » */
  blockedBy: string[]
  /** Améliorations que celle-ci débloque directement */
  unlocks: string[]
  /** Durée de construction en secondes */
  time: number
  /** Niveaux de marchand et compétences exigés : le tracker ne les connaît pas, on les affiche à vérifier */
  otherReqs: string[]
}

const STATE_ORDER: Record<UpgradeState, number> = { ready: 0, buyable: 1, raid: 2, blocked: 3 }

interface Candidate {
  station: HideoutStation
  level: HideoutStation['levels'][number]
  blockedBy: string[]
  unlocks: string[]
}

/** Quantités demandées par un niveau, fusionnées par objet (le même objet peut y figurer deux fois). */
function mergedNeeds(level: Candidate['level']): Map<string, UpgradeItem> {
  const acc = new Map<string, UpgradeItem>()
  for (const r of level.requirements) {
    const e = acc.get(r.itemId)
    if (e) {
      e.needed += r.count
      // Si une ligne exige du FIR pour cet objet, tout le besoin est traité en FIR, par prudence
      if (r.kind === 'fir') e.kind = 'fir'
    } else {
      acc.set(r.itemId, {
        itemId: r.itemId,
        name: r.name,
        shortName: r.shortName,
        iconLink: r.iconLink,
        kind: r.kind,
        unitPrice: r.unitPrice,
        needed: r.count,
        covered: 0,
        missing: r.count,
        cost: null
      })
    }
  }
  return acc
}

function settle(
  items: UpgradeItem[],
  blocked: boolean
): Pick<Upgrade, 'state' | 'buyCost' | 'firMissing' | 'progress'> {
  let buyCost = 0
  let firMissing = 0
  let needed = 0
  let covered = 0
  for (const it of items) {
    it.missing = it.needed - it.covered
    it.cost = it.kind !== 'fir' && it.unitPrice != null ? it.missing * it.unitPrice : null
    needed += it.needed
    covered += it.covered
    if (it.kind === 'fir') firMissing += it.missing
    else buyCost += it.cost ?? 0
  }
  const state: UpgradeState = blocked
    ? 'blocked'
    : firMissing > 0
      ? 'raid'
      : items.some((i) => i.missing > 0)
        ? 'buyable'
        : 'ready'
  return { state, buyCost, firMissing, progress: needed ? covered / needed : 1 }
}

/**
 * Prochaine amélioration de chaque zone, classée par ordre de priorité :
 * d'abord ce qui peut être construit tout de suite, puis ce qui s'achète, puis ce qui demande du
 * raid, et en dernier ce qui est bloqué par une autre zone. À état égal, celle qui en débloque le
 * plus passe devant, puis la moins chère. L'inventaire est réparti dans cet ordre : un même objet
 * n'est jamais compté pour deux zones.
 */
export function computeUpgrades(stations: HideoutStation[], progress: Progress): Upgrade[] {
  const levelOf = (id: string): number => progress.stationLevels[id] ?? 0
  const nameOf = new Map(stations.map((s) => [s.id, s.name]))

  const cands: Candidate[] = []
  for (const station of stations) {
    const level = station.levels.find((l) => l.level === levelOf(station.id) + 1)
    if (!level) continue
    const blockedBy = (level.stationReqs ?? [])
      .filter((r) => levelOf(r.stationId) < r.level)
      .map((r) => `${nameOf.get(r.stationId) ?? r.stationId} niveau ${r.level}`)
    cands.push({ station, level, blockedBy, unlocks: [] })
  }
  // Ce qu'une amélioration débloque : les autres qui attendent exactement ce niveau
  for (const c of cands)
    for (const other of cands)
      if (
        other !== c &&
        (other.level.stationReqs ?? []).some(
          (r) => r.stationId === c.station.id && r.level === c.level.level
        )
      )
        c.unlocks.push(`${other.station.name} niveau ${other.level.level}`)

  // Première passe sur tout l'inventaire pour classer, puis répartition réelle dans cet ordre
  const rough = cands.map((c) => {
    const items = [...mergedNeeds(c.level).values()]
    for (const it of items) it.covered = Math.min(it.needed, progress.inventory[it.itemId] ?? 0)
    return { c, ...settle(items, c.blockedBy.length > 0) }
  })
  rough.sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      b.c.unlocks.length - a.c.unlocks.length ||
      a.buyCost - b.buyCost ||
      a.c.station.name.localeCompare(b.c.station.name, 'fr')
  )

  const pool = new Map<string, number>(Object.entries(progress.inventory))
  return rough.map(({ c }) => {
    const items = [...mergedNeeds(c.level).values()]
    for (const it of items) {
      it.covered = Math.min(it.needed, pool.get(it.itemId) ?? 0)
      pool.set(it.itemId, (pool.get(it.itemId) ?? 0) - it.covered)
    }
    const s = settle(items, c.blockedBy.length > 0)
    items.sort((a, b) => b.missing - a.missing || (b.cost ?? -1) - (a.cost ?? -1))
    return {
      stationId: c.station.id,
      stationName: c.station.name,
      imageLink: c.station.imageLink,
      level: c.level.level,
      items,
      ...s,
      blockedBy: c.blockedBy,
      unlocks: c.unlocks,
      time: c.level.time ?? 0,
      otherReqs: [
        ...(c.level.traderReqs ?? []).map((r) => `${r.trader} niveau ${r.level}`),
        ...(c.level.skillReqs ?? []).map((r) => `${r.skill} niveau ${r.level}`)
      ]
    }
  })
}

/** Durée lisible : « 2 j 4 h », « 45 min ». */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return h > 0 ? `${d} j ${h} h` : `${d} j`
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`
  return `${m} min`
}
