import type { GameMode, QuestEvent, QuestEventKind, QuestStatus, QuestTask } from './types'

/** Types de message du jeu : 10 = quête commencée, 11 = quête échouée, 12 = quête terminée. */
const KIND_BY_TYPE: Record<number, QuestEventKind> = { 10: 'start', 11: 'fail', 12: 'done' }
const OBJECT_ID = /^[0-9a-f]{24}$/
const LINE_START = /^(?=\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/m
/** Dans un même instant, un début passe avant un échec, qui passe avant une fin. */
const KIND_ORDER: Record<QuestEventKind, number> = { start: 0, fail: 1, done: 2 }

interface RawNotification {
  message?: { _id?: unknown; type?: unknown; dt?: unknown; templateId?: unknown }
}

export type KeyedQuestEvent = QuestEvent & { key: string }

/**
 * Extrait les messages de quête d'un fichier de notifications du jeu. Chaque notification est une
 * ligne « Got notification | ChatMessageReceived » suivie d'un bloc JSON. On ne garde que
 * l'identifiant de la quête, le type et l'heure : le texte des messages n'est jamais lu.
 */
export function parseQuestEvents(text: string): KeyedQuestEvent[] {
  const out: KeyedQuestEvent[] = []
  for (const block of text.split(LINE_START)) {
    if (!block.includes('Got notification | ChatMessageReceived')) continue
    const start = block.indexOf('{')
    if (start < 0) continue
    let raw: RawNotification
    try {
      raw = JSON.parse(block.slice(start)) as RawNotification
    } catch {
      continue // bloc coupé (fichier en cours d'écriture)
    }
    const m = raw.message
    if (!m || typeof m.type !== 'number' || typeof m.templateId !== 'string') continue
    const kind = KIND_BY_TYPE[m.type]
    const id = m.templateId.split(/\s+/)[0]
    if (!kind || !OBJECT_ID.test(id) || typeof m.dt !== 'number') continue
    out.push({ id, kind, at: m.dt * 1000, key: String(m._id ?? `${id}-${kind}-${m.dt}`) })
  }
  return out
}

export interface QuestReplay {
  quests: Record<string, QuestStatus>
  /** Wipes repérés avant le dernier */
  wipes: number
  since: number | null
  until: number | null
  /** Messages pris en compte (wipe en cours seulement) */
  events: number
}

/**
 * Rejoue les messages dans l'ordre pour reconstruire l'état des quêtes. Une quête commencée alors
 * qu'elle était déjà terminée (et qu'elle n'est pas recommençable) signale un nouveau wipe : tout
 * ce qui précède est abandonné, seul le wipe en cours compte.
 */
export function replayQuests(
  events: readonly QuestEvent[],
  restartable: ReadonlySet<string> = new Set()
): QuestReplay {
  const sorted = [...events].sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
  let from = 0
  let wipes = 0
  for (;;) {
    const quests: Record<string, QuestStatus> = {}
    const doneAt: Record<string, number> = {}
    let split = -1
    for (let i = from; i < sorted.length; i++) {
      const e = sorted[i]
      if (e.kind === 'start' && quests[e.id] === 'done' && !restartable.has(e.id)) {
        // Contradiction : la quête avait été terminée, la voilà recommencée. Un wipe a eu lieu entre
        // les deux. On le place au plus long silence : c'est là que le joueur a arrêté de jouer, et
        // les messages qui suivent (début du nouveau wipe) restent comptés au lieu d'être perdus.
        let best = doneAt[e.id] + 1
        let gap = -1
        for (let k = doneAt[e.id] + 1; k <= i; k++) {
          const g = sorted[k].at - sorted[k - 1].at
          if (g > gap) {
            gap = g
            best = k
          }
        }
        from = best
        wipes++
        split = i
        break
      }
      quests[e.id] = e.kind === 'start' ? 'active' : e.kind === 'done' ? 'done' : 'failed'
      if (e.kind === 'done') doneAt[e.id] = i
    }
    if (split < 0)
      return {
        quests,
        wipes,
        since: sorted[from]?.at ?? null,
        until: sorted.at(-1)?.at ?? null,
        events: sorted.length - from
      }
  }
}

/**
 * Une quête commencée ou terminée suppose que ses prérequis sont terminés, même si le jeu n'a
 * pas écrit leur message de fin (logs effacés, wipe commencé avant la conservation des logs…).
 * On les passe en « terminées » et on les liste à part pour que l'interface puisse le dire.
 */
export function inferPrerequisites(
  quests: Record<string, QuestStatus>,
  tasks: readonly QuestTask[]
): { quests: Record<string, QuestStatus>; inferred: string[] } {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const out = { ...quests }
  const inferred: string[] = []
  const seen = new Set<string>()
  const stack = Object.keys(quests).filter((id) => quests[id] !== 'failed')
  while (stack.length) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    for (const p of byId.get(id)?.requires ?? []) {
      if (out[p] === 'failed') continue
      if (out[p] !== 'done') {
        out[p] = 'done'
        inferred.push(p)
      }
      stack.push(p)
    }
  }
  return { quests: out, inferred }
}

const PVE_MARK = /wsn-pve|pve\.escapefromtarkov\.com/i
const PVP_MARK = /wsn-(?!pve)|prod\.escapefromtarkov\.com/i

/** Mode d'une session : le jeu écrit l'adresse de son serveur (avec « pve » ou non) dans ses journaux. */
export function sessionModeOf(text: string): GameMode | null {
  if (PVE_MARK.test(text)) return 'pve'
  if (PVP_MARK.test(text)) return 'regular'
  return null
}
