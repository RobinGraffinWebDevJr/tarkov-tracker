/**
 * Reconnaissance des objets d'une grille de conteneur (fenêtre « Recherche d'objet » du stash) par
 * comparaison d'images. Fonctions pures sur des pixels : aucun accès au jeu, seulement une capture
 * d'écran déjà faite. Port du prototype Python validé sur de vraies captures.
 *
 * Principe : chaque objet a une image de case (64 px par case) publiée par tarkov.dev. On compare
 * la zone de la capture à ces images, pour chaque taille d'objet possible, par corrélation
 * normalisée en ignorant les zones que le jeu surcharge (nom en haut, étoile, coche et quantité).
 */

/** Taille d'une case dans les images de référence */
export const REF = 64
/** Taille d'une case dans le jeu en 1080p */
export const PITCH = 63
const MAX_W = 8
const MAX_H = 4
/** Écart-type en dessous duquel une case est considérée vide */
const EMPTY_STD = 9
/** Petit avantage aux grandes tailles à égalité (un objet 2×2 ressemble à quatre 1×1) */
const SIZE_BONUS = 0.002
const TOP_K = 5

/** Image brute RGBA, 4 octets par pixel (ce que donne un canvas ou un décodeur PNG). */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

export interface CatalogItem {
  id: string
  name: string
  shortName: string
  w: number
  h: number
}

export interface Candidate {
  id: string
  name: string
  shortName: string
  score: number
}

export interface CellMatch {
  row: number
  col: number
  w: number
  h: number
  /** Meilleur score (corrélation, de -1 à 1 ; au-dessus de 0,8 l'icône est quasi certaine) */
  score: number
  /** Score du deuxième candidat de la même taille : l'écart mesure l'ambiguïté */
  second: number
  candidates: Candidate[]
}

/** Zones fiables d'une image de référence : on retire le nom (haut), l'étoile et la coche/quantité (bas). */
function maskFor(w: number, h: number): Uint8Array {
  const W = w * REF
  const H = h * REF
  const m = new Uint8Array(W * H).fill(1)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (y < 18)
        m[y * W + x] = 0 // nom
      else if (y >= H - 22 && (x < 28 || x >= W - 56)) m[y * W + x] = 0 // étoile, coche, quantité
    }
  return m
}

interface SizeLib {
  w: number
  h: number
  /** Indices (dans l'image w*64 × h*64) des pixels gardés */
  keep: Int32Array
  items: CatalogItem[]
  feats: Float32Array[]
  /** Couleur moyenne (R, V, B) des pixels gardés de chaque modèle */
  means: Float32Array[]
  /** Répartition des couleurs de l'objet seul (le fond écarté) de chaque modèle */
  objects: ObjectColors[]
  /** Version allégée de feats (1 pixel sur 4) pour un premier tri rapide */
  coarse: Float32Array[]
}

/** Pas de l'échantillonnage du premier tri : 1 pixel sur COARSE_STEP. */
const COARSE_STEP = 4

/** Sous-échantillon d'un vecteur de caractéristiques (3 valeurs par pixel, 1 pixel sur COARSE_STEP). */
function coarseOf(f: Float32Array): Float32Array {
  const n = Math.ceil(f.length / 3 / COARSE_STEP)
  const c = new Float32Array(n * 3)
  for (let j = 0; j < n; j++) {
    const p = j * COARSE_STEP * 3
    c[j * 3] = f[p]
    c[j * 3 + 1] = f[p + 1]
    c[j * 3 + 2] = f[p + 2]
  }
  return c
}

/** Pixels de l'objet : écart d'au moins ceci (somme des 3 canaux) avec la couleur du fond, qui est la couleur médiane. */
const OBJECT_DELTA = 70
/** Au-dessous, il n'y a pas assez de pixels d'objet pour juger de sa couleur. */
const OBJECT_MIN_PIXELS = 40
const COLOR_BINS = 4
/** Poids de la ressemblance de couleur de l'objet dans le départage entre objets de même nom. */
const OBJECT_COLOR_WEIGHT = 0.3

interface ObjectColors {
  hist: Float32Array
  n: number
}

/**
 * Histogramme (4×4×4) des couleurs de l'objet seul : on écarte le fond, pris comme la couleur
 * médiane. Une ampoule noire, un tube blanc-bleu et un tube violet ont des histogrammes très
 * différents alors que leur corrélation sur toute la case se ressemble (fond sombre dominant).
 */
