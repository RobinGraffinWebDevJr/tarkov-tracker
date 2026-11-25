import { useState } from 'react'
import HideoutPage from './pages/HideoutPage'

type Tab = 'hideout' | 'inventory' | 'quests'

function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('hideout')
  return (
    <div className="app">
      <aside className="sidebar">
        <h1>TARKOV TRACKER</h1>
        <button className={`nav ${tab === 'hideout' ? 'active' : ''}`} onClick={() => setTab('hideout')}>
          Planque
        </button>
        <button className="nav" disabled>Inventaire (bientôt)</button>
        <button className="nav" disabled>Quêtes (bientôt)</button>
      </aside>
      <main className="main">{tab === 'hideout' && <HideoutPage />}</main>
    </div>
  )
}

export default App
