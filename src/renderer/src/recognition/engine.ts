import {
  PITCH,
  REF,
  type Candidate,
  type CatalogItem,
  type CellMatch
} from '../../../shared/recognition'
import { LABEL_VARIANTS, prepLabel, type GrayImage } from '../../../shared/labels'
import type { CatalogEntry, ScanPage } from '../../../shared/types'
import type { WorkerOut } from './recognition.worker'

export interface Step {
  label: string
  done: number
  total: number
}

export interface PageAnalysis {
  page: ScanPage
  cells: CellMatch[]
  bitmap: ImageBitmap
  /** Étiquettes (noms) de chaque case, en PNG, pour chaque réglage de lecture : labelPngs[réglage][case] */
  labelPngs: Uint8Array[][]
  /** Noms lus par l'OCR pour chaque case, un texte par réglage (vide tant que la lecture n'a pas eu lieu) */
  reads: string[][]
}

/** Images de référence demandées au processus principal par lots (téléchargement puis cache disque). */
const GRID_BATCH = 120

async function decode(bytes: Uint8Array, type: string): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(new Blob([bytes as BlobPart], { type }))
  } catch {
    return null
  }
}

function pixels(bmp: ImageBitmap, w: number, h: number): Uint8ClampedArray {
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('Canvas indisponible')
  g.drawImage(bmp, 0, 0, w, h)
  return g.getImageData(0, 0, w, h).data
}