function objectColors(
  rgb: Uint8Array | Uint8ClampedArray,
  keep: Int32Array,
  stride: 3 | 4
): ObjectColors {
  const med = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const counts = new Uint32Array(256)
    for (let i = 0; i < keep.length; i++) counts[rgb[keep[i] * stride + c]]++
    let acc = 0
    let v = 0
    while (v < 255 && acc + counts[v] < keep.length / 2) acc += counts[v++]
    med[c] = v
  }
  const hist = new Float32Array(COLOR_BINS ** 3)
  let n = 0
  for (let i = 0; i < keep.length; i++) {
    const o = keep[i] * stride
    const r = rgb[o]
    const g = rgb[o + 1]
    const b = rgb[o + 2]
    if (Math.abs(r - med[0]) + Math.abs(g - med[1]) + Math.abs(b - med[2]) < OBJECT_DELTA) continue
    hist[(r >> 6) * 16 + (g >> 6) * 4 + (b >> 6)]++
    n++
  }
  if (n) for (let i = 0; i < hist.length; i++) hist[i] /= n
  return { hist, n }
}

/** Ressemblance de couleur de deux objets, de 0 à 1 (0,5 = on ne sait pas : trop peu de pixels d'objet). */
function colorMatch(a: ObjectColors, b: ObjectColors): number {
  if (a.n < OBJECT_MIN_PIXELS || b.n < OBJECT_MIN_PIXELS) return 0.5
  let s = 0
  for (let i = 0; i < a.hist.length; i++) s += Math.min(a.hist[i], b.hist[i])
  return s
}

/** Couleur moyenne des pixels gardés. Le vecteur de caractéristiques l'ignore (il est centré), donc on la compare à part. */
function meanRgb(
  rgb: Uint8Array | Uint8ClampedArray,
  keep: Int32Array,
  stride: 3 | 4
): Float32Array {
  const m = new Float32Array(3)
  for (let i = 0; i < keep.length; i++) {
    const o = keep[i] * stride
    m[0] += rgb[o]
    m[1] += rgb[o + 1]
    m[2] += rgb[o + 2]
  }
  for (let c = 0; c < 3; c++) m[c] /= keep.length
  return m
}

/** Vecteur de caractéristiques : pixels gardés, centrés par canal, normalisés. Entrée : RGB. */
function features(
  rgb: Uint8Array | Uint8ClampedArray,
  keep: Int32Array,
  stride: 3 | 4
): Float32Array {
  const n = keep.length
  const v = new Float32Array(n * 3)
  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < n; i++) {
    const o = keep[i] * stride
    r += rgb[o]
    g += rgb[o + 1]
    b += rgb[o + 2]
  }
  r /= n
  g /= n
  b /= n
  let norm = 0
  for (let i = 0; i < n; i++) {
    const o = keep[i] * stride
    const a = rgb[o] - r
    const c = rgb[o + 1] - g
    const d = rgb[o + 2] - b
    v[i * 3] = a
    v[i * 3 + 1] = c
    v[i * 3 + 2] = d
    norm += a * a + c * c + d * d
  }
  norm = Math.sqrt(norm)
  if (norm > 1e-6) for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

/** Bibliothèque d'images de référence, rangées par taille d'objet. */
export class Library {
  private sizes = new Map<string, SizeLib>()
  /**
   * Points retirés au score par unité d'écart de couleur moyenne (0 à 1) avec le modèle. Les
   * caractéristiques sont centrées par canal : sans ce terme, un chiffon gris et un chiffon jaune de
   * même forme se ressemblent. Mesuré sur 557 cases : cases acceptées d'office 63 % → 67 %.
   */
  colorWeight = 1
  /**
   * Recherche en deux temps : un tri grossier (1 pixel sur 4) garde les `coarseKeep` meilleurs
   * candidats, la comparaison exacte ne porte que sur eux. 0 = comparaison exacte de tout le catalogue.
   */
  coarseKeep = 48

  /** Ajoute un objet. `pixels` : image de référence de (w*64) × (h*64) pixels, RGB (3) ou RGBA (4 octets). */
  add(item: CatalogItem, pixels: Uint8Array | Uint8ClampedArray, stride: 3 | 4 = 3): void {
    if (item.w > MAX_W || item.h > MAX_H) return
    const key = `${item.w}x${item.h}`
    let lib = this.sizes.get(key)
    if (!lib) {
      const m = maskFor(item.w, item.h)
      const keep: number[] = []
      for (let i = 0; i < m.length; i++) if (m[i]) keep.push(i)
      lib = {
        w: item.w,
        h: item.h,
        keep: Int32Array.from(keep),
        items: [],
        feats: [],
        means: [],
        objects: [],
        coarse: []
      }
      this.sizes.set(key, lib)
    }
    if (pixels.length !== item.w * REF * item.h * REF * stride) return
    lib.items.push(item)
    const f = features(pixels, lib.keep, stride)
    lib.feats.push(f)
    lib.coarse.push(coarseOf(f))
    lib.means.push(meanRgb(pixels, lib.keep, stride))
    lib.objects.push(objectColors(pixels, lib.keep, stride))
  }

