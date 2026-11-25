import { useEffect, useState } from 'react'
import HideoutPage from './pages/HideoutPage'
import ScanPage from './pages/ScanPage'
import type { UpdateState } from '../../shared/types'

type Tab = 'hideout' | 'scan' | 'quests'

function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('hideout')
  const [update, setUpdate] = useState<UpdateState | null>(null)

  useEffect(() => {
    void window.api.getUpdateState().then(setUpdate)
    return window.api.onUpdate(setUpdate)
  }, [])
  return (
    <div className="app">
      <aside className="sidebar">
        <h1>TARKOV TRACKER</h1>
        <button className={`nav ${tab === 'hideout' ? 'active' : ''}`} onClick={() => setTab('hideout')}>
          Planque
        </button>
        <button className={`nav ${tab === 'scan' ? 'active' : ''}`} onClick={() => setTab('scan')}>
          Scan inventaire
        </button>
        <button className="nav" disabled>Quêtes (bientôt)</button>
        <div className="sidebar-foot">
          {update?.kind === 'available' && (
            <button className="update" onClick={() => void window.api.installUpdate()}>
              Mettre à jour vers v{update.latest}
            </button>
          )}
          {update?.kind === 'downloading' && <div className="muted">Téléchargement de v{update.latest}…</div>}
          {update?.kind === 'failed' && <div className="warn">Mise à jour impossible : {update.message}</div>}
          {update && update.kind !== 'available' && update.kind !== 'downloading' && update.message && (
            <div className="muted">{update.message}</div>
          )}
          {update && update.kind !== 'disabled' && update.kind !== 'downloading' && (
            <button className="link" onClick={() => void window.api.checkUpdate().then(setUpdate)}>
              Vérifier les mises à jour
            </button>
          )}
          <div className="muted">
            {update ? `v${update.version}` : ''}
            {update?.checkedAt ? ` · vérifié à ${new Date(update.checkedAt).toLocaleTimeString('fr-FR')}` : ''}
          </div>
        </div>
      </aside>
      <main className="main">
        {tab === 'hideout' && <HideoutPage />}
        {tab === 'scan' && <ScanPage />}
      </main>
    </div>
  )
}

export default App
