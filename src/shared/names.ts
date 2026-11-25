import type { Candidate } from './recognition'

/**
 * Croisement entre le nom lu sur la case (OCR) et les candidats trouvés par l'icône.
 * Le jeu écrit en haut de chaque case le nom court de l'objet, coupé à la largeur de la case.
 */

/** Minuscules, sans accents ni ponctuation : « Œuf » et « oeuf » se valent. */
export const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** Plus longue séquence commune de a[alo:ahi] et b[blo:bhi] (même règle de départage que difflib). */
function longest(
  a: string,
  b: string,
  alo: number,
  ahi: number,
  blo: number,
  bhi: number
): [number, number, number] {
  let besti = alo
  let bestj = blo
  let bestk = 0
  let prev = new Map<number, number>()
  for (let i = alo; i < ahi; i++) {
    const cur = new Map<number, number>()
    for (let j = blo; j < bhi; j++) {
      if (a[i] !== b[j]) continue
      const k = (prev.get(j - 1) ?? 0) + 1
      cur.set(j, k)
      if (k > bestk) {
        besti = i - k + 1
        bestj = j - k + 1
        bestk = k
      }
    }
    prev = cur
  }
  return [besti, bestj, bestk]
}

function matchingChars(
  a: string,
  b: string,
  alo: number,
  ahi: number,
  blo: number,
  bhi: number
): number {
  const [i, j, k] = longest(a, b, alo, ahi, blo, bhi)
  if (!k) return 0
  return (
    k +
    (alo < i && blo < j ? matchingChars(a, b, alo, i, blo, j) : 0) +
    (i + k < ahi && j + k < bhi ? matchingChars(a, b, i + k, ahi, j + k, bhi) : 0)
  )
}

/** Ratio de ressemblance de deux chaînes, de 0 à 1 (même calcul que SequenceMatcher.ratio de Python). */
export function ratio(a: string, b: string): number {
  if (!a.length && !b.length) return 1
  return (2 * matchingChars(a, b, 0, a.length, 0, b.length)) / (a.length + b.length)
}

/**
 * Ressemblance entre un nom lu et le nom court d'un objet. Le nom affiché est coupé à la largeur de
 * la case, donc on compare au début du nom court ; le dernier caractère lu est souvent la bordure
 * de la case, on essaie aussi sans lui.
 */
export function nameSimilarity(label: string, shortName: string): number {
  const n = norm(label)
  const sn = norm(shortName)
  if (!n || !sn) return 0
  let best = 0
  // La bordure de la case se lit parfois comme une lettre en fin de nom ; jamais un chiffre : « 218 » ne doit pas devenir « 21 »
  for (const L of new Set(n.length > 3 && /[a-z]$/.test(n) ? [n, n.slice(0, -1)] : [n])) {
    if (!L) continue
    best = Math.max(best, ratio(L, sn.length > L.length ? sn.slice(0, L.length + 1) : sn))
  }
  return best
}

/** Au-dessus : le nom lu correspond à ce candidat. */
export const NAME_MATCH = 0.8
/** Recherche directe par le nom dans tout le catalogue : seuil plus strict. */
export const NAME_SEARCH = 0.9
/** Le nom lu est quasiment identique au nom court d'un candidat... */
const NAME_EXACT = 0.97
/** ... alors les autres ne comptent que s'ils sont presque aussi proches. */
const NAME_CLOSE = 0.9
/** Sous ce seuil pour tous les candidats : le nom lu ne correspond à aucun. */
const NAME_CONTRADICT = 0.5
/** Un nom lu a au moins ce nombre de lettres pour être pris au sérieux. */
const MIN_READABLE = 4
/** Pour constater qu'un nom lu CONTREDIT l'icône, 3 lettres suffisent. */
const MIN_CONTRADICT = 3
/** Poids du nom dans le classement des candidats concordants. */
const NAME_WEIGHT = 0.6

export interface NamedEntry {
  id: string
  name: string
  shortName: string
  w: number
  h: number
}

/**
 * match : au moins un candidat concorde avec le nom lu (les autres sont écartés).
 * found : aucun candidat de l'icône ne concorde, mais le catalogue contient ce nom à cette taille.
 * contradict : un nom est lisible et ne ressemble à aucun candidat.
 * unknown : nom illisible (noms très courts, reflets) : on ne sait rien de plus.
 */
export type NameVerdict = 'match' | 'found' | 'contradict' | 'unknown'

export interface Resolved {
  verdict: NameVerdict
  /** Candidats retenus, du meilleur au moins bon (concordants d'abord si le nom a servi) */
  candidates: Candidate[]
  /** Nombre de candidats de l'icône qui concordent avec le nom lu (verdict « found » : nombre d'objets portant ce nom) */
  matched: number
  /** Objets du catalogue qui portent le nom lu, quand il y en a plusieurs (pour que l'icône les départage) */
  named: string[]
  /** L'icône a départagé des objets de même nom */
  refined: boolean
}

