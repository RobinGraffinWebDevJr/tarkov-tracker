import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import type { GameMode, HideoutData, HideoutReq, HideoutStation, ReqKind } from '../shared/types'

/**
 * Source : fichiers JSON statiques de tarkov.dev (même données que l'API GraphQL, servis par CDN,
 * donc disponibles même quand le GraphQL est en panne). Liste : https://json.tarkov.dev/endpoints
 */
const BASE = 'https://json.tarkov.dev'
export const LANG = 'fr'
/** Les prix flea sont rafraîchis côté tarkov.dev en moins d'une heure (médiane mesurée : ~25 min). */
const CACHE_TTL_MS = 15 * 60 * 1000

interface RawItem {
  id: string
  name: string
  shortName: string
  iconLink: string | null
  basePrice: number | null
  avg24hPrice: number | null
  low24hPrice: number | null
  types: string[]
  buyFromTrader?: { priceRUB: number | null }[]
}
interface RawReq {
  item: string
  count: number
  attributes?: { foundInRaid?: boolean }
}
interface RawStation {
  id: string
  name: string
  imageLink: string | null
  levels: {
    level: number
    constructionTime?: number
    itemRequirements: RawReq[]
    stationLevelRequirements?: { station: string; level: number }[]
    traderRequirements?: { trader: string; value: number }[]
    skillRequirements?: { skill: string; level: number }[]
  }[]
}
type Translations = Record<string, string>

/** Roubles, euros, dollars : exigés par la planque mais ce ne sont pas des items à chasser. */
const CURRENCY_IDS = new Set([
  '5449016a4bdc2d6f028b456f',
  '569668774bdc2da2298b4568',
  '5696686a4bdc2da3298b456a'
])

// v2 : les niveaux portent maintenant leurs prérequis (zones, marchands, compétences) et leur durée
const cachePath = (mode: GameMode): string =>
  join(app.getPath('userData'), `hideout-cache-v2-${mode}.json`)

/** Noms français des compétences citées par la planque (le jeu les écrit en anglais). */
const SKILL_FR: Record<string, string> = {
  HideoutManagement: 'Gestion de la planque',
  Crafting: 'Artisanat',
  Endurance: 'Endurance',
  Strength: 'Force',
  Health: 'Santé',
  Metabolism: 'Métabolisme',
  Attention: 'Attention',
  Perception: 'Perception',
  Intellect: 'Intellect',
  Memory: 'Mémoire',
  Charisma: 'Charisme',
  Vitality: 'Vitalité',
  Immunity: 'Immunité',
  StressResistance: 'Résistance au stress',
  Covert: 'Mouvement furtif',
  Search: 'Fouille',
  MagDrills: 'Manipulation des chargeurs',
  Sniper: 'Tireur d’élite'
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`${path} : HTTP ${res.status}`)
  return (await res.json()) as T
}

function toReq(raw: RawReq, items: Record<string, RawItem>, tr: Translations): HideoutReq | null {
  const it = items[raw.item]
  if (!it) return null
  const fir = raw.attributes?.foundInRaid === true
  const noFlea = it.types?.includes('noFlea') ?? false
  const traderPrices = (it.buyFromTrader ?? [])
    .map((b) => b.priceRUB)
    .filter((p): p is number => !!p)
  const cheapestTrader = traderPrices.length ? Math.min(...traderPrices) : null

  let kind: ReqKind = CURRENCY_IDS.has(it.id)
    ? 'currency'
    : fir
      ? 'fir'
      : noFlea
        ? 'trader'
        : 'flea'
  let unitPrice: number | null = null
  let priceSource: HideoutReq['priceSource'] = null

  if (!noFlea && it.avg24hPrice) {
    unitPrice = it.avg24hPrice
    priceSource = 'flea-avg'
  } else if (!noFlea && it.low24hPrice) {
    unitPrice = it.low24hPrice
    priceSource = 'flea-low'
  } else if (cheapestTrader != null) {
    unitPrice = cheapestTrader
    priceSource = 'trader'
    if (kind === 'flea') kind = 'trader'
  } else if (it.basePrice) {
    unitPrice = it.basePrice
    priceSource = 'base'
  }

  return {
    itemId: it.id,
    name: tr[`${it.id} Name`] ?? it.name,
    shortName: tr[`${it.id} ShortName`] ?? it.shortName,
    iconLink: it.iconLink,
    count: raw.count,
    kind,
    unitPrice,
    priceSource
  }
}

async function readCache(mode: GameMode): Promise<HideoutData | null> {
  try {
    return JSON.parse(await readFile(cachePath(mode), 'utf-8')) as HideoutData
  } catch {
    return null
  }
}

export async function getHideout(mode: GameMode, forceRefresh = false): Promise<HideoutData> {
  const cached = await readCache(mode)
  if (cached && !forceRefresh && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached, fromCache: true }
  }
  try {
    const [hideout, hideoutTr, items, itemsTr, tradersTr] = await Promise.all([
      getJson<{ data: Record<string, RawStation> }>(`${mode}/hideout`),
      getJson<{ data: Translations }>(`${mode}/hideout_${LANG}`),
      getJson<{ data: { items: Record<string, RawItem> } }>(`${mode}/items`),
      getJson<{ data: Translations }>(`${mode}/items_${LANG}`),
      getJson<{ data: Translations }>(`${mode}/traders_${LANG}`)
    ])
    const stations: HideoutStation[] = Object.values(hideout.data)
      .map((s) => ({
        id: s.id,
        name: hideoutTr.data[s.name] ?? s.name,
        imageLink: s.imageLink,
        levels: s.levels
          .map((l) => ({
            level: l.level,
            requirements: l.itemRequirements
              .map((r) => toReq(r, items.data.items, itemsTr.data))
              .filter((r): r is HideoutReq => r !== null),
            time: l.constructionTime ?? 0,
            stationReqs: (l.stationLevelRequirements ?? []).map((r) => ({
              stationId: r.station,
              level: r.level
            })),
            traderReqs: (l.traderRequirements ?? []).map((r) => ({
              trader: tradersTr.data[`${r.trader} Nickname`] ?? r.trader,
              level: r.value
            })),
            skillReqs: (l.skillRequirements ?? []).map((r) => ({
              skill: SKILL_FR[r.skill] ?? r.skill,
              level: r.level
            }))
          }))
          .sort((a, b) => a.level - b.level)
      }))
      .filter((s) => s.levels.some((l) => l.requirements.length > 0))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))

    // Date des prix = la plus récente mise à jour parmi les items utilisés (le JSON complet pèse ~17 Mo)
    const data: HideoutData = { mode, stations, fetchedAt: Date.now(), fromCache: false }
    await writeFile(cachePath(mode), JSON.stringify(data))
    return data
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (cached) return { ...cached, fromCache: true, error }
    return { mode, stations: [], fetchedAt: 0, fromCache: true, error }
  }
}