async function encodeGray(g: GrayImage): Promise<Uint8Array> {
  const c = new OffscreenCanvas(g.width, g.height)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponible')
  const img = ctx.createImageData(g.width, g.height)
  for (let i = 0; i < g.data.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g.data[i]
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
}

/**
 * Pilote la reconnaissance : charge le catalogue dans le worker, puis lui fait analyser les pages
 * d'un scan. Les images sont décodées ici (Chromium sait lire le WebP de tarkov.dev), le worker
 * ne reçoit que des pixels.
 */
export class RecognitionEngine {
  /**
   * Nombre de workers : les pages sont indépendantes, on les analyse en parallèle. Chacun tient le
   * catalogue en mémoire (environ 150 Mo) : la moitié des cœurs, 6 au plus, le reste est laissé à l'interface.
   */
  readonly size = Math.max(1, Math.min(6, Math.floor((navigator.hardwareConcurrency || 4) / 2)))
  private workers = Array.from(
    { length: this.size },
    () => new Worker(new URL('./recognition.worker.ts', import.meta.url), { type: 'module' })
  )
  private seq = 0
  private waiting = new Map<number, (m: WorkerOut) => void>()
  private cropCache = new Map<string, string>()

  constructor() {
    for (const worker of this.workers)
      worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        const w = this.waiting.get(e.data.id)
        this.waiting.delete(e.data.id)
        w?.(e.data)
      }
  }

  private call(
    msg: Record<string, unknown>,
    transfer: Transferable[] = [],
    worker = 0
  ): Promise<WorkerOut> {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (m) => (m.t === 'error' ? reject(new Error(m.message)) : resolve(m)))
      this.workers[worker].postMessage({ ...msg, id }, transfer)
    })
  }

  /** Charge les images de référence. Retourne le nombre d'objets chargés. */
  async load(items: CatalogEntry[], onStep: (s: Step) => void): Promise<number> {
    await Promise.all(this.workers.map((_, w) => this.call({ t: 'reset' }, [], w)))
    let loaded = 0
    for (let i = 0; i < items.length; i += GRID_BATCH) {
      onStep({ label: 'Images de référence', done: i, total: items.length })
      const batch = items.slice(i, i + GRID_BATCH)
      const grids = await window.api.getGrids(batch.map((e) => ({ id: e.id, url: e.gridUrl })))
      const byId = new Map(batch.map((e) => [e.id, e]))
      const entries: { item: CatalogItem; px: Uint8ClampedArray }[] = []
      const transfer: Transferable[] = []
      for (const g of grids) {
        const e = byId.get(g.id)
        const bmp = e ? await decode(g.bytes, 'image/webp') : null
        if (!e || !bmp) continue
        const px = pixels(bmp, e.w * REF, e.h * REF)
        bmp.close()
        entries.push({
          item: { id: e.id, name: e.name, shortName: e.shortName, w: e.w, h: e.h },
          px
        })
        transfer.push(px.buffer)
      }
      // Chaque worker reçoit sa copie des images (un buffer transféré n'est plus disponible chez l'envoyeur)
      // Toutes les copies sont faites AVANT le premier envoi, qui vide les buffers d'origine
      const lists = this.workers.map((_, w) =>
        w === 0 ? entries : entries.map((e) => ({ item: e.item, px: e.px.slice() }))
      )
      const results = await Promise.all(
        lists.map((list, w) =>
          this.call(
            { t: 'add', entries: list },
            w === 0 ? transfer : list.map((e) => e.px.buffer),
            w
          )
        )
      )
      const r = results[0]
      if (r.t === 'added') loaded = r.total
    }
    onStep({ label: 'Images de référence', done: items.length, total: items.length })
    return loaded
  }

  /** Analyse une page enregistrée par le scan. */
  async analyze(dir: string, page: ScanPage, worker = 0): Promise<PageAnalysis | null> {
    if (page.gx === undefined || page.gy === undefined) return null
    const bytes = await window.api.getScanPage(dir, page.file)
    const bitmap = bytes ? await decode(bytes, 'image/png') : null
    if (!bitmap) return null
    const px = pixels(bitmap, bitmap.width, bitmap.height)
    // Le worker prend les pixels (ils lui sont transférés) : on en garde une copie pour découper les étiquettes
    const mine = {
      width: bitmap.width,
      height: bitmap.height,
      data: new Uint8ClampedArray(px)
    }
    const r = await this.call(
      { t: 'recognize', width: bitmap.width, height: bitmap.height, px, gx: page.gx, gy: page.gy },
      [px.buffer],
      worker
    )
    const cells = r.t === 'result' ? r.cells : []
    const labelPngs: Uint8Array[][] = []
    for (const v of LABEL_VARIANTS) {
      const list: Uint8Array[] = []
      for (const c of cells)
        list.push(
          await encodeGray(
            prepLabel(mine, page.gx + c.col * PITCH, page.gy + c.row * PITCH, c.w, v)
          )
        )
      labelPngs.push(list)
    }
    return { page, bitmap, cells, labelPngs, reads: cells.map(() => []) }
  }

  /**
   * Recalcule la ressemblance de l'icône avec quelques objets précis (ceux dont le nom concorde),
   * pour des cases d'une page. Un résultat par demande, du plus ressemblant au moins ressemblant.
   */
  async rescore(
    a: PageAnalysis,
    requests: { row: number; col: number; w: number; h: number; ids: string[] }[]
  ): Promise<Candidate[][]> {
    if (!requests.length) return []
    const px = pixels(a.bitmap, a.bitmap.width, a.bitmap.height)
    const r = await this.call(
      {
        t: 'rescore',
        width: a.bitmap.width,
        height: a.bitmap.height,
        px,
        gx: a.page.gx ?? 0,
        gy: a.page.gy ?? 0,
        requests
      },
      [px.buffer]
    )
    return r.t === 'rescored' ? r.results : requests.map(() => [])
  }

  /**
   * Fait lire par l'OCR de Windows le nom écrit sur chaque case : trois lectures avec des réglages
   * différents (une seule en rate environ 18 %, les trois ensemble en ratent 9 %). Renvoie une
   * erreur à afficher si la lecture est impossible ; l'analyse continue alors sans les noms.
   */
  async readNames(pages: PageAnalysis[], onStep: (s: Step) => void): Promise<string | null> {
    let error: string | null = null
    for (let v = 0; v < LABEL_VARIANTS.length; v++) {
      onStep({ label: 'Lecture des noms', done: v, total: LABEL_VARIANTS.length })
      const all = pages.flatMap((p) => p.labelPngs[v])
      const res = await window.api.readNames(all)
      if (res.error) error = res.error
      let k = 0
      for (const p of pages)
        for (let i = 0; i < p.cells.length; i++) p.reads[i][v] = res.reads[k++] ?? ''
    }
    onStep({ label: 'Lecture des noms', done: LABEL_VARIANTS.length, total: LABEL_VARIANTS.length })
    return error
  }

  /** Vignette (data URL) d'une case ou d'un objet de la page, pour la vérification à l'écran. */
  crop(a: PageAnalysis, c: CellMatch, scale = 1): string {
    const key = `${a.page.file}:${c.row}:${c.col}:${scale}`
    const hit = this.cropCache.get(key)
    if (hit) return hit
    const sx = (a.page.gx ?? 0) + c.col * PITCH
    const sy = (a.page.gy ?? 0) + c.row * PITCH
    const w = c.w * PITCH
    const h = c.h * PITCH
    const cv = document.createElement('canvas')
    cv.width = Math.round(w * scale)
    cv.height = Math.round(h * scale)
    cv.getContext('2d')?.drawImage(a.bitmap, sx, sy, w, h, 0, 0, cv.width, cv.height)
    const url = cv.toDataURL('image/png')
    this.cropCache.set(key, url)
    return url
  }

  /** Arrête le worker (et libère le catalogue qu'il tient en mémoire) mais garde les images pour les vignettes. */
  release(): void {
    for (const w of this.workers) w.terminate()
    this.waiting.clear()
  }

  dispose(): void {
    this.release()
  }
}
