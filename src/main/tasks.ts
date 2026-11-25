import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import type {
  GameMode,
  QuestObjective,
  QuestObjectiveItem,
  QuestTask,
  TasksData
} from '../shared/types'
import { getJson, LANG } from './tarkov'

/** La liste des quêtes ne change qu'avec les mises à jour du jeu : un jour de cache suffit. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
/** Au-delà, la liste d'objets acceptés (« n'importe quel objet de la catégorie ») n'est pas affichée. */
const MAX_LISTED_ITEMS = 8

interface RawObjective {
  id: string
  type: string
  count?: number
  optional?: boolean
  foundInRaid?: boolean
  items?: string[]
  item?: string
  questItem?: string
  markerItem?: string
  maps?: string[]
  zones?: unknown[]
  possibleLocations?: unknown[]
}
interface RawTask {
  id: string
  name: string
  trader: string
  wikiLink: string | null
  minPlayerLevel: number | null
  taskRequirements?: { task: string; status?: string[] }[]
  objectives?: RawObjective[]
  experience?: number
  restartable?: boolean
  factionName?: string
}
interface RawItem {
  id: string
  name: string
  shortName: string
  iconLink: string | null
}
type Translations = Record<string, string>

// v2 : les objectifs ont été ajoutés, l'ancien cache n'en a pas
const cachePath = (mode: GameMode): string =>
  join(app.getPath('userData'), `tasks-cache-v2-${mode}.json`)

async function readCache(mode: GameMode): Promise<TasksData | null> {
  try {
    return JSON.parse(await readFile(cachePath(mode), 'utf-8')) as TasksData
  } catch {
    return null
  }
}

const toList = <T>(v: Record<string, T> | T[]): T[] => (Array.isArray(v) ? v : Object.values(v))

export async function getTasks(mode: GameMode, forceRefresh = false): Promise<TasksData> {
  const cached = await readCache(mode)
  if (cached && !forceRefresh && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached, fromCache: true }
  }
  try {
    const [tasks, tasksTr, tradersTr, mapsTr, items, itemsTr] = await Promise.all([
      getJson<{
        data: {
          tasks: Record<string, RawTask> | RawTask[]
          questItems?: Record<string, RawItem> | RawItem[]
        }
      }>(`${mode}/tasks`),
      getJson<{ data: Translations }>(`${mode}/tasks_${LANG}`),
      getJson<{ data: Translations }>(`${mode}/traders_${LANG}`),
      getJson<{ data: Translations }>(`${mode}/maps_${LANG}`),
      getJson<{ data: { items: Record<string, RawItem> | RawItem[] } }>(`${mode}/items`),
      getJson<{ data: Translations }>(`${mode}/items_${LANG}`)
    ])
    const itemById = new Map(toList(items.data.items).map((i) => [i.id, i]))
    const questItemById = new Map(toList(tasks.data.questItems ?? []).map((i) => [i.id, i]))

    const itemOf = (id: string): QuestObjectiveItem | null => {
      const q = questItemById.get(id)
      if (q)
        return {
          id,
          name: tasksTr.data[`${id} Name`] ?? q.name,
          iconLink: q.iconLink,
          questItem: true
        }
      const i = itemById.get(id)
      if (!i) return null
      return {
        id,
        name: itemsTr.data[`${id} Name`] ?? i.name,
        iconLink: i.iconLink,
        questItem: false
      }
    }

    const toObjective = (o: RawObjective): QuestObjective => {
      const ids = [...(o.items ?? []), o.item, o.questItem, o.markerItem].filter(
        (x): x is string => !!x
      )
      const listed = ids.length <= MAX_LISTED_ITEMS
      return {
        id: o.id,
        type: o.type,
        text: tasksTr.data[o.id] ?? '',
        count: o.count ?? null,
        optional: o.optional === true,
        foundInRaid: o.foundInRaid === true,
        items: listed ? ids.map(itemOf).filter((x): x is QuestObjectiveItem => x !== null) : [],
        itemChoices: listed ? 0 : ids.length,
        maps: (o.maps ?? []).map((m) => mapsTr.data[`${m} Name`]).filter((n): n is string => !!n),
        located: (o.zones?.length ?? 0) > 0 || (o.possibleLocations?.length ?? 0) > 0
      }
    }

    const out: QuestTask[] = toList(tasks.data.tasks)
      .map((t) => {
        const objectives = (t.objectives ?? []).map(toObjective)
        return {
          id: t.id,
          name: tasksTr.data[`${t.id} name`] ?? tasksTr.data[t.name] ?? t.id,
          traderId: t.trader,
          trader: tradersTr.data[`${t.trader} Nickname`] ?? '',
          minLevel: t.minPlayerLevel ?? 1,
          // Seuls les prérequis « terminée » permettent de déduire qu'une quête est faite
          requires: (t.taskRequirements ?? [])
            .filter((r) => r.status?.includes('complete'))
            .map((r) => r.task),
          objectives,
          maps: [...new Set(objectives.flatMap((o) => o.maps))],
          experience: t.experience ?? 0,
          restartable: t.restartable === true,
          faction: t.factionName ?? 'Any',
          wikiLink: t.wikiLink ?? null
        }
      })
      .sort((a, b) => a.minLevel - b.minLevel || a.name.localeCompare(b.name, 'fr'))
    const data: TasksData = { mode, tasks: out, fetchedAt: Date.now(), fromCache: false }
    await writeFile(cachePath(mode), JSON.stringify(data))
    return data
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (cached) return { ...cached, fromCache: true, error }
    return { mode, tasks: [], fetchedAt: 0, fromCache: true, error }
  }
}
