import { GLYPH_H, GLYPH_W, PAGER_GLYPHS } from './pagerGlyphs'

/**
 * Lecture de la fenêtre « Recherche d'objet » du jeu (stash, filtre « cube »), pour une capture
 * 1920×1080. Fonctions pures sur une image brute : aucun accès au jeu, uniquement les pixels de
 * la capture d'écran. Toutes les constantes ont été mesurées sur de vraies captures.
 */

/** Image brute BGRA, comme renvoie nativeImage.toBitmap() sous Windows. */
export interface Bitmap {
  width: number
  height: number
  data: Uint8Array
}

export interface SearchWindow {
  /** Coin haut-gauche de la grille (première case) */
  gx: number
  gy: number
  /** Coin haut-gauche du bouton de fermeture : sert de repère et de pointeur pour la détection suivante */
  closeX: number
  closeY: number
}

export const SEARCH_COLS = 12
export const SEARCH_ROWS = 12
export const CELL = 63
export const SUPPORTED_WIDTH = 1920
export const SUPPORTED_HEIGHT = 1080

const BTN_W = 27
const BTN_H = 17
/** La barre de titre de cette fenêtre est d'un gris uniforme, différent de celle des conteneurs (34,35,36). */
const BAR: readonly [number, number, number] = [25, 27, 27]
/** Position de la grille par rapport au coin haut-gauche du bouton de fermeture. */
const GRID_DX = BTN_W - 1 - SEARCH_COLS * CELL
const GRID_DY = 59

const isRedButton = (r: number, g: number, b: number): boolean =>
  r >= 40 && r <= 140 && g <= 50 && b <= 50 && r - g >= 30

/**
 * Teste si un bouton de fermeture « Recherche d'objet » est à (x,y).
 * Renvoie le nombre de pixels rouges du bouton, ou -1 si ce n'est pas le bon.
 */
function checkButton(bmp: Bitmap, x: number, y: number): number {
  const { width: W, height: H, data } = bmp
  if (x < 6 || y < 6 || x + BTN_W + 6 > W || y + BTN_H + 6 > H) return -1
  let inner = 0
  for (let j = 0; j < BTN_H; j++) {
    let o = ((y + j) * W + x) * 4
    for (let i = 0; i < BTN_W; i++, o += 4)
      if (isRedButton(data[o + 2], data[o + 1], data[o])) inner++
  }
  if (inner < 0.62 * BTN_W * BTN_H) return -1
  // Isolement : pas de rouge sur 5 px autour (écarte les grandes surfaces rouges, comme les Salewa)
  let ring = 0
  const area = (BTN_W + 10) * (BTN_H + 10) - BTN_W * BTN_H
  for (let j = -5; j < BTN_H + 5; j++) {
    const inside = j >= 0 && j < BTN_H
    for (let i = -5; i < BTN_W + 5; i++) {
      if (inside && i >= 0 && i < BTN_W) continue
      const o = ((y + j) * W + x + i) * 4
      if (isRedButton(data[o + 2], data[o + 1], data[o])) ring++
    }
  }
  if (ring > 0.03 * area) return -1
  // Barre de titre à gauche : gris uniforme (25,27,27) sur au moins 95 % de la bande
  const x0 = Math.max(0, x - 300)
  const x1 = x - 30
  if (x1 - x0 < 100) return -1
  let ok = 0
  let total = 0
  for (let j = 1; j < 16; j++) {
    let o = ((y + j) * W + x0) * 4
    for (let i = x0; i < x1; i++, o += 4) {
      total++
      if (
        Math.abs(data[o + 2] - BAR[0]) <= 1 &&
        Math.abs(data[o + 1] - BAR[1]) <= 1 &&
        Math.abs(data[o] - BAR[2]) <= 1
      )
        ok++
    }
  }
  return ok >= 0.95 * total ? inner : -1
}

