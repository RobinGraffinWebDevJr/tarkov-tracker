import type { CellMatch } from './recognition'
import type { Resolved } from './names'

/**
 * Décide si la reconnaissance d'une case est assez sûre pour être comptée sans te demander, et si
 * la case concerne un objet utile (planque, quêtes en cours).
 *
 * Seuils mesurés sur 556 cases de tes scans dont l'objet était certain :
 * - icône seule : écart ≥ 0,1 et score ≥ 0,4 → 280 sur 280 justes ; score ≥ 0,7 et écart ≥ 0,05 → 295 sur 296 ;
 * - nom lu + icône : 546 bons choix sur 546, aucun mauvais (600 cases testées).
 */

const SURE_MARGIN = 0.1
const SURE_SCORE = 0.4
const PROBABLE_MARGIN = 0.05
const PROBABLE_SCORE = 0.7
/** Quand le nom concorde, l'icône doit quand même être plausible (le candidat était dans ses 5 premiers) */
const NAME_ICON_MIN = 0.3
/** Écart minimal entre deux candidats concordants avec le nom pour choisir le meilleur */
const NAME_PAIR_GAP = 0.03
/** Un objet est « utile » s'il figure parmi les 3 premiers candidats d'une case */
const USEFUL_TOP = 3
/** Sans nom lisible : score minimal d'un candidat recherché pour proposer la case à la vérification */
const USEFUL_MIN = 0.55
/** Sans nom lisible, l'objet recherché doit être presque aussi ressemblant que le meilleur candidat, sinon c'est autre chose */
const USEFUL_GAP = 0.05

export const margin = (c: CellMatch): number => c.score - c.second

export type Level = 'sure' | 'probable' | 'doubt'

export interface Judgement {
  /** Comptée sans te demander */
  reliable: boolean
  level: Level
  /** Pourquoi : « nom + icône », « icône seule », « nom seulement »… */
  why: string
}

export function judge(cell: CellMatch, res: Resolved): Judgement {
  const iconSure = cell.score >= SURE_SCORE && margin(cell) >= SURE_MARGIN
  const iconProbable = cell.score >= PROBABLE_SCORE && margin(cell) >= PROBABLE_MARGIN
  // L'icône a départagé des objets de même nom (39 sur 39 justes sur des cas dont la réponse était connue)
  if (res.refined)
    return {
      reliable: true,
      level: 'probable',
      why: res.verdict === 'unknown' ? 'icône affinée par la couleur' : 'nom, départagé par l’icône'
    }
  switch (res.verdict) {
    case 'match': {
      const [top, next] = res.candidates
      if (top.score < NAME_ICON_MIN)
        return { reliable: false, level: 'doubt', why: 'nom seulement' }
      if (res.matched === 1) return { reliable: true, level: 'sure', why: 'nom + icône' }
      if (top.score - (next?.score ?? 0) >= NAME_PAIR_GAP)
        return { reliable: true, level: 'probable', why: 'nom + icône' }
      return { reliable: false, level: 'doubt', why: 'plusieurs objets portent ce nom' }
    }
    case 'found':
      // Mesuré sur 600 cases : quand un seul objet de même taille porte le nom lu, c'est le bon (401 sur 401)
      return res.matched === 1
        ? { reliable: true, level: 'probable', why: 'nom seul (objet unique)' }
        : { reliable: false, level: 'doubt', why: 'plusieurs objets portent ce nom' }
    case 'contradict':
      return { reliable: false, level: 'doubt', why: 'nom lu différent de l’icône' }
    default:
      if (iconSure) return { reliable: true, level: 'sure', why: 'icône seule' }
      if (iconProbable) return { reliable: true, level: 'probable', why: 'icône seule' }
      return { reliable: false, level: 'doubt', why: 'icône seule, ambiguë' }
  }
}

/**
 * Pertinence d'une case pour ce que cherche le joueur : 0 = sans intérêt, plus c'est haut, plus la
 * case mérite d'être regardée. Un nom lu qui ne ressemble à aucun candidat écarte la case.
 */
export function usefulness(res: Resolved, needs: { has(id: string): boolean }): number {
  const top = res.candidates.slice(0, USEFUL_TOP)
  switch (res.verdict) {
    case 'contradict':
      return 0
    case 'match':
    case 'found':
      return top.some((c) => needs.has(c.id)) ? 2 : 0
    default:
      return Math.max(
        0,
        ...top
          .filter(
            (c) => needs.has(c.id) && c.score >= USEFUL_MIN && c.score >= top[0].score - USEFUL_GAP
          )
          .map((c) => c.score)
      )
  }
}
