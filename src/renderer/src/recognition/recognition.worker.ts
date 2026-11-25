import {
  Library,
  PITCH,
  recognizeGrid,
  rescoreCell,
  type CatalogItem,
  type Candidate,
  type CellMatch
} from '../../../shared/recognition'

/**
 * Worker de reconnaissance : la comparaison d'images prend plusieurs secondes par page, on la
 * garde hors du fil de l'interface pour que la fenêtre reste utilisable.
 */

type In =
  | { id: number; t: 'add'; entries: { item: CatalogItem; px: Uint8ClampedArray }[] }
  | {
      id: number
      t: 'recognize'
      width: number
      height: number
      px: Uint8ClampedArray
      gx: number
      gy: number
    }
  | {
      id: number
      t: 'rescore'
      width: number
      height: number
      px: Uint8ClampedArray
      gx: number
      gy: number
      requests: { row: number; col: number; w: number; h: number; ids: string[] }[]
    }
  | { id: number; t: 'reset' }

export type WorkerOut =
  | { id: number; t: 'added'; total: number }
  | { id: number; t: 'result'; cells: CellMatch[] }
  | { id: number; t: 'rescored'; results: Candidate[][] }
  | { id: number; t: 'error'; message: string }

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<In>) => void) | null
  postMessage: (m: WorkerOut) => void
}

let lib = new Library()

ctx.onmessage = (e) => {
  const m = e.data
  try {
    if (m.t === 'reset') {
      lib = new Library()
      ctx.postMessage({ id: m.id, t: 'added', total: 0 })
    } else if (m.t === 'add') {
      for (const { item, px } of m.entries) lib.add(item, px, 4)
      ctx.postMessage({ id: m.id, t: 'added', total: lib.size })
    } else if (m.t === 'rescore') {
      const img = { width: m.width, height: m.height, data: m.px }
      const results = m.requests.map((q) =>
        rescoreCell(img, m.gx + q.col * PITCH, m.gy + q.row * PITCH, q.w, q.h, new Set(q.ids), lib)
      )
      ctx.postMessage({ id: m.id, t: 'rescored', results })
    } else {
      const cells = recognizeGrid(
        { width: m.width, height: m.height, data: m.px },
        m.gx,
        m.gy,
        12,
        12,
        lib
      )
      ctx.postMessage({ id: m.id, t: 'result', cells })
    }
  } catch (err) {
    ctx.postMessage({
      id: m.id,
      t: 'error',
      message: err instanceof Error ? err.message : String(err)
    })
  }
}