function toWindow(bmp: Bitmap, x: number, y: number): SearchWindow | null {
  const gx = x + GRID_DX
  const gy = y + GRID_DY
  // toute la grille et la pagination doivent tenir dans l'écran
  if (
    gx < 0 ||
    gy < 0 ||
    gx + SEARCH_COLS * CELL > bmp.width ||
    gy + SEARCH_ROWS * CELL + 40 > bmp.height
  )
    return null
  return { gx, gy, closeX: x, closeY: y }
}

/**
 * Cherche la fenêtre « Recherche d'objet ». Avec `hint` (position trouvée à la capture précédente),
 * vérifie d'abord cet endroit : le cas courant, la fenêtre ne bouge pas, coûte quelques milliers
 * d'opérations au lieu d'un balayage de l'écran.
 */
export function findSearchWindow(
  bmp: Bitmap,
  hint?: { closeX: number; closeY: number } | null
): SearchWindow | null {
  if (bmp.width !== SUPPORTED_WIDTH || bmp.height !== SUPPORTED_HEIGHT) return null
  if (hint && checkButton(bmp, hint.closeX, hint.closeY) >= 0)
    return toWindow(bmp, hint.closeX, hint.closeY)

  const { width: W, height: H, data } = bmp
  // Image intégrale du masque « rouge du bouton » : nombre de pixels rouges d'un rectangle en O(1)
  const iw = W + 1
  const integral = new Int32Array(iw * (H + 1))
  for (let y = 0; y < H; y++) {
    let rowSum = 0
    let o = y * W * 4
    for (let x = 0; x < W; x++, o += 4) {
      if (isRedButton(data[o + 2], data[o + 1], data[o])) rowSum++
      integral[(y + 1) * iw + x + 1] = integral[y * iw + x + 1] + rowSum
    }
  }
  const need = Math.ceil(0.62 * BTN_W * BTN_H)
  let best: { x: number; y: number; inner: number } | null = null
  for (let y = 0; y + BTN_H <= H; y++) {
    for (let x = 0; x + BTN_W <= W; x++) {
      const inner =
        integral[(y + BTN_H) * iw + x + BTN_W] -
        integral[y * iw + x + BTN_W] -
        integral[(y + BTN_H) * iw + x] +
        integral[y * iw + x]
      if (inner < need || (best && inner <= best.inner)) continue
      const c = checkButton(bmp, x, y)
      if (c >= 0 && (!best || c > best.inner)) best = { x, y, inner: c }
    }
  }
  return best ? toWindow(bmp, best.x, best.y) : null
}

const lum = (d: Uint8Array, o: number): number =>
  (d[o + 2] * 299 + d[o + 1] * 587 + d[o] * 114) / 1000

/**
 * Empreinte du contenu de la grille : couleur moyenne de 9 points par case (12×12×3 valeurs).
 * Deux vues de la même page sont à moins de 1 d'écart ; deux pages différentes, à plus de 20.
 */
export function gridSignature(bmp: Bitmap, win: SearchWindow): Uint8Array {
  const sig = new Uint8Array(SEARCH_COLS * SEARCH_ROWS * 3)
  const offs = [16, 32, 48]
  let k = 0
  for (let r = 0; r < SEARCH_ROWS; r++) {
    for (let c = 0; c < SEARCH_COLS; c++) {
      let sr = 0
      let sg = 0
      let sb = 0
      for (const oy of offs) {
        for (const ox of offs) {
          const o = ((win.gy + r * CELL + oy) * bmp.width + win.gx + c * CELL + ox) * 4
          sb += bmp.data[o]
          sg += bmp.data[o + 1]
          sr += bmp.data[o + 2]
        }
      }
      sig[k++] = Math.round(sr / 9)
      sig[k++] = Math.round(sg / 9)
      sig[k++] = Math.round(sb / 9)
    }
  }
  return sig
}

/** Écart moyen absolu (0-255) entre deux empreintes. */
export function sigDistance(a: Uint8Array, b: Uint8Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
  return s / a.length
}

// --- pagination -----------------------------------------------------------------------------

