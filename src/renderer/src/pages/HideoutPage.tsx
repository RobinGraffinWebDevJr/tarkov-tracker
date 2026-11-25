import { useCallback, useEffect, useMemo, useState } from 'react'
import { computeMissing, formatRub, remainingLevels, type MissingItem } from '../../../shared/compute'
import { emptyProgress, type GameMode, type HideoutData, type Progress, type ReqKind } from '../../../shared/types'

type View = 'items' | 'zones'
type KindFilter = 'all' | ReqKind

const KIND_LABEL: Record<ReqKind, string> = {
  flea: 'Flea',
  trader: 'Marchand',
  currency: 'Argent',
  fir: 'Raid (FIR)'
}

export default function HideoutPage(): React.JSX.Element {
  const [data, setData] = useState<HideoutData | null>(null)
  const [progress, setProgress] = useState<Progress>(emptyProgress())
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<GameMode>(
    () => (localStorage.getItem('gameMode') as GameMode | null) ?? 'regular'
  )
  const [view, setView] = useState<View>('items')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [nextOnly, setNextOnly] = useState(false)
  const [hideDone, setHideDone] = useState(true)

  const refresh = useCallback(
    async (force: boolean) => {
      setLoading(true)
      setData(await window.api.getHideout(mode, force))
      setLoading(false)
    },
    [mode]
  )

  // Changement de mode : on recharge la progression de ce mode (fichier séparé) et ses prix
  useEffect(() => {
    localStorage.setItem('gameMode', mode)
    setLoaded(false)
    void window.api.loadProgress(mode).then((p) => {
      setProgress(p)
      setLoaded(true)
    })
    void refresh(false)
  }, [mode, refresh])

  // Sauvegarde auto (après chargement seulement, pour ne pas écraser le fichier du mode)
  useEffect(() => {
    if (loaded) void window.api.saveProgress(mode, progress)
  }, [progress, loaded, mode])

  const stations = data?.stations ?? []
  const missing = useMemo(
    () => computeMissing(stations, progress, { onlyNextLevel: nextOnly }),
    [stations, progress, nextOnly]
  )

  const totals = useMemo(() => {
    const buyable = missing.filter((m) => m.kind === 'flea' || m.kind === 'trader')
    return {
      currencyCost: missing.filter((m) => m.kind === 'currency').reduce((s, m) => s + (m.cost ?? 0), 0),
      fleaCost: missing.filter((m) => m.kind === 'flea').reduce((s, m) => s + (m.cost ?? 0), 0),
      traderCost: missing.filter((m) => m.kind === 'trader').reduce((s, m) => s + (m.cost ?? 0), 0),
      buyCount: buyable.reduce((s, m) => s + m.missing, 0),
      firCount: missing.filter((m) => m.kind === 'fir').reduce((s, m) => s + m.missing, 0)
    }
  }, [missing])

  const setLevel = (stationId: string, level: number): void =>
    setProgress((p) => ({ ...p, stationLevels: { ...p.stationLevels, [stationId]: level } }))
  const setOwned = (itemId: string, qty: number): void =>
    setProgress((p) => ({ ...p, inventory: { ...p.inventory, [itemId]: Math.max(0, qty) } }))

  const rows = missing.filter(
    (m) => (kindFilter === 'all' || m.kind === kindFilter) && (!hideDone || m.missing > 0)
  )

  return (
    <>
      <div className="topbar">
        <h2>Planque</h2>
        <div className="seg">
          <button className={mode === 'regular' ? 'active' : ''} onClick={() => setMode('regular')}>PvP</button>
          <button className={mode === 'pve' ? 'active' : ''} onClick={() => setMode('pve')}>PvE</button>
        </div>
        <span className="muted">
          {data?.fetchedAt
            ? `Prix du ${new Date(data.fetchedAt).toLocaleString('fr-FR')}${data.fromCache ? ' (cache)' : ''}`
            : 'Aucune donnée'}
        </span>
        <span className="spacer" />
        <label className="muted">
          <input type="checkbox" checked={nextOnly} onChange={(e) => setNextOnly(e.target.checked)} />{' '}
          Prochain niveau seulement
        </label>
        <button onClick={() => void refresh(true)} disabled={loading}>
          {loading ? 'Chargement…' : 'Actualiser les prix'}
        </button>
      </div>

      {data?.error && (
        <div className="warn">
          API tarkov.dev injoignable{data.fetchedAt ? ', affichage des dernières données en cache' : ''}.{' '}
          <span className="muted">{data.error.slice(0, 160)}</span>
        </div>
      )}

      <div className="cards">
        <Card label="Items à acheter" value={String(totals.buyCount)} />
        <Card label="Coût estimé flea (moy. 24h)" value={formatRub(totals.fleaCost)} />
        <Card label="Coût estimé marchands" value={formatRub(totals.traderCost)} />
        <Card label="Argent requis (₽/$/€, en ₽)" value={formatRub(totals.currencyCost)} />
        <Card label="Items à trouver en raid" value={String(totals.firCount)} />
      </div>

      <div className="topbar">
        <div className="seg">
          <button className={view === 'items' ? 'active' : ''} onClick={() => setView('items')}>Par item</button>
          <button className={view === 'zones' ? 'active' : ''} onClick={() => setView('zones')}>Par zone</button>
        </div>
        {view === 'items' && (
          <>
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as KindFilter)}>
              <option value="all">Tous les items</option>
              <option value="flea">Achetables flea</option>
              <option value="trader">Achetables marchand</option>
              <option value="fir">À trouver en raid</option>
              <option value="currency">Argent</option>
            </select>
            <label className="muted">
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />{' '}
              Masquer les items complets
            </label>
          </>
        )}
      </div>

      {view === 'items' ? (
        <ItemsTable rows={rows} onOwned={setOwned} />
      ) : (
        <div className="zones">
          {stations.map((s) => {
            const current = progress.stationLevels[s.id] ?? 0
            const rem = remainingLevels(s, progress)
            const stationMissing = computeMissing([s], progress, { onlyNextLevel: nextOnly })
            const cost = stationMissing
              .filter((m) => m.kind !== 'currency')
              .reduce((sum, m) => sum + (m.cost ?? 0), 0)
            const fir = stationMissing.filter((m) => m.kind === 'fir' && m.missing > 0).length
            return (
              <div className="zone" key={s.id}>
                <header>
                  <h3>{s.name}</h3>
                  <select value={current} onChange={(e) => setLevel(s.id, Number(e.target.value))}>
                    <option value={0}>Niveau 0</option>
                    {s.levels.map((l) => (
                      <option key={l.level} value={l.level}>Niveau {l.level}</option>
                    ))}
                  </select>
                </header>
                {rem.length === 0 ? (
                  <span className="muted">Niveau max atteint ✓</span>
                ) : (
                  <ul>
                    {stationMissing.filter((m) => m.missing > 0).map((m) => (
                      <li key={m.itemId}>
                        <span>
                          {m.missing}× {m.shortName}{' '}
                          <span className={`badge ${m.kind}`}>{KIND_LABEL[m.kind]}</span>
                        </span>
                        <span className="muted">{m.kind === 'fir' ? 'FIR' : formatRub(m.cost)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {rem.length > 0 && (
                  <div className="foot">
                    <span>{fir > 0 ? `${fir} item(s) FIR` : 'Aucun FIR'}</span>
                    <strong>{formatRub(cost)}</strong>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function Card({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  )
}

function ItemsTable({
  rows,
  onOwned
}: {
  rows: MissingItem[]
  onOwned: (id: string, qty: number) => void
}): React.JSX.Element {
  if (rows.length === 0) return <p className="muted">Rien à afficher.</p>
  return (
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Source</th>
          <th className="num">Besoin</th>
          <th className="num">Possédé</th>
          <th className="num">Manque</th>
          <th className="num">Prix moy. unité</th>
          <th className="num">Total estimé</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.itemId} className={m.missing === 0 ? 'done' : ''}>
            <td>
              <div className="item">
                {m.iconLink && <img src={m.iconLink} alt="" />}
                <div>
                  <div>{m.name}</div>
                  <div className="stations">{m.stations.join(', ')}</div>
                </div>
              </div>
            </td>
            <td><span className={`badge ${m.kind}`}>{KIND_LABEL[m.kind]}</span></td>
            <td className="num">{m.needed}</td>
            <td className="num">
              <input type="number" min={0} value={m.owned} onChange={(e) => onOwned(m.itemId, Number(e.target.value))} />
            </td>
            <td className="num"><strong>{m.missing}</strong></td>
            <td className="num">{m.kind === 'fir' ? '—' : formatRub(m.unitPrice)}</td>
            <td className="num">{m.kind === 'fir' ? '—' : formatRub(m.cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
