import { useEffect, useState } from 'react'
import type { ScanStatus } from '../../../shared/types'

export default function ScanPage(): React.JSX.Element {
  const [s, setS] = useState<ScanStatus | null>(null)

  useEffect(() => {
    void window.api.getScan().then(setS)
    return window.api.onScan(setS)
  }, [])

  const running = s?.running ?? false

  return (
    <>
      <div className="topbar">
        <h2>Scan de l&apos;inventaire</h2>
        <span className="spacer" />
        <button onClick={() => void window.api.openScanDir()}>Ouvrir le dossier des captures</button>
        {running ? (
          <button className="active" onClick={() => void window.api.stopScan()}>Terminer le scan</button>
        ) : (
          <button className="active" onClick={() => void window.api.startScan()}>Démarrer le scan</button>
        )}
      </div>

      <div className="warn">
        Version de test : le scan capture la fenêtre du jeu et enregistre les images, mais la
        reconnaissance des items n&apos;est pas encore active. Ces images servent à la calibrer.
      </div>

      <div className="cards">
        <div className="card">
          <div className="label">Jeu</div>
          <div className="value">{!running ? '—' : s?.found ? 'Détecté ✓' : 'Introuvable'}</div>
        </div>
        <div className="card">
          <div className="label">Résolution capturée</div>
          <div className="value">{s && s.width ? `${s.width}×${s.height}` : '—'}</div>
        </div>
        <div className="card">
          <div className="label">Captures</div>
          <div className="value">{s?.frames ?? 0}</div>
        </div>
        <div className="card">
          <div className="label">Images enregistrées</div>
          <div className="value">{s?.saved ?? 0}</div>
        </div>
      </div>

      {s?.message && <div className="warn">{s.message}</div>}

      {running && (
        <p className="muted">
          Scan en cours. Dans le jeu : ouvre le stash et fais-le défiler lentement, puis ouvre le sac,
          le rig, les poches, le secure container, la boîte du lucky scav, et une zone de la planque
          (écran d&apos;amélioration). Garde chaque vue 2 secondes. Reviens ici et clique sur « Terminer ».
        </p>
      )}

      {s?.preview && <img className="preview" src={s.preview} alt="Dernière capture du jeu" />}
    </>
  )
}
