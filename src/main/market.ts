import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import type { GameMode, MarketData, MarketItem } from '../shared/types'
import { getJson, LANG } from './tarkov'

/** Les prix du flea sont rafraîchis côté tarkov.dev en moins d'une heure. */
const CACHE_TTL_MS = 15 * 60 * 1000

interface RawMarketItem {
  id: string
  name: string
  shortName: string
  iconLink: string | null
  width: number
  height: number
  avg24hPrice: number | null
  low24hPrice: number | null
  high24hPrice: number | null
  changeLast48hPercent: number | null
  lastOfferCount: number | null
  types: string[]
}

const cachePath = (mode: GameMode): string =>
  join(app.getPath('userData'), `market-cache-${mode}.json`)

async function readCache(mode: GameMode): Promise<MarketData | null> {
  try {
    return JSON.parse(await readFile(cachePath(mode), 'utf-8')) as MarketData
  } catch {
    return null
  }
}

export async function getMarket(mode: GameMode, forceRefresh = false): Promise<MarketData> {
  const cached = await readCache(mode)
  if (cached && !forceRefresh && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached, fromCache: true }
  }
  try {
    const [items, tr] = await Promise.all([
      getJson<{ data: { items: Record<string, RawMarketItem> | RawMarketItem[] } }>(
        `${mode}/items`
      ),
      getJson<{ data: Record<string, string> }>(`${mode}/items_${LANG}`)
    ])
    const list = Array.isArray(items.data.items)
      ? items.data.items
      : Object.values(items.data.items)
    const out: MarketItem[] = list
      // On ne garde que ce qui a un prix : les objets sans prix n'ont rien à afficher
      .filter((i) => i.avg24hPrice || i.low24hPrice)
      .map((i) => ({
        id: i.id,
        name: tr.data[`${i.id} Name`] ?? i.name,
        shortName: tr.data[`${i.id} ShortName`] ?? i.shortName,
        iconLink: i.iconLink,
        slots: Math.max(1, i.width * i.height),
        avg24h: i.avg24hPrice || null,
        low24h: i.low24hPrice || null,
        high24h: i.high24hPrice || null,
        change48hPct: i.changeLast48hPercent ?? null,
        offers: i.lastOfferCount ?? 0,
        types: i.types ?? [],
        onFlea: !(i.types ?? []).includes('noFlea')
      }))
    const data: MarketData = { mode, items: out, fetchedAt: Date.now(), fromCache: false }
    await writeFile(cachePath(mode), JSON.stringify(data))
    return data
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (cached) return { ...cached, fromCache: true, error }
    return { mode, items: [], fetchedAt: 0, fromCache: true, error }
  }
}
