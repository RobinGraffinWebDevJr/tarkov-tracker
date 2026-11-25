import { useEffect, useState } from 'react'
import HideoutPage from './pages/HideoutPage'
import type { UpdateState } from '../../shared/types'

type Tab = 'hideout' | 'inventory' | 'quests'

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
        <button className="nav" disabled>Inventaire (bientôt)</button>
        <button className="nav" disabled>Quêtes (bientôt)</button>
        <div className="sidebar-foot">
          {update?.kind === 'available' && (
            <button className="update" onClick={() => void window.api.installUpdate()}>
              Mettre à jour vers v{update.latest}
            </button>
          )}
          {update?.kind === 'downloading' && <div className="muted">Téléchargement de v{update.latest}…</div>}
          {update?.kind === 'failed' && <div className="warn">Mise à jour impossible : {update.message}</div>}
          <div className="muted">{update ? `v${update.version}` : ''}</div>
        </div>
      </aside>
      <main className="main">{tab === 'hideout' && <HideoutPage />}</main>
    </div>
  )
}

export default App