  get size(): number {
    let n = 0
    for (const l of this.sizes.values()) n += l.items.length
    return n
  }

  /** @internal */
  libs(): SizeLib[] {
    return [...this.sizes.values()]
  }
}

/** Zone w×h de l'image, redimensionnée en (w*64)×(h*64) par interpolation bilinéaire. Renvoie du RGB. */
function cropResize(
  img: RgbaImage,
  x0: number,
  y0: number,
  cw: number,
  ch: number,
  tw: number,
  th: number
): Uint8Array {
  const out = new Uint8Array(tw * th * 3)
  const sx = cw / tw
  const sy = ch / th
  const d = img.data
  const W = img.width
  const H = img.height
  for (let y = 0; y < th; y++) {
    const fy = y0 + (y + 0.5) * sy - 0.5
    const iy = Math.floor(fy)
    const ty = fy - iy
    const ya = Math.min(H - 1, Math.max(0, iy))
    const yb = Math.min(H - 1, Math.max(0, iy + 1))
    for (let x = 0; x < tw; x++) {
      const fx = x0 + (x + 0.5) * sx - 0.5
      const ix = Math.floor(fx)
      const tx = fx - ix
      const xa = Math.min(W - 1, Math.max(0, ix))
      const xb = Math.min(W - 1, Math.max(0, ix + 1))
      const o = (y * tw + x) * 3
      for (let c = 0; c < 3; c++) {
        const p00 = d[(ya * W + xa) * 4 + c]
        const p10 = d[(ya * W + xb) * 4 + c]
        const p01 = d[(yb * W + xa) * 4 + c]
        const p11 = d[(yb * W + xb) * 4 + c]
        out[o + c] =
          p00 * (1 - tx) * (1 - ty) + p10 * tx * (1 - ty) + p01 * (1 - tx) * ty + p11 * tx * ty
      }
    }
  }
  return out
}

/** Une case sans objet n'a presque pas de relief dans sa partie centrale. */
function isEmptyCell(img: RgbaImage, x0: number, y0: number): boolean {
  let n = 0
  let sum = 0
  let sum2 = 0
  for (let y = y0 + 18; y < y0 + 50; y++)
    for (let x = x0 + 8; x < x0 + 50; x++) {
      const o = (y * img.width + x) * 4
      for (let c = 0; c < 3; c++) {
        const v = img.data[o + c]
        sum += v
        sum2 += v * v
        n++
      }
    }
  const mean = sum / n
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean)) < EMPTY_STD
}

/**
 * Reconnaît les objets d'une grille. `gx, gy` : coin haut-gauche de la première case dans la capture.
 * Parcourt les cases ligne par ligne ; pour chaque case occupée, essaie toutes les tailles d'objet
 * qui tiennent encore et garde la meilleure. Une case déjà couverte par un objet plus grand est sautée.
 */
/** Score d'un modèle : corrélation de l'image, moins une pénalité pour l'écart de couleur moyenne. */
function itemScore(
  L: SizeLib,
  k: number,
  q: Float32Array,
  qm: Float32Array,
  colorWeight: number
): number {
  const f = L.feats[k]
  let s = 0
  for (let i = 0; i < f.length; i++) s += f[i] * q[i]
  if (colorWeight > 0) {
    const m = L.means[k]
    s -=
      (colorWeight * (Math.abs(m[0] - qm[0]) + Math.abs(m[1] - qm[1]) + Math.abs(m[2] - qm[2]))) /
      (3 * 255)
  }
  return s
}

/**
 * Score de ressemblance d'une case avec une liste d'objets précise (de la même taille), sans passer
 * par tout le catalogue. Sert quand le nom lu a déjà réduit le choix à quelques objets : l'icône
 * n'a plus qu'à les départager. Triés du plus ressemblant au moins ressemblant.
 */
