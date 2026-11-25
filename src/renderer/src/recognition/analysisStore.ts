import { useSyncExternalStore } from 'react'
import { remainingLevels } from '../../../shared/compute'
import { judge, usefulness, type Judgement } from '../../../shared/decision'
import {
  refineByColor,
  refineWithIcon,
  resolveNames,
  type NamedEntry,
  type Resolved
} from '../../../shared/names'
import type { CatalogEntry, GameMode, Progress } from '../../../shared/types'
import { RecognitionEngine, type PageAnalysis, type Step } from './engine'

/**
 * Analyse d'un scan, hors de l'interface : elle continue quand on change d'onglet et ses résultats
 * sont encore là quand on revient. L'écran s'y abonne (useAnalysis) et ne fait que l'afficher.
 */

export const NONE = 'none'

export interface Row {
  key: string
  a: PageAnalysis
  cell: PageAnalysis['cells'][number]
  /** Noms lus par l'OCR sur la case (un texte par réglage de lecture) */
  reads: string[]
  /** Candidats après croisement avec le nom lu */
  res: Resolved
  j: Judgement
  /** Intérêt de la case pour la planque et les quêtes (0 = aucun) */
  u: number
}

export interface AnalysisState {
  mode: GameMode
  busy: boolean
  step: Step | null
  error: string
  nameWarning: string
  dogtags: number
  rows: Row[]
  catalog: Map<string, CatalogEntry>
  /** Objets utiles (planque, quêtes en cours) et pourquoi */
  needs: Map<string, string[]>
  /** Objet choisi pour chaque case (NONE = non compté) */
  choice: Record<string, string>
  saved: string
  /** Durée de chaque étape de la dernière analyse, pour comprendre ce qui prend du temps */
  timings: string
  eng: RecognitionEngine | null
}

let state: AnalysisState = {
  mode: (localStorage.getItem('gameMode') as GameMode | null) ?? 'regular',
  busy: false,
  step: null,
  error: '',
  nameWarning: '',
  dogtags: 0,
  rows: [],
  catalog: new Map(),
  needs: new Map(),
  choice: {},
  saved: '',
  timings: '',
  eng: null
}
const listeners = new Set<() => void>()

