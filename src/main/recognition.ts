import { app, ipcMain } from 'electron'
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { join, resolve, sep } from 'path'
import type { CatalogData, CatalogEntry, GameMode, ScanPage } from '../shared/types'
import { getJson, LANG } from './tarkov'

/**
 * Données de la reconnaissance : catalogue des objets, images de référence (en cache sur disque)
 * et pages du dernier scan. Le décodage des images et la comparaison se font côté interface :
 * Electron sait décoder le WebP des images de tarkov.dev seulement dans la partie web.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const GRID_HOST = 'https://assets.tarkov.dev/'
const DOWNLOAD_PARALLEL = 8
/** Au-delà, un objet n'entre pas dans la grille de recherche du jeu */
const MAX_W = 8
const MAX_H = 4

interface RawItem {
  id: string
  name: string
  shortName: string
  width: number
  height: number
  gridImageLink: string | null
  stackMaxSize?: number | null
  types?: string[]
}

const scansRoot = (): string => join(app.getPath('documents'), 'Tarkov Tracker', 'scans')
const catalogPath = (mode: GameMode): string =>
  join(app.getPath('userData'), `catalog-v2-${mode}.json`)
const gridDir = (): string => join(app.getPath('userData'), 'grid-cache')

async function readCatalogCache(mode: GameMode): Promise<CatalogData | null> {
  try {
    return JSON.parse(await readFile(catalogPath(mode), 'utf-8')) as CatalogData
  } catch {
    return null
  }
}

async function getCatalog(mode: GameMode, force: boolean): Promise<CatalogData> {
  const cached = await readCatalogCache(mode)
  if (cached && !force && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached
  try {
    const [items, tr] = await Promise.all([
      getJson<{ data: { items: Record<string, RawItem> | RawItem[] } }>(`${mode}/items`),
      getJson<{ data: Record<string, string> }>(`${mode}/items_${LANG}`)
    ])
    const list = Array.isArray(items.data.items)
      ? items.data.items
      : Object.values(items.data.items)
    const entries: CatalogEntry[] = list
      .filter((i) => i.gridImageLink && i.width <= MAX_W && i.height <= MAX_H)
      .map((i) => ({
        id: i.id,
        name: tr.data[`${i.id} Name`] ?? i.name,
        shortName: tr.data[`${i.id} ShortName`] ?? i.shortName,
        w: i.width,
        h: i.height,
        stack: i.stackMaxSize ?? 1,
        types: i.types ?? [],
        gridUrl: i.gridImageLink as string
      }))
    const data: CatalogData = { mode, items: entries, fetchedAt: Date.now() }
    await writeFile(catalogPath(mode), JSON.stringify(data))
    return data
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return cached ? { ...cached, error } : { mode, items: [], fetchedAt: 0, error }
  }
}

async function gridBytes(id: string, url: string): Promise<Uint8Array | null> {
  if (!url.startsWith(GRID_HOST) || !/^[0-9a-f]{24}$/.test(id)) return null
  const file = join(gridDir(), `${id}.webp`)
  try {
    return new Uint8Array(await readFile(file))
  } catch {
    /* pas encore en cache : on le télécharge */
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    await writeFile(file, buf)
    return buf
  } catch {
    return null
  }
}

async function getGrids(
  wanted: { id: string; url: string }[]
): Promise<{ id: string; bytes: Uint8Array }[]> {
  await mkdir(gridDir(), { recursive: true })
  const out: { id: string; bytes: Uint8Array }[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < wanted.length) {
      const w = wanted[next++]
      const bytes = await gridBytes(w.id, w.url)
      if (bytes) out.push({ id: w.id, bytes })
    }
  }
  await Promise.all(Array.from({ length: DOWNLOAD_PARALLEL }, worker))
  return out
}

/** Dernière session de scan qui contient des pages lisibles (avec la position de la grille). */
async function latestSession(): Promise<{ dir: string; pages: ScanPage[] } | null> {
  let names: string[]
  try {
    names = (await readdir(scansRoot())).sort().reverse()
  } catch {
    return null
  }
  for (const n of names) {
    const dir = join(scansRoot(), n)
    try {
      const idx = JSON.parse(await readFile(join(dir, 'pages.json'), 'utf-8')) as {
        pages: ScanPage[]
      }
      const pages = idx.pages.filter((p) => typeof p.gx === 'number' && typeof p.gy === 'number')
      if (pages.length) return { dir, pages }
    } catch {
      /* session sans pages.json : on regarde la précédente */
    }
  }
  return null
}

async function pageBytes(dir: string, file: string): Promise<Uint8Array | null> {
  const full = resolve(dir, file)
  // Le dossier doit être dans celui des scans, et le fichier une page : l'interface ne choisit pas un chemin libre
  if (!full.startsWith(resolve(scansRoot()) + sep) || !/^page-x?\d+\.png$/.test(file)) return null
  try {
    if (!(await stat(full)).isFile()) return null
    return new Uint8Array(await readFile(full))
  } catch {
    return null
  }
}

/** Mise au point : l'analyse écrite à côté des pages du scan, pour pouvoir l'examiner et la contrôler. */
async function saveAnalysis(dir: string, json: string): Promise<boolean> {
  const full = resolve(dir)
  if (!full.startsWith(resolve(scansRoot()) + sep) || json.length > 30_000_000) return false
  try {
    await writeFile(join(full, 'analysis.json'), json, 'utf-8')
    return true
  } catch {
    return false
  }
}

export function initRecognition(): void {
  ipcMain.handle('recog:catalog', (_e, mode: GameMode, force?: boolean) =>
    getCatalog(mode, !!force)
  )
  ipcMain.handle('recog:grids', (_e, wanted: { id: string; url: string }[]) => getGrids(wanted))
  ipcMain.handle('recog:session', () => latestSession())
  ipcMain.handle('recog:page', (_e, dir: string, file: string) => pageBytes(dir, file))
  ipcMain.handle('recog:save-analysis', (_e, dir: string, json: string) => saveAnalysis(dir, json))
}