export function rescoreCell(
  img: RgbaImage,
  x0: number,
  y0: number,
  w: number,
  h: number,
  ids: ReadonlySet<string>,
  lib: Library
): Candidate[] {
  const L = lib.libs().find((l) => l.w === w && l.h === h)
  if (!L || x0 + w * PITCH > img.width || y0 + h * PITCH > img.height) return []
  const px = cropResize(img, x0, y0, w * PITCH, h * PITCH, w * REF, h * REF)
  const q = features(px, L.keep, 3)
  const qm = meanRgb(px, L.keep, 3)
  const qo = objectColors(px, L.keep, 3)
  const out: Candidate[] = []
  for (let k = 0; k < L.items.length; k++) {
    const it = L.items[k]
    if (ids.has(it.id))
      out.push({
        id: it.id,
        name: it.name,
        shortName: it.shortName,
        // corrélation de la case + ressemblance de couleur de l'objet seul
        score:
          itemScore(L, k, q, qm, lib.colorWeight) +
          OBJECT_COLOR_WEIGHT * (colorMatch(qo, L.objects[k]) - 0.5)
      })
  }
  return out.sort((a, b) => b.score - a.score)
}

export function recognizeGrid(
  img: RgbaImage,
  gx: number,
  gy: number,
  cols: number,
  rows: number,
  lib: Library
): CellMatch[] {
  const libs = lib.libs()
  const taken = new Uint8Array(cols * rows)
  const out: CellMatch[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (taken[r * cols + c]) continue
      const x0 = gx + c * PITCH
      const y0 = gy + r * PITCH
      if (x0 + PITCH > img.width || y0 + PITCH > img.height) continue
      if (isEmptyCell(img, x0, y0)) continue

      let best: { total: number; w: number; h: number; scores: Float32Array; lib: SizeLib } | null =
        null
      for (const L of libs) {
        if (r + L.h > rows || c + L.w > cols || L.items.length === 0) continue
        let free = true
        for (let dy = 0; dy < L.h && free; dy++)
          for (let dx = 0; dx < L.w; dx++) if (taken[(r + dy) * cols + c + dx]) free = false
        if (!free) continue
        if (x0 + L.w * PITCH > img.width || y0 + L.h * PITCH > img.height) continue
        const px = cropResize(img, x0, y0, L.w * PITCH, L.h * PITCH, L.w * REF, L.h * REF)
        const q = features(px, L.keep, 3)
        const qm = meanRgb(px, L.keep, 3)
        const scores = new Float32Array(L.items.length).fill(-2)
        let top = -2
        if (lib.coarseKeep > 0 && L.items.length > lib.coarseKeep * 2) {
          // 1er temps : tri grossier sur un pixel sur quatre, couleur moyenne comprise
          const qc = coarseOf(q)
          const rough = new Float32Array(L.items.length)
          for (let k = 0; k < L.items.length; k++) {
            const f = L.coarse[k]
            let s = 0
            for (let i = 0; i < f.length; i++) s += f[i] * qc[i]
            const m = L.means[k]
            rough[k] =
              s -
              (lib.colorWeight *
                (Math.abs(m[0] - qm[0]) + Math.abs(m[1] - qm[1]) + Math.abs(m[2] - qm[2]))) /
                (3 * 255)
          }
          const keepIdx = Array.from(rough.keys())
            .sort((a, b) => rough[b] - rough[a])
            .slice(0, lib.coarseKeep)
          // 2e temps : comparaison exacte des seuls candidats retenus
          for (const k of keepIdx) {
            const s = itemScore(L, k, q, qm, lib.colorWeight)
            scores[k] = s
            if (s > top) top = s
          }
        } else {
          for (let k = 0; k < L.items.length; k++) {
            const s = itemScore(L, k, q, qm, lib.colorWeight)
            scores[k] = s
            if (s > top) top = s
          }
        }
        const total = top + SIZE_BONUS * L.w * L.h
        if (!best || total > best.total) best = { total, w: L.w, h: L.h, scores, lib: L }
      }
      if (!best) continue
      for (let dy = 0; dy < best.h; dy++)
        for (let dx = 0; dx < best.w; dx++) taken[(r + dy) * cols + c + dx] = 1
      const order = Array.from(best.scores.keys())
        .sort((a, b) => best!.scores[b] - best!.scores[a])
        .slice(0, TOP_K)
      const cands: Candidate[] = order.map((k) => ({
        id: best!.lib.items[k].id,
        name: best!.lib.items[k].name,
        shortName: best!.lib.items[k].shortName,
        score: best!.scores[k]
      }))
      out.push({
        row: r,
        col: c,
        w: best.w,
        h: best.h,
        score: cands[0].score,
        second: cands[1]?.score ?? 0,
        candidates: cands
      })
    }
  return out
}
