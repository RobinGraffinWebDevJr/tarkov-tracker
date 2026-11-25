import { useEffect, useMemo, useRef, useState } from 'react'
import { formatRub } from '../../../shared/compute'
import {
  emptyProgress,
  type GameMode,
  type MarketItem,
  type Progress,
  type QuestLogImport,
  type QuestObjective,
  type QuestStatus,
  type QuestTask,
  type TasksData
} from '../../../shared/types'

type StatusFilter = 'active' | 'available' | 'todo' | 'done' | 'failed' | 'all'
/** Valeur du sélecteur de statut : « todo » = non commencée */
type Choice = QuestStatus | 'todo'

const FILTER_LABEL: Record<StatusFilter, string> = {
  active: 'En cours',
  available: 'Disponibles (prérequis faits)',
  todo: 'Non commencées',
  done: 'Terminées',
  failed: 'Échouées',
  all: 'Toutes'
}
const CHOICE_LABEL: Record<Choice, string> = {
  todo: 'Non commencée',
  active: 'En cours',
  done: 'Terminée',
  failed: 'Échouée'
}
const STATUS_COLOR: Record<Choice, string | undefined> = {
  todo: undefined,
  active: '#e0b050',
  done: '#5fbf6a',
  failed: '#e06666'
}
const MODE_LABEL: Record<GameMode, string> = { regular: 'PvP', pve: 'PvE' }
/** Verbe affiché devant les objectifs dont le texte du jeu manque */
const TYPE_LABEL: Record<string, string> = {
  visit: 'Se rendre à un endroit',
  shoot: 'Éliminer',
  extract: 'Extraire',
  findItem: 'Trouver',
  giveItem: 'Rendre',
  findQuestItem: 'Trouver un objet de quête',
  giveQuestItem: 'Rendre un objet de quête',
  plantItem: 'Placer',
  plantQuestItem: 'Placer un objet de quête',
  mark: 'Marquer',
  buildWeapon: 'Construire une arme',
  sellItem: 'Vendre',
  useItem: 'Utiliser',
  skill: 'Niveau de compétence',
  traderLevel: 'Niveau de marchand',
  traderStanding: 'Réputation auprès du marchand',
  taskStatus: 'Autre quête',
  experience: 'Expérience',
  dialogue: 'Dialogue',
  globalVariable: 'Condition spéciale'
}

const day = (ms: number | null): string =>
  ms
    ? new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

const noApi =
  "Cette version de l'application ne connaît pas encore les quêtes : ferme et relance l'application."

const failedImport = (error: string): QuestLogImport => ({
  ok: false,
  error,
  dir: '',
  files: 0,
  totalEvents: 0,
  otherMode: 0,
  otherModes: [],
  wipes: 0,
  events: 0,
  since: null,
  until: null,
  quests: {},
  inferred: [],
  unknown: 0
})

async function loadTasks(mode: GameMode): Promise<TasksData> {
  const fail = (error: string): TasksData => ({
    mode,
    tasks: [],
    fetchedAt: 0,
    fromCache: true,
    error
  })
  if (typeof window.api.getTasks !== 'function') return fail(noApi)
  try {
    return await window.api.getTasks(mode)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return fail(/No handler registered/i.test(msg) ? noApi : msg)
  }
}

/** Prix du flea par objet, pour dire si un objet demandé s'achète. Sans prix, la page marche quand même. */
async function loadPrices(mode: GameMode): Promise<Map<string, MarketItem>> {
  try {
    if (typeof window.api.getMarket !== 'function') return new Map()
    const m = await window.api.getMarket(mode)
    return new Map(m.items.map((i) => [i.id, i]))
  } catch {
    return new Map()
  }
}

async function fetchImport(mode: GameMode, choose: boolean): Promise<QuestLogImport> {
  if (typeof window.api.importQuestLogs !== 'function') return failedImport(noApi)
  try {
    return await window.api.importQuestLogs(mode, choose)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return failedImport(/No handler registered/i.test(msg) ? noApi : msg)
  }
}

