import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatRub } from '../../../shared/compute'
import type { GameMode, MarketData, MarketItem } from '../../../shared/types'

type View = 'favs' | 'top'
type Sort = 'avg' | 'perSlot' | 'change' | 'offers'
type Category = 'all' | 'barter' | 'keys' | 'meds' | 'provisions'

const CATEGORY_LABEL: Record<Category, string> = {
  all: 'Tout',
  barter: 'Objets de troc',
  keys: 'Clés',
  meds: 'Soins',
  provisions: 'Nourriture'
}
const MAX_ROWS = 100
const FAVS_KEY = 'marketFavs'

function loadFavs(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAVS_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

const price = (n: number | null): string => (n === null ? '—' : formatRub(n))

function Change({ pct }: { pct: number | null }): React.JSX.Element {
  if (pct === null) return <span className="muted">—</span>
  const color = pct > 0 ? '#5fbf6a' : pct < 0 ? '#e06666' : undefined
  return (
    <span style={{ color }}>
      {pct > 0 ? '+' : ''}
      {pct.toFixed(1)} %
    </span>
  )
}

function Row({
  it,
  fav,
  onToggle
}: {
  it: MarketItem
  fav: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <tr>
      <td>
        <button
          className="link"
          style={{ textDecoration: 'none', fontSize: 16 }}
          title={fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          onClick={onToggle}
        >
          {fav ? '★' : '☆'}
        </button>
      </td>
      <td>
        <div className="item">
          {it.iconLink && <img src={it.iconLink} alt="" />}
          <div>
            <div>{it.name}</div>
            <div className="stations">
              {it.slots} case{it.slots > 1 ? 's' : ''}
              {!it.onFlea && ' · hors flea (prix de référence)'}
            </div>
          </div>
        </div>
      </td>
      <td className="num">{price(it.avg24h)}</td>
      <td className="num">{price(it.avg24h === null ? null : Math.round(it.avg24h / it.slots))}</td>
      <td className="num">
        {price(it.low24h)} – {price(it.high24h)}
      </td>
      <td className="num">
        <Change pct={it.change48hPct} />
      </td>
      <td className="num">{it.offers}</td>
    </tr>
  )
}

/**
 * Charge les prix. Si l'application tourne avec une ancienne version de sa partie principale
 * (cas du mode dev, qui ne la recharge pas à chaud), on le dit au lieu de planter la page.
 */
async function loadMarket(mode: GameMode, force: boolean): Promise<MarketData> {
  const fail = (error: string): MarketData => ({
    mode,
    items: [],
    fetchedAt: 0,
    fromCache: true,
    error
  })
  if (typeof window.api.getMarket !== 'function')
    return fail(
      "Cette version de l'application ne connaît pas encore le marché : ferme et relance l'application."
    )
  try {
    return await window.api.getMarket(mode, force)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return fail(
      /No handler registered/i.test(msg)
        ? "Ferme et relance l'application (le marché vient d'être ajouté)."
        : msg
    )
  }
}

export default function MarketPage(): React.JSX.Element {
  const [mode, setMode] = useState<GameMode>(
    () => (localStorage.getItem('gameMode') as GameMode | null) ?? 'regular'
  )
  const [data, setData] = useState<MarketData | null>(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<View>('favs')
  const [favs, setFavs] = useState<string[]>(loadFavs)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('perSlot')
  const [category, setCategory] = useState<Category>('all')
  const [fleaOnly, setFleaOnly] = useState(true)
  const [minOffers, setMinOffers] = useState(3)

  const refresh = useCallback(
    async (force: boolean) => {
      setLoading(true)
      setData(await loadMarket(mode, force))
      setLoading(false)
    },
    [mode]
  )

  // Chargement initial et changement de mode : pas de setState synchrone dans l'effet
  useEffect(() => {
    localStorage.setItem('gameMode', mode)
    let cancelled = false
    void loadMarket(mode, false).then((d) => {
      if (!cancelled) setData(d)
    })
    return () => {
      cancelled = true
    }
  }, [mode])

  const toggleFav = (id: string): void =>
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      localStorage.setItem(FAVS_KEY, JSON.stringify(next))
      return next
    })

  const items = useMemo(() => data?.items ?? [], [data])
  const q = query.trim().toLowerCase()
  const matches = (i: MarketItem): boolean =>
    !q || i.name.toLowerCase().includes(q) || i.shortName.toLowerCase().includes(q)

  const favItems = useMemo(
    () =>
      items
        .filter((i) => favs.includes(i.id) && matches(i))
        .sort((a, b) => (b.avg24h ?? 0) - (a.avg24h ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, favs, q]
  )

  const searchResults = useMemo(
    () =>
      q
        ? items
            .filter(matches)
            .sort((a, b) => (b.avg24h ?? 0) - (a.avg24h ?? 0))
            .slice(0, 30)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, q]
  )

  const top = useMemo(() => {
    const key = (i: MarketItem): number =>
      sort === 'avg'
        ? (i.avg24h ?? 0)
        : sort === 'perSlot'
          ? (i.avg24h ?? 0) / i.slots
          : sort === 'change'
            ? (i.change48hPct ?? -1e9)
            : i.offers
    return items
      .filter((i) => i.avg24h !== null)
      .filter((i) => !fleaOnly || i.onFlea)
      .filter((i) => i.offers >= minOffers)
      .filter((i) => category === 'all' || i.types.includes(category))
      .filter(matches)
      .sort((a, b) => key(b) - key(a))
      .slice(0, MAX_ROWS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sort, category, fleaOnly, minOffers, q])

  const head = (
    <thead>
      <tr>
        <th></th>
        <th>Objet</th>
        <th className="num">Prix moyen 24 h</th>
        <th className="num">Par case</th>
        <th className="num">Bas – haut 24 h</th>
        <th className="num">Variation 48 h</th>
        <th className="num">Offres</th>
      </tr>
    </thead>
  )

  const list = (rows: MarketItem[]): React.JSX.Element => (
    <table>
      {head}
      <tbody>
        {rows.map((it) => (
          <Row key={it.id} it={it} fav={favs.includes(it.id)} onToggle={() => toggleFav(it.id)} />
        ))}
      </tbody>
    </table>
  )

  return (
    <>
      <div className="topbar">
        <h2>Marché (flea)</h2>
        <span className="seg">
          <button className={view === 'favs' ? 'active' : ''} onClick={() => setView('favs')}>
            Mes favoris
          </button>
          <button className={view === 'top' ? 'active' : ''} onClick={() => setView('top')}>
            Classement
          </button>
        </span>
        <span className="spacer" />
        <span className="seg">
          <button className={mode === 'regular' ? 'active' : ''} onClick={() => setMode('regular')}>
            PvP
          </button>
          <button className={mode === 'pve' ? 'active' : ''} onClick={() => setMode('pve')}>
            PvE
          </button>
        </span>
        <button disabled={loading} onClick={() => void refresh(true)}>
          {loading ? 'Chargement…' : 'Actualiser'}
        </button>
      </div>

      {data?.error && <div className="warn">Prix indisponibles ou anciens : {data.error}</div>}
      <p className="muted">
        {data && data.fetchedAt
          ? `Prix de tarkov.dev, mis à jour à ${new Date(data.fetchedAt).toLocaleTimeString('fr-FR')}${data.fromCache ? ' (cache)' : ''}.`
          : 'Chargement des prix…'}{' '}
        Le prix par case est le prix moyen divisé par la taille de l&apos;objet : c&apos;est ce qui
        compte quand ton sac est plein.
      </p>

      <div className="topbar">
        <input
          type="search"
          placeholder="Chercher un objet…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 260 }}
        />
        {view === 'top' && (
          <>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="perSlot">Trier : prix par case</option>
              <option value="avg">Trier : prix moyen</option>
              <option value="change">Trier : variation 48 h</option>
              <option value="offers">Trier : nombre d&apos;offres</option>
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <label>
              <input
                type="checkbox"
                checked={fleaOnly}
                onChange={(e) => setFleaOnly(e.target.checked)}
              />{' '}
              Vendables sur le flea
            </label>
            <label>
              Offres min.{' '}
              <input
                type="number"
                min={0}
                value={minOffers}
                onChange={(e) => setMinOffers(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          </>
        )}
      </div>

      {view === 'favs' && (
        <>
          {q && searchResults.length > 0 && (
            <>
              <h3>Résultats de la recherche (clique sur l&apos;étoile pour ajouter)</h3>
              {list(searchResults)}
            </>
          )}
          <h3>Mes favoris ({favItems.length})</h3>
          {favItems.length === 0 ? (
            <p className="muted">
              Aucun favori. Cherche un objet ci-dessus ou dans « Classement » et clique sur ☆.
            </p>
          ) : (
            list(favItems)
          )}
        </>
      )}

      {view === 'top' && (
        <>
          <p className="muted">
            tarkov.dev n&apos;indique pas quels objets se trouvent en raid : ce classement trie le
            marché, il ne garantit pas qu&apos;on les trouve en raid. Le filtre « Objets de troc »
            est le plus proche du butin classique. {top.length} résultat{top.length > 1 ? 's' : ''}
            {top.length === MAX_ROWS ? ` (limité à ${MAX_ROWS})` : ''}.
          </p>
          {list(top)}
        </>
      )}
    </>
  )
}