/** Centres des trois cases de numéros, par rapport au coin de la grille. */
const SLOT_CX = [323, 360, 397]
const PAGER_CY = 775
const INK_MIN = 150

export interface PagerState {
  /** Case (0, 1 ou 2) en surbrillance = page courante, -1 si illisible */
  slot: number
  /** Numéros affichés dans les trois cases (null si non lus) */
  values: (number | null)[]
  /** Page courante déduite, null si impossible */
  current: number | null
}

const inkOf = (v: number): number => Math.min(1, Math.max(0, (v - 110) / 110))

const TEMPLATES: { ch: string; v: Float32Array }[] = []
for (const [ch, list] of Object.entries(PAGER_GLYPHS)) {
  for (const t of list) TEMPLATES.push({ ch, v: normalise(Float32Array.from(t, inkOf)) })
}

function normalise(v: Float32Array): Float32Array {
  let m = 0
  for (const x of v) m += x
  m /= v.length
  let n = 0
  for (let i = 0; i < v.length; i++) {
    v[i] -= m
    n += v[i] * v[i]
  }
  n = Math.sqrt(n) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}

function readSlotNumber(bmp: Bitmap, win: SearchWindow, cx: number): number | null {
  const y0 = win.gy + PAGER_CY - 5
  const x0 = win.gx + cx - 18
  const L = new Float32Array(GLYPH_H * 36)
  const colInk = new Uint8Array(36)
  for (let j = 0; j < GLYPH_H; j++) {
    for (let i = 0; i < 36; i++) {
      const v = lum(bmp.data, ((y0 + j) * bmp.width + x0 + i) * 4)
      L[j * 36 + i] = v
      if (v >= INK_MIN) colInk[i] = 1
    }
  }
  const spans: [number, number][] = []
  for (let i = 0; i < 36; i++) {
    if (!colInk[i]) continue
    if (spans.length && spans[spans.length - 1][1] === i - 1) spans[spans.length - 1][1] = i
    else spans.push([i, i])
  }
  if (spans.length === 0 || spans.length > 2) return null
  let text = ''
  for (const [c0, c1] of spans) {
    if (c1 - c0 + 1 > GLYPH_W) return null
    const g = new Float32Array(GLYPH_W * GLYPH_H)
    for (let j = 0; j < GLYPH_H; j++)
      for (let i = c0; i <= c1; i++) g[j * GLYPH_W + (i - c0)] = inkOf(L[j * 36 + i])
    const q = normalise(g)
    let best = ''
    let bs = -2
    for (const t of TEMPLATES) {
      let s = 0
      for (let i = 0; i < q.length; i++) s += q[i] * t.v[i]
      if (s > bs) {
        bs = s
        best = t.ch
      }
    }
    if (bs < 0.9) return null // chiffre inconnu (0 et 9 n'ont pas encore de modèle) : on ne devine pas
    text += best
  }
  return Number(text)
}

export function readPager(bmp: Bitmap, win: SearchWindow): PagerState {
  // Case active : un fond plus clair (≈28 contre ≈13) sur le bord haut de la case, hors chiffre
  const bright = SLOT_CX.map((cx) => {
    let s = 0
    let n = 0
    for (let j = PAGER_CY - 12; j < PAGER_CY - 8; j++) {
      for (let i = cx - 12; i < cx + 12; i++) {
        s += lum(bmp.data, ((win.gy + j) * bmp.width + win.gx + i) * 4)
        n++
      }
    }
    return s / n
  })
  const max = Math.max(...bright)
  const slot = max > 20 && bright.filter((b) => b > 20).length === 1 ? bright.indexOf(max) : -1
  const values = SLOT_CX.map((cx) => readSlotNumber(bmp, win, cx))
  let current: number | null = null
  if (slot >= 0) {
    const guesses = values
      .map((v, j) => (v === null ? null : v + (slot - j)))
      .filter((v): v is number => v !== null)
    if (guesses.length > 0 && guesses.every((g) => g === guesses[0]) && guesses[0] >= 1)
      current = guesses[0]
  }
  return { slot, values, current }
}
