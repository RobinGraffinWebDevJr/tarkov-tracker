import type { ScanPage, SearchScan } from '../shared/types'
import {
  gridSignature,
  readPager,
  sigDistance,
  type Bitmap,
  type SearchWindow
} from './searchWindow'

/** Empreintes de grille à moins de cet écart : même page lue deux fois de suite (donc l'image est stable). */
const STABLE_DIST = 2
/** Écart mesuré sur de vraies captures : 0 à 0,3 pour la même page, 24 ou plus entre deux pages. */
const SAME_PAGE_DIST = 8

interface SavedPage {
  sig: Uint8Array
  page: number | null
  file: string
}

export interface PagePlan {
  /** Nom du fichier à écrire dans le dossier de la session */
  file: string
  /** true si c'est une page de plus ; false si elle remplace une page de même numéro dont le contenu a changé */
  isNew: boolean
  /** À appeler une fois le fichier écrit : la page est alors comptée comme enregistrée */
  commit: () => void
}

export interface Observation {
  /** Page affichée, null si la pagination n'a pas pu être lue */
  current: number | null
  /** Image à enregistrer maintenant, sinon null */
  plan: PagePlan | null
  /** L'index des pages a changé sans nouvelle image (un numéro de page vient d'être appris) */
  indexChanged: boolean
}

const fileName = (page: number | null, seq: number): string =>
  page !== null
    ? `page-${String(page).padStart(2, '0')}.png`
    : `page-x${String(seq).padStart(2, '0')}.png`

/**
 * Décide, pour chaque capture de la fenêtre « Recherche d'objet », s'il faut enregistrer une image.
 * Une image par page : enregistrée quand la grille est identique à la lecture précédente (le jeu a
 * fini de l'afficher), et seulement si cette page n'a pas déjà été vue (par contenu, pas seulement
 * par numéro). Retourner sur une page déjà enregistrée n'ajoute rien.
 */
export class PageCollector {
  private prev: Uint8Array | null = null
  private stable = 0
  private pages: SavedPage[] = []
  private maxSeen = 0

  reset(): void {
    this.prev = null
    this.stable = 0
    this.pages = []
    this.maxSeen = 0
  }

  /** À appeler quand la fenêtre n'est plus visible : la prochaine page devra se restabiliser. */
  lost(): void {
    this.prev = null
    this.stable = 0
  }

  observe(bmp: Bitmap, win: SearchWindow, canSave: boolean): Observation {
    const sig = gridSignature(bmp, win)
    const pager = readPager(bmp, win)
    const current = pager.current
    for (const v of pager.values) if (v !== null && v > this.maxSeen) this.maxSeen = v

    this.stable = this.prev && sigDistance(sig, this.prev) < STABLE_DIST ? this.stable + 1 : 0
    this.prev = sig
    if (this.stable < 1 || !canSave) return { current, plan: null, indexChanged: false }

    const similar = this.pages.find((p) => sigDistance(p.sig, sig) < SAME_PAGE_DIST)
    if (similar) {
      // Page déjà enregistrée. Si son numéro était inconnu et qu'on le lit maintenant, on le garde.
      if (
        similar.page === null &&
        current !== null &&
        !this.pages.some((p) => p.page === current)
      ) {
        similar.page = current
        return { current, plan: null, indexChanged: true }
      }
      return { current, plan: null, indexChanged: false }
    }

    // Même numéro de page mais contenu différent (un item a bougé) : la plus récente remplace l'ancienne.
    const same = current !== null ? this.pages.find((p) => p.page === current) : undefined
    const file = same ? same.file : fileName(current, this.pages.length + 1)
    const plan: PagePlan = {
      file,
      isNew: !same,
      commit: () => {
        if (same) same.sig = sig
        else this.pages.push({ sig, page: current, file })
      }
    }
    return { current, plan, indexChanged: false }
  }

  index(): ScanPage[] {
    return this.pages.map(({ page, file }) => ({ page, file }))
  }

  summary(active: boolean, current: number | null): SearchScan {
    const known = new Set(this.pages.map((p) => p.page).filter((p): p is number => p !== null))
    const top = Math.max(this.maxSeen, ...known, 0)
    const missing: number[] = []
    for (let p = 1; p <= top; p++) if (!known.has(p)) missing.push(p)
    const pages = this.index().sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9))
    return { active, pages, current, missing }
  }
}