function Objective({
  o,
  prices
}: {
  o: QuestObjective
  prices: Map<string, MarketItem>
}): React.JSX.Element {
  return (
    <div className="obj">
      <div>
        {o.text || TYPE_LABEL[o.type] || o.type}
        {o.count && o.count > 1 && o.items.length > 0 ? ` (×${o.count})` : ''}
        {o.optional && <span className="tag">optionnel</span>}
        {o.foundInRaid && <span className="tag fir">trouvé en raid</span>}
        {o.maps.map((m) => (
          <span key={m} className="tag">
            {m}
          </span>
        ))}
        {o.located && <span className="tag">position connue</span>}
      </div>
      {o.itemChoices > 0 && (
        <div className="stations">{o.itemChoices} objets différents sont acceptés</div>
      )}
      {o.items.length > 0 && (
        <div className="chips">
          {o.items.map((it) => {
            const p = prices.get(it.id)
            return (
              <span key={it.id} className="chip">
                {it.iconLink && <img src={it.iconLink} alt="" />}
                {it.name}
                {it.questItem ? (
                  <span className="tag">objet de quête</span>
                ) : o.foundInRaid ? null : p ? (
                  p.onFlea ? (
                    <span className="tag flea">flea ≈ {formatRub(p.avg24h ?? p.low24h ?? 0)}</span>
                  ) : (
                    <span className="tag trader">pas sur le flea</span>
                  )
                ) : null}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function QuestsPage(): React.JSX.Element {
  const [mode, setMode] = useState<GameMode>(
    () => (localStorage.getItem('gameMode') as GameMode | null) ?? 'regular'
  )
  const [data, setData] = useState<TasksData | null>(null)
  const [prices, setPrices] = useState<Map<string, MarketItem>>(new Map())
  const [progress, setProgress] = useState<Progress>(emptyProgress())
  // Mode dont la progression est chargée : on n'enregistre qu'une fois chargée, pour ne pas écraser le fichier
  const [loadedMode, setLoadedMode] = useState<GameMode | null>(null)
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState<QuestLogImport | null>(null)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [trader, setTrader] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  // Après un changement de mode demandé par l'import, on relance l'import dans le bon mode
  const autoImport = useRef(false)

  useEffect(() => {
    localStorage.setItem('gameMode', mode)
    let cancelled = false
    void Promise.all([loadTasks(mode), window.api.loadProgress(mode), loadPrices(mode)]).then(
      ([d, p, pr]) => {
        if (cancelled) return
        setData(d)
        setProgress(p)
        setPrices(pr)
        setLoadedMode(mode)
        setPreview(null)
        if (autoImport.current) {
          autoImport.current = false
          setImporting(true)
          void fetchImport(mode, false).then((r) => {
            if (cancelled) return
            setImporting(false)
            if (!r.canceled) setPreview(r)
          })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [mode])

  useEffect(() => {
    if (loadedMode === mode) void window.api.saveProgress(mode, progress)
  }, [progress, loadedMode, mode])

  const tasks = useMemo(() => (data?.mode === mode ? data.tasks : []), [data, mode])
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const choiceOf = (id: string): Choice => progress.quests[id] ?? 'todo'
  const inferred = useMemo(() => new Set(progress.questsInferred), [progress.questsInferred])
  const traders = useMemo(
    () =>
      [...new Set(tasks.map((t) => t.trader).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'fr')
      ),
    [tasks]
  )

  const isAvailable = (t: QuestTask): boolean =>
    !progress.quests[t.id] && t.requires.every((r) => progress.quests[r] === 'done')

  const counts = useMemo(() => {
    const c = { done: 0, active: 0, failed: 0, available: 0 }
    for (const t of tasks) {
      const s = progress.quests[t.id]
      if (s) c[s]++
      else if (t.requires.every((r) => progress.quests[r] === 'done')) c.available++
    }
    return c
  }, [tasks, progress.quests])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tasks
      .filter((t) => {
        const s = progress.quests[t.id]
        if (status === 'active' && s !== 'active') return false
        if (status === 'done' && s !== 'done') return false
        if (status === 'failed' && s !== 'failed') return false
        if (status === 'todo' && s) return false
        if (status === 'available' && !isAvailable(t)) return false
        if (trader && t.trader !== trader) return false
        return !q || t.name.toLowerCase().includes(q)
      })
      .sort(
        (a, b) =>
          a.trader.localeCompare(b.trader, 'fr') ||
          a.minLevel - b.minLevel ||
          a.name.localeCompare(b.name, 'fr')
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, progress.quests, status, trader, query])

  const setChoice = (id: string, c: Choice): void =>
    setProgress((p) => {
      const quests = { ...p.quests }
      if (c === 'todo') delete quests[id]
      else quests[id] = c
      // Une correction manuelle remplace la déduction
      return { ...p, quests, questsInferred: p.questsInferred.filter((x) => x !== id) }
    })

  const toggle = (id: string): void =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const runImport = async (choose: boolean): Promise<void> => {
    setImporting(true)
    const r = await fetchImport(mode, choose)
    if (!r.canceled) setPreview(r)
    setImporting(false)
  }

  const switchAndImport = (m: GameMode): void => {
    autoImport.current = true
    setMode(m)
  }

  const apply = (): void => {
    if (!preview?.ok) return
    setProgress((p) => ({
      ...p,
      quests: preview.quests,
      questsInferred: preview.inferred,
      questsImport: {
        at: Date.now(),
        source: 'logs',
        events: preview.events,
        since: preview.since,
        until: preview.until
      }
    }))
    setStatus('active')
    setPreview(null)
  }

  const pv = preview
  const pvCounts = useMemo(() => {
    const c = { done: 0, active: 0, failed: 0 }
    if (pv?.ok) for (const s of Object.values(pv.quests)) c[s]++
    return c
  }, [pv])
  const hasState = Object.keys(progress.quests).length > 0

  return (
    <>
      <div className="topbar">
        <h2>Quêtes</h2>
        <span className="spacer" />
        <span className="seg">
          <button className={mode === 'regular' ? 'active' : ''} onClick={() => setMode('regular')}>
            PvP
          </button>
          <button className={mode === 'pve' ? 'active' : ''} onClick={() => setMode('pve')}>
            PvE
          </button>
        </span>
        <button className="active" disabled={importing} onClick={() => void runImport(false)}>
          {importing ? 'Lecture des logs…' : 'Importer depuis les logs du jeu'}
        </button>
      </div>

      {data?.error && (
        <div className="warn">Liste des quêtes indisponible ou ancienne : {data.error}</div>
      )}

      {!hasState && !pv && (
        <p className="muted">
          Le jeu écrit un message à chaque quête commencée, terminée ou échouée dans son dossier de
          logs. « Importer » lit ces fichiers une seule fois, en lecture seule (rien n&apos;est
          surveillé, rien n&apos;est modifié) et reconstitue ton avancement. Tu vérifies le résultat
          avant de l&apos;appliquer, puis tu peux corriger chaque quête à la main. Le mode affiché
          en haut (PvP ou PvE) doit être celui que tu joues.
        </p>
      )}

      {pv && (
        <div className="card" style={{ marginBottom: 18 }}>
          {pv.ok ? (
            <>
              <div className="label">Résultat de la lecture (pas encore appliqué)</div>
              <p>
                {pv.files} fichier{pv.files > 1 ? 's' : ''} lus dans <code>{pv.dir}</code>,{' '}
                {pv.totalEvents} messages de quête du mode {MODE_LABEL[mode]}
                {pv.otherMode > 0 && ` (${pv.otherMode} d'un autre mode, ignorés)`}.
                {pv.wipes > 0
                  ? ` ${pv.wipes} wipe${pv.wipes > 1 ? 's' : ''} précédent${pv.wipes > 1 ? 's' : ''} repéré${pv.wipes > 1 ? 's' : ''} (une quête terminée puis recommencée) : seul le wipe en cours est gardé. Il commence vers le ${day(pv.since)} (date estimée) et compte ${pv.events} messages, jusqu'au ${day(pv.until)}.`
                  : ` Période : du ${day(pv.since)} au ${day(pv.until)}.`}
              </p>
              <p>
                <strong>{pvCounts.done}</strong> terminées ({pv.inferred.length} déduites des quêtes
                suivantes), <strong>{pvCounts.active}</strong> en cours,{' '}
                <strong>{pvCounts.failed}</strong> échouées.
                {pv.unknown > 0 &&
                  ` ${pv.unknown} quête${pv.unknown > 1 ? 's' : ''} des logs n'existe${pv.unknown > 1 ? 'nt' : ''} pas dans les données de tarkov.dev et ${pv.unknown > 1 ? 'sont ignorées' : 'est ignorée'} à l'affichage.`}
              </p>
              {hasState && (
                <p className="muted">
                  Appliquer remplace l&apos;état des quêtes enregistré, y compris tes corrections
                  manuelles.
                </p>
              )}
              <div className="topbar" style={{ marginBottom: 0 }}>
                <button className="active" onClick={apply}>
                  Appliquer
                </button>
                <button onClick={() => setPreview(null)}>Annuler</button>
              </div>
            </>
          ) : (
            <>
              <div className="label">Import impossible</div>
              <p>{pv.error}</p>
              <div className="topbar" style={{ marginBottom: 0 }}>
                {pv.otherModes.map((m) => (
                  <button key={m} className="active" onClick={() => switchAndImport(m)}>
                    Passer en {MODE_LABEL[m]} et importer
                  </button>
                ))}
                <button disabled={importing} onClick={() => void runImport(true)}>
                  Choisir le dossier…
                </button>
                <button onClick={() => setPreview(null)}>Fermer</button>
              </div>
            </>
          )}
        </div>
      )}

      {hasState && (
        <>
          <div className="cards">
            <div className="card">
              <div className="label">En cours</div>
              <div className="value">{counts.active}</div>
            </div>
            <div className="card">
              <div className="label">Disponibles</div>
              <div className="value">{counts.available}</div>
            </div>
            <div className="card">
              <div className="label">Terminées</div>
              <div className="value">
                {counts.done} / {tasks.length}
              </div>
            </div>
            <div className="card">
              <div className="label">Échouées</div>
              <div className="value">{counts.failed}</div>
            </div>
          </div>
          {progress.questsImport && (
            <p className="muted">
              Importé depuis les logs le {day(progress.questsImport.at)} (messages du{' '}
              {day(progress.questsImport.since)} au {day(progress.questsImport.until)}). Les quêtes
              « déduite » sont comptées terminées parce qu&apos;une quête suivante est commencée.
              Les logs donnent l&apos;état de chaque quête, pas l&apos;avancement de ses objectifs.
            </p>
          )}
        </>
      )}

      <div className="topbar">
        <input
          type="search"
          placeholder="Chercher une quête…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 240 }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          {(Object.keys(FILTER_LABEL) as StatusFilter[]).map((s) => (
            <option key={s} value={s}>
              {FILTER_LABEL[s]}
            </option>
          ))}
        </select>
        <select value={trader} onChange={(e) => setTrader(e.target.value)}>
          <option value="">Tous les marchands</option>
          {traders.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button onClick={() => setOpen(new Set(rows.map((t) => t.id)))}>Tout déplier</button>
        <button onClick={() => setOpen(new Set())}>Tout replier</button>
        <span className="muted">
          {rows.length} quête{rows.length > 1 ? 's' : ''}
        </span>
      </div>

      {rows.length === 0 && (
        <p className="muted">
          {hasState
            ? 'Aucune quête dans ce filtre.'
            : 'Aucun état de quête enregistré pour ce mode : clique sur « Importer depuis les logs du jeu ».'}
        </p>
      )}

      {rows.map((t) => {
        const c = choiceOf(t.id)
        const isOpen = open.has(t.id)
        const missing = t.requires.filter((r) => progress.quests[r] !== 'done')
        return (
          <div key={t.id} className="quest">
            <div className="quest-head" onClick={() => toggle(t.id)}>
              <span className="arrow">{isOpen ? '▾' : '▸'}</span>
              <span className="name">
                {t.name}
                {t.faction !== 'Any' && <span className="tag">{t.faction}</span>}
                {inferred.has(t.id) && <span className="tag">déduite</span>}
              </span>
              <span className="muted">{t.trader}</span>
              <span className="muted" style={{ minWidth: 70, textAlign: 'right' }}>
                {t.minLevel > 0 ? `niveau ${t.minLevel}` : ''}
              </span>
              <select
                value={c}
                style={{ color: STATUS_COLOR[c] }}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setChoice(t.id, e.target.value as Choice)}
              >
                {(Object.keys(CHOICE_LABEL) as Choice[]).map((k) => (
                  <option key={k} value={k}>
                    {CHOICE_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            {isOpen && (
              <div className="quest-body">
                {t.maps.length > 0 && <div className="stations">Cartes : {t.maps.join(', ')}</div>}
                {t.requires.length > 0 && (
                  <>
                    <h4>Prérequis</h4>
                    <ul>
                      {t.requires.map((r) => {
                        const done = progress.quests[r] === 'done'
                        return (
                          <li key={r} style={{ color: done ? '#5fbf6a' : '#e06666' }}>
                            {done ? '✓' : '✗'} {byId.get(r)?.name ?? r}
                          </li>
                        )
                      })}
                    </ul>
                    {missing.length > 0 && c === 'todo' && (
                      <div className="stations">
                        Pas encore disponible : il manque {missing.length} prérequis.
                      </div>
                    )}
                  </>
                )}
                <h4>Objectifs</h4>
                {(t.objectives ?? []).length === 0 && <div className="muted">Aucun objectif.</div>}
                {(t.objectives ?? []).map((o) => (
                  <Objective key={o.id} o={o} prices={prices} />
                ))}
                <div className="stations" style={{ marginTop: 10 }}>
                  {t.experience > 0 && `${t.experience.toLocaleString('fr-FR')} XP · `}
                  {t.wikiLink && (
                    <a href={t.wikiLink} target="_blank" rel="noreferrer">
                      Page du wiki
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
