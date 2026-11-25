import { PITCH, type RgbaImage } from './recognition'

/**
 * Préparation de l'étiquette (nom affiché en haut de chaque case) pour la lecture par l'OCR de
 * Windows : niveaux de gris, inversé (texte sombre sur fond clair), agrandi, contraste étiré, marge
 * blanche. Réglages mesurés sur 600 cases dont l'objet était certain : un seul réglage lit 82 %
 * des noms, la combinaison de ces trois lectures en lit 90 %.
 */

/** Hauteur de l'étiquette dans le jeu, en pixels */
export const LABEL_HEIGHT = 17
const PAD = 20

export interface LabelVariant {
  scale: number
  /** Part (en %) des pixels les plus sombres et les plus clairs ignorée pour étirer le contraste */
  cutoff: number
}

export const LABEL_VARIANTS: LabelVariant[] = [
  { scale: 4, cutoff: 0 },
  { scale: 4, cutoff: 2 },
  { scale: 6, cutoff: 0 }
]

export interface GrayImage {
  width: number
  height: number
  data: Uint8Array
}

/** Étire le contraste comme le ferait un « autocontrast » : cutoff % des extrêmes sont ignorés. */
function autoContrast(g: Float32Array, cutoff: number): void {
  const hist = new Uint32Array(256)
  for (let i = 0; i < g.length; i++) hist[Math.max(0, Math.min(255, Math.round(g[i])))]++
  const cut = Math.floor((g.length * cutoff) / 100)
  let lo = 0
  let acc = 0
  while (lo < 255 && acc + hist[lo] <= cut) acc += hist[lo++]
  let hi = 255
  acc = 0
  while (hi > 0 && acc + hist[hi] <= cut) acc += hist[hi--]
  if (hi <= lo) return
  const k = 255 / (hi - lo)
  for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(255, (g[i] - lo) * k))
}

/**
 * Étiquette de l'objet dont le coin haut-gauche est en (x, y) et qui fait `w` cases de large.
 * Renvoie une image en niveaux de gris prête à être encodée en PNG.
 */
export function prepLabel(
  img: RgbaImage,
  x: number,
  y: number,
  w: number,
  v: LabelVariant
): GrayImage {
  const cw = w * PITCH
  const ch = LABEL_HEIGHT
  // niveaux de gris inversés de la zone d'origine
  const src = new Float32Array(cw * ch)
  for (let j = 0; j < ch; j++)
    for (let i = 0; i < cw; i++) {
      const o = ((y + j) * img.width + (x + i)) * 4
      const lum = 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2]
      src[j * cw + i] = 255 - lum
    }
  // agrandissement bilinéaire
  const tw = cw * v.scale
  const th = ch * v.scale
  const big = new Float32Array(tw * th)
  for (let j = 0; j < th; j++) {
    const fy = Math.max(0, Math.min(ch - 1, (j + 0.5) / v.scale - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(ch - 1, y0 + 1)
    const ty = fy - y0
    for (let i = 0; i < tw; i++) {
      const fx = Math.max(0, Math.min(cw - 1, (i + 0.5) / v.scale - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(cw - 1, x0 + 1)
      const tx = fx - x0
      big[j * tw + i] =
        src[y0 * cw + x0] * (1 - tx) * (1 - ty) +
        src[y0 * cw + x1] * tx * (1 - ty) +
        src[y1 * cw + x0] * (1 - tx) * ty +
        src[y1 * cw + x1] * tx * ty
    }
  }
  autoContrast(big, v.cutoff)
  // marge blanche : l'OCR lit mal un texte collé au bord de l'image
  const W = tw + 2 * PAD
  const H = th + 2 * PAD
  const out = new Uint8Array(W * H).fill(255)
  for (let j = 0; j < th; j++)
    for (let i = 0; i < tw; i++) out[(j + PAD) * W + i + PAD] = Math.round(big[j * tw + i])
  return { width: W, height: H, data: out }
}
