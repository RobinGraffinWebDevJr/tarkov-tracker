import { useState } from 'react'
import { formatRub } from '../../../shared/compute'
import { formatDuration, type Upgrade, type UpgradeState } from '../../../shared/priorities'
import type { HideoutStation, Progress } from '../../../shared/types'

const STATE_LABEL: Record<UpgradeState, string> = {
  ready: 'Prête à construire',
  buyable: 'Achetable',
  raid: 'Objets à trouver en raid',
  blocked: 'Bloquée'
}
const STATE_COLOR: Record<UpgradeState, string> = {
  ready: '#5fbf6a',
  buyable: '#5aa9e6',
  raid: '#e0645c',
  blocked: '#8d93a1'
}
const KIND_TAG: Record<string, string> = {
  flea: 'flea',
  trader: 'marchand',
  currency: 'argent',
  fir: 'raid'
}

/** Réglage rapide du niveau de chaque zone : le tracker ne peut pas le lire dans le jeu. */
export function LevelsEditor({
  stations,
  progress,
  onLevel
}: {
  stations: HideoutStation[]
  progress: Progress
  onLevel: (stationId: string, level: number) => void
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
        gap: 8,
        marginBottom: 16
      }}
    >
      {stations.map((s) => {
        const cur = progress.stationLevels[s.id] ?? 0
        const max = s.levels.length ? Math.max(...s.levels.map((l) => l.level)) : 0
        return (
          <div
            key={s.id}
            className="card"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}
          >
            <span style={{ flex: 1 }}>{s.name}</span>
            <button disabled={cur <= 0} onClick={() => onLevel(s.id, cur - 1)}>
              −
            </button>
            <span style={{ minWidth: 38, textAlign: 'center' }}>
              {cur} / {max}
            </span>
            <button disabled={cur >= max} onClick={() => onLevel(s.id, cur + 1)}>
              +
            </button>
          </div>
        )
      })}
    </div>
  )
}

function UpgradeCard({
  u,
  rank,
  onBuild
}: {
  u: Upgrade
  rank: number
  onBuild: (u: Upgrade) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(rank <= 3)
  const missing = u.items.filter((i) => i.missing > 0)
  return (
    <div className="quest">
      <div className="quest-head" onClick={() => setOpen(!open)}>
        <span className="arrow">{open ? '▾' : '▸'}</span>
        <span className="muted" style={{ minWidth: 26 }}>
          #{rank}
        </span>
        <span className="name">
          {u.stationName} → niveau {u.level}
          <span
            className="tag"
            style={{ color: STATE_COLOR[u.state], borderColor: STATE_COLOR[u.state] }}
          >
            {STATE_LABEL[u.state]}
          </span>
          {u.unlocks.length > 0 && <span className="tag">débloque {u.unlocks.length}</span>}
        </span>
        <span className="muted" style={{ minWidth: 90, textAlign: 'right' }}>
          {Math.round(u.progress * 100)} % réuni
        </span>
        <span style={{ minWidth: 110, textAlign: 'right' }}>
          {u.state === 'ready' ? '—' : formatRub(u.buyCost)}
          {u.firMissing > 0 && <span className="muted"> + {u.firMissing} FIR</span>}
        </span>
      </div>
      {open && (
        <div className="quest-body">
          {u.blockedBy.length > 0 && (
            <div className="stations" style={{ color: '#e0b050' }}>
              D&apos;abord : {u.blockedBy.join(', ')}.
            </div>
          )}
          {u.otherReqs.length > 0 && (
            <div className="stations">À vérifier en jeu : {u.otherReqs.join(', ')}.</div>
          )}
          {u.unlocks.length > 0 && (
            <div className="stations">Débloque : {u.unlocks.join(', ')}.</div>
          )}
          <div className="stations">Construction : {formatDuration(u.time)}</div>
          <h4>Objets</h4>
          {missing.length === 0 ? (
            <div style={{ color: '#5fbf6a' }}>Tous les objets sont réunis.</div>
          ) : (
            <div className="chips">
              {missing.map((i) => (
                <span key={i.itemId} className="chip">
                  {i.iconLink && <img src={i.iconLink} alt="" />}
                  {i.missing}× {i.shortName}
                  {i.covered > 0 && (
                    <span className="muted">
                      {' '}
                      (déjà {i.covered}/{i.needed})
                    </span>
                  )}
                  <span
                    className={`tag ${i.kind === 'fir' ? 'fir' : i.kind === 'flea' ? 'flea' : 'trader'}`}
                  >
                    {KIND_TAG[i.kind]}
                    {i.kind !== 'fir' && i.cost != null && ` ${formatRub(i.cost)}`}
                  </span>
                </span>
              ))}
            </div>
          )}
          <div className="topbar" style={{ marginTop: 12, marginBottom: 0 }}>
            <button disabled={u.blockedBy.length > 0} onClick={() => onBuild(u)}>
              Marquer comme construite
            </button>
            <span className="muted">
              Passe la zone au niveau {u.level} et retire les objets utilisés de ton inventaire.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export function Priorities({
  upgrades,
  onBuild
}: {
  upgrades: Upgrade[]
  onBuild: (u: Upgrade) => void
}): React.JSX.Element {
  if (upgrades.length === 0)
    return <p className="muted">Toutes les zones sont au niveau maximum, ou aucune donnée.</p>
  const next =
    upgrades.find((u) => u.state === 'ready') ?? upgrades.find((u) => u.state === 'buyable')
  return (
    <>
      {next && (
        <div className="warn" style={{ background: '#1f3324', borderColor: '#35613f' }}>
          {next.state === 'ready' ? (
            <>
              <strong>
                {next.stationName} niveau {next.level}
              </strong>{' '}
              peut être construite maintenant.
            </>
          ) : (
            <>
              Meilleure prochaine amélioration :{' '}
              <strong>
                {next.stationName} niveau {next.level}
              </strong>
              , il manque {formatRub(next.buyCost)} d&apos;objets achetables.
            </>
          )}
        </div>
      )}
      <p className="muted">
        Classement : ce qui est prêt, puis ce qui s&apos;achète, puis ce qui demande du raid, enfin
        ce qui attend une autre zone. À état égal, celle qui en débloque le plus passe devant, puis
        la moins chère. Un même objet n&apos;est compté que pour une seule zone.
      </p>
      {upgrades.map((u, i) => (
        <UpgradeCard key={`${u.stationId}-${u.level}`} u={u} rank={i + 1} onBuild={onBuild} />
      ))}
    </>
  )
}