export function resolveNames(
  cands: Candidate[],
  reads: string[],
  w: number,
  h: number,
  bySize: Map<string, NamedEntry[]>
): Resolved {
  const sims = cands.map((k) => Math.max(0, ...reads.map((r) => nameSimilarity(r, k.shortName))))
  const readable = reads.some((r) => norm(r).length >= MIN_READABLE)
  /** Tous les objets du catalogue, de cette taille, qui portent le nom lu */
  const catalogNamed = (): NamedEntry[] =>
    (bySize.get(`${w}x${h}`) ?? [])
      .map((e) => ({ e, sim: Math.max(0, ...reads.map((r) => nameSimilarity(r, e.shortName))) }))
      .filter((x) => x.sim >= NAME_SEARCH)
      .sort((a, b) => b.sim - a.sim)
      .map((x) => x.e)
  const namedOrHits = (): string[] => {
    const n = catalogNamed()
    return (n.length >= 2 ? n.map((e) => e.id) : hitsIds()).slice(0, 12)
  }
  const hitsIds = (): string[] => cands.filter((_, i) => sims[i] >= NAME_MATCH).map((k) => k.id)
  let hits = cands
    .map((k, i) => ({ k, s: k.score + NAME_WEIGHT * sims[i], sim: sims[i] }))
    .filter((x) => x.sim >= NAME_MATCH)
    .sort((a, b) => b.s - a.s)
  // Un nom lu identique à celui d'un objet écarte les noms seulement voisins (« Obdolbos » n'est pas « Obdolbos 2 »),
  // sauf ceux qui COMMENCENT par le nom lu : le jeu coupe les noms longs (« CTR » peut être le début de « CTR FDE »)
  if (hits.some((x) => x.sim >= NAME_EXACT))
    hits = hits.filter(
      (x) =>
        x.sim >= NAME_CLOSE ||
        reads.some((r) => norm(r).length >= 3 && norm(x.k.shortName).startsWith(norm(r)))
    )
  if (hits.length)
    return {
      verdict: 'match',
      candidates: hits.map((x) => x.k),
      matched: hits.length,
      // Plusieurs concordants : l'icône pourra départager parmi tous les objets de ce nom ; si le nom lu
      // est trop abîmé pour désigner le catalogue (« SpecterOR »), parmi les seuls concordants
      named: hits.length > 1 ? namedOrHits() : [],
      refined: false
    }

  if (readable) {
    // L'icône n'a pas proposé le bon objet : on cherche le nom dans les objets de même taille
    const named = catalogNamed()
    if (named.length)
      return {
        verdict: 'found',
        candidates: named.slice(0, 3).map((e) => ({
          id: e.id,
          name: e.name,
          shortName: e.shortName,
          score: 0
        })),
        // Pour « found », nombre d'objets du catalogue qui portent ce nom : 1 = le nom suffit à désigner l'objet
        matched: named.length,
        named: named.map((e) => e.id),
        refined: false
      }
  }
  // Un nom même court (3 lettres) qui ne ressemble à aucun candidat contredit l'icône (« Eau » n'est pas « Wilston »)
  if (reads.some((r) => norm(r).length >= MIN_CONTRADICT) && Math.max(0, ...sims) < NAME_CONTRADICT)
    return { verdict: 'contradict', candidates: cands, matched: 0, named: [], refined: false }
  return { verdict: 'unknown', candidates: cands, matched: 0, named: [], refined: false }
}

/** L'icône départage deux objets de même nom si son meilleur score dépasse celui du suivant d'au moins ceci. */
const ICON_PAIR_GAP = 0.05
/** Et si l'icône ressemble un minimum à l'objet choisi. */
const ICON_MIN = 0.2

/** Sans nom lisible : la couleur de l'objet tranche si son meilleur score dépasse celui du suivant d'au moins ceci (13 cases sur 13 justes) */
const COLOR_GAP = 0.08
const COLOR_MIN = 0.3

/**
 * Cas sans nom lisible : on reclasse les meilleurs candidats de l'icône avec la couleur de l'objet
 * seul en plus de la corrélation (`scored`, du plus ressemblant au moins ressemblant). Si l'écart
 * est net, la case est tranchée ; sinon on garde seulement le nouvel ordre.
 */
export function refineByColor(res: Resolved, scored: Candidate[]): Resolved {
  if (scored.length < 2) return res
  const [top, next] = scored
  const sure = top.score >= COLOR_MIN && top.score - next.score >= COLOR_GAP
  return { ...res, candidates: scored.slice(0, 5), matched: sure ? 1 : res.matched, refined: sure }
}

/**
 * Quand le nom ne désigne pas un seul objet, on recalcule la ressemblance de l'icône avec ces
 * objets seulement (`scored`, du plus ressemblant au moins ressemblant). Mesuré sur 39 cases de
 * noms multiples dont la réponse était connue : le bon objet sort en tête 39 fois sur 39.
 */
export function refineWithIcon(res: Resolved, scored: Candidate[]): Resolved {
  if (scored.length < 2) return res
  const [top, next] = scored
  if (top.score < ICON_MIN || top.score - next.score < ICON_PAIR_GAP) return res
  return { ...res, candidates: scored.slice(0, 5), matched: 1, refined: true }
}