function emit(patch: Partial<AnalysisState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getState = (): AnalysisState => state

export const useAnalysis = (): AnalysisState => useSyncExternalStore(subscribe, getState)

/** Mode choisi ailleurs dans l'application : on le relit à l'ouverture de l'écran (sauf analyse en cours). */
export function refreshMode(): void {
  const m = (localStorage.getItem('gameMode') as GameMode | null) ?? 'regular'
  if (!state.busy && m !== state.mode) emit({ mode: m })
}

export function setMode(mode: GameMode): void {
  if (state.busy) return
  localStorage.setItem('gameMode', mode)
  emit({ mode })
}

export function setChoices(keys: string[], id: string): void {
  const choice = { ...state.choice }
  for (const k of keys) choice[k] = id
  emit({ choice })
}

/**
 * Les dogtags s'affichent avec le pseudo du joueur à la place du nom de l'objet : le nom lu ne peut
 * rien confirmer. Ils sont écartés du calcul (BEAR, USEC ou « Dogtag » parmi les 2 meilleurs candidats).
 */
const isDogtag = (cands: { shortName: string; name: string }[]): boolean =>
  cands
    .slice(0, 2)
    .some((k) => /^(BEAR|USEC|Dogtag)$/i.test(k.shortName) || /^Dogtag/i.test(k.name))

const secs = (ms: number): string => `${(ms / 1000).toFixed(0)} s`

/** Types qui désignent des munitions, grenades, armes et pièces d'arme (les munitions s'affinent plus tard). */
const WEAPON_TYPES = new Set(['ammo', 'ammoBox', 'grenade', 'mods', 'gun'])

/** Au moins 4 des 5 meilleurs candidats sont des munitions, grenades ou pièces d'arme. */
const weaponLike = (res: Resolved, byId: Map<string, CatalogEntry>): boolean =>
  res.candidates.slice(0, 5).filter((c) => byId.get(c.id)?.types.some((t) => WEAPON_TYPES.has(t)))
    .length >= 4

export async function startAnalysis(): Promise<void> {
  if (state.busy) return
  const mode = state.mode
  emit({
    busy: true,
    error: '',
    nameWarning: '',
    dogtags: 0,
    saved: '',
    rows: [],
    timings: ''
  })
  const setStep = (step: Step | null): void => emit({ step })
  const t: Record<string, number> = { start: performance.now() }
  try {
    const session = await window.api.getLastScanSession()
    if (!session)
      throw new Error(
        "Aucun scan exploitable : fais un scan de la Recherche d'objet (les scans faits avant cette version n'ont pas la position de la grille)."
      )
    setStep({ label: 'Catalogue des objets', done: 0, total: 1 })
    const cat = await window.api.getCatalog(mode)
    if (!cat.items.length) throw new Error(cat.error ?? 'Catalogue des objets indisponible.')
    const byId = new Map(cat.items.map((e) => [e.id, e]))

    // Ce qui intéresse le joueur : objets des niveaux de planque restants et des quêtes en cours
    const [hideout, progress, tasks] = await Promise.all([
      window.api.getHideout(mode),
      window.api.loadProgress(mode),
      window.api.getTasks(mode)
    ])
    const need = new Map<string, string[]>()
    const addNeed = (id: string, why: string): void => {
      const l = need.get(id) ?? []
      if (!l.includes(why)) l.push(why)
      need.set(id, l)
    }
    for (const s of hideout.stations)
      for (const l of remainingLevels(s, progress))
        // L'argent n'est pas un objet à retrouver dans le stash : il se lit à part
        for (const r of l.requirements)
          if (r.kind !== 'currency') addNeed(r.itemId, `${s.name} niveau ${l.level}`)
    for (const q of tasks.tasks)
      if (progress.quests[q.id] === 'active')
        for (const o of q.objectives ?? [])
          for (const it of o.items) if (!it.questItem) addNeed(it.id, `Quête : ${q.name}`)
    emit({ catalog: byId, needs: need })
    t.catalog = performance.now()

    state.eng?.dispose()
    const eng = new RecognitionEngine()
    emit({ eng })
    const n = await eng.load(cat.items, setStep)
    if (n === 0) throw new Error("Aucune image de référence n'a pu être chargée.")
    t.images = performance.now()

    const pages = [...session.pages].sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9))
    // Les pages sont indépendantes : chaque worker en prend une à la fois, tous en parallèle
    const results: (PageAnalysis | null)[] = pages.map(() => null)
    let next = 0
    let done = 0
    setStep({ label: 'Analyse des pages', done: 0, total: pages.length })
    await Promise.all(
      Array.from({ length: eng.size }, async (_, w) => {
        while (next < pages.length) {
          const i = next++
          results[i] = await eng.analyze(session.dir, pages[i], w)
          setStep({ label: 'Analyse des pages', done: ++done, total: pages.length })
        }
      })
    )
    const analyses = results.filter((a): a is PageAnalysis => a !== null)
    t.pages = performance.now()

    // Le nom écrit sur chaque case confirme ou écarte les candidats de l'icône
    const nameError = await eng.readNames(analyses, setStep).catch((e: unknown) => {
      return e instanceof Error ? e.message : String(e)
    })
    if (nameError)
      emit({
        nameWarning: `Lecture des noms impossible (${nameError}) : la reconnaissance se fait sur l'icône seule, elle est moins sûre.`
      })
    t.names = performance.now()

    const bySize = new Map<string, NamedEntry[]>()
    for (const e of cat.items) {
      const k = `${e.w}x${e.h}`
      bySize.set(k, [...(bySize.get(k) ?? []), e])
    }
    const out: Row[] = []
    let dog = 0
    for (const a of analyses) {
      setStep({
        label: 'Croisement nom et icône',
        done: analyses.indexOf(a),
        total: analyses.length
      })
      const idx: number[] = []
      const resolved: Resolved[] = []
      a.cells.forEach((cell, i) => {
        if (isDogtag(cell.candidates)) {
          dog++
          return
        }
        idx.push(i)
        resolved.push(resolveNames(cell.candidates, a.reads[i], cell.w, cell.h, bySize))
      })
      // Quand plusieurs objets portent le nom lu, l'icône les départage (recalculée sur ces objets seulement).
      // Sans nom lisible et avec une icône ambiguë, la couleur de l'objet reclasse les meilleurs candidats.
      const asks = resolved
        .map((res, k) => ({ res, k, cell: a.cells[idx[k]] }))
        .filter(
          (x) =>
            x.res.named.length >= 2 ||
            (x.res.verdict === 'unknown' && !judge(x.cell, x.res).reliable)
        )
        .map((x) => ({
          k: x.k,
          cell: x.cell,
          byName: x.res.named.length >= 2,
          ids: x.res.named.length >= 2 ? x.res.named : x.res.candidates.map((c) => c.id)
        }))
      if (asks.length) {
        const scored = await eng.rescore(
          a,
          asks.map((q) => ({
            row: q.cell.row,
            col: q.cell.col,
            w: q.cell.w,
            h: q.cell.h,
            ids: q.ids
          }))
        )
        asks.forEach(
          (q, i) =>
            (resolved[q.k] = (q.byName ? refineWithIcon : refineByColor)(
              resolved[q.k],
              scored[i] ?? []
            ))
        )
      }
      resolved.forEach((res, k) => {
        const i = idx[k]
        const cell = a.cells[i]
        out.push({
          key: `${a.page.file}:${cell.row}:${cell.col}`,
          a,
          cell,
          reads: a.reads[i],
          res,
          j: judge(cell, res),
          // Une case sans nom lisible dont les candidats sont presque tous des munitions, grenades ou pièces d'arme n'est pas utile
          u:
            res.verdict === 'unknown' && !res.refined && weaponLike(res, byId)
              ? 0
              : usefulness(res, need)
        })
      })
    }
    t.cross = performance.now()
    // La comparaison est finie : on libère le catalogue en mémoire (les vignettes n'en ont plus besoin)
    eng.release()

    const init: Record<string, string> = {}
    // Seules les reconnaissances fiables sont comptées d'office ; les autres attendent ton choix
    for (const r of out) init[r.key] = r.j.reliable ? r.res.candidates[0].id : NONE
    // Mode développement : l'analyse complète est écrite à côté du scan, pour l'examiner hors de l'application
    if (import.meta.env.DEV)
      void window.api.saveAnalysis(
        session.dir,
        JSON.stringify({
          mode,
          date: new Date().toISOString(),
          pages: session.pages,
          dogtags: dog,
          cells: out.map((r) => ({
            file: r.a.page.file,
            page: r.a.page.page,
            gx: r.a.page.gx,
            gy: r.a.page.gy,
            row: r.cell.row,
            col: r.cell.col,
            w: r.cell.w,
            h: r.cell.h,
            reads: r.reads,
            verdict: r.res.verdict,
            why: r.j.why,
            level: r.j.level,
            reliable: r.j.reliable,
            useful: r.u,
            chosen: init[r.key],
            iconScore: r.cell.score,
            iconSecond: r.cell.second,
            candidates: r.res.candidates.map((c) => ({
              id: c.id,
              shortName: c.shortName,
              name: c.name,
              score: c.score
            }))
          }))
        })
      )
    emit({
      choice: init,
      rows: out,
      dogtags: dog,
      step: null,
      timings: `Durée : catalogue ${secs(t.catalog - t.start)} · images de référence ${secs(t.images - t.catalog)} · pages ${secs(t.pages - t.images)} · noms ${secs(t.names - t.pages)} · croisement ${secs(t.cross - t.names)} · total ${secs(t.cross - t.start)} · ${eng.size} workers sur ${navigator.hardwareConcurrency ?? '?'} cœurs`
    })
  } catch (e) {
    emit({ error: e instanceof Error ? e.message : String(e), step: null })
  }
  emit({ busy: false })
}

/** Remplace l'inventaire enregistré par celui de l'analyse (jamais un cumul). */
export async function saveInventory(): Promise<void> {
  const { mode, rows, choice, catalog } = state
  const counts = new Map<string, number>()
  for (const r of rows) {
    const id = choice[r.key]
    if (id && id !== NONE) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const p: Progress = await window.api.loadProgress(mode)
  const inventory: Record<string, number> = {}
  for (const [id, n] of counts) {
    // Une pile s'affiche en une seule icône : on ne lit pas encore sa quantité, on garde ce qui était saisi
    if ((catalog.get(id)?.stack ?? 1) > 1) {
      if (p.inventory[id] !== undefined) inventory[id] = p.inventory[id]
    } else inventory[id] = n
  }
  await window.api.saveProgress(mode, { ...p, inventory })
  const total = [...counts.values()].reduce((s, n) => s + n, 0)
  emit({
    saved: `Inventaire enregistré (${mode === 'pve' ? 'PvE' : 'PvP'}) : ${total} objets, ${counts.size} différents. L'ancien inventaire est remplacé.`
  })
}
