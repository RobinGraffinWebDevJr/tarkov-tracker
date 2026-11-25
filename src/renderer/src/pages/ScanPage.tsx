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
        <button onClick={() => void window.api.openScanDir()}>
          Ouvrir le dossier des captures
        </button>
        {running ? (
          <button className="active" onClick={() => void window.api.stopScan()}>
            Terminer le scan
          </button>
        ) : (
          <button className="active" onClick={() => void window.api.startScan()}>
            Démarrer le scan
          </button>
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

      {(running || (s?.search.pages.length ?? 0) > 0) && s && (
        <div className="cards">
          <div className="card">
            <div className="label">Recherche d&apos;objet</div>
            <div className="value">{s.search.active ? 'Détectée ✓' : '—'}</div>
          </div>
          <div className="card">
            <div className="label">Page affichée</div>
            <div className="value">{s.search.active ? (s.search.current ?? '?') : '—'}</div>
          </div>
          <div className="card">
            <div className="label">Pages enregistrées</div>
            <div className="value">
              {s.search.pages.length ? s.search.pages.map((p) => p.page ?? '?').join(', ') : '—'}
            </div>
          </div>
          <div className="card">
            <div className="label">Pages à voir</div>
            <div className="value">
              {s.search.missing.length ? s.search.missing.join(', ') : '—'}
            </div>
          </div>
        </div>
      )}

      {running && (
        <p className="muted">
          Scan en cours. Pour le stash : ouvre la fenêtre « Recherche d&apos;objet » (filtre « cube
          », stash seulement) et tourne les pages une par une, environ 1 seconde chacune. Chaque
          page est enregistrée une seule fois, et les pages manquantes s&apos;affichent ci-dessus.
          Pour le reste (équipement porté, présentoirs), affiche l&apos;écran et garde-le 2
          secondes. Ne laisse qu&apos;une fenêtre ouverte à la fois. Reviens ici et clique sur «
          Terminer ».
        </p>
      )}

      {s?.preview && <img className="preview" src={s.preview} alt="Dernière capture du jeu" />}
    </>
  )
}
