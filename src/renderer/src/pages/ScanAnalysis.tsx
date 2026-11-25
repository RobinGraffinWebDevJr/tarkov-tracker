import { useEffect, useMemo, useState } from 'react'
import { margin, type Judgement } from '../../../shared/decision'
import type { CatalogEntry } from '../../../shared/types'
import {
  NONE,
  refreshMode,
  saveInventory,
  setChoices,
  setMode,
  startAnalysis,
  useAnalysis,
  type Row
} from '../recognition/analysisStore'
import type { RecognitionEngine } from '../recognition/engine'

const tier = (j: Judgement): { label: string; color: string } =>
  j.level === 'sure'
    ? { label: 'sûr', color: '#5fbf6a' }
    : j.level === 'probable'
      ? { label: 'probable', color: '#e0b050' }
      : { label: 'à vérifier', color: '#e06666' }

/** Les cases qui montrent le même objet (même taille, même meilleur candidat) se confirment en une fois. */
const groupRows = (list: Row[]): Row[][] => [
  ...list
    .reduce((m, r) => {
      const k = `${r.cell.w}x${r.cell.h}:${r.res.candidates[0].id}`
      m.set(k, [...(m.get(k) ?? []), r])
      return m
    }, new Map<string, Row[]>())
    .values()
]

const readsText = (reads: string[]): string => {
  const seen = [...new Set(reads.map((r) => r.trim()).filter(Boolean))]
  return seen.length ? seen.map((s) => `« ${s} »`).join(' ') : 'illisible'
}

function RowsTable({
  list,
  eng,
  choice,
  needs,
  catalog
}: {
  list: Row[]
  eng: RecognitionEngine
  choice: Record<string, string>
  needs: Map<string, string[]>
  catalog: Map<string, CatalogEntry>
}): React.JSX.Element {
  const groups = groupRows(list)
  return (
    <table>
      <thead>
        <tr>
          <th>Capture</th>
          <th>Reconnu comme</th>
          <th>Utile pour</th>
          <th>Confiance</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => {
          const r = g[0]
          const cur = choice[r.key] ?? NONE
          const t = tier(r.j)
          return (
            <tr key={r.key}>
              <td>
                <img
                  src={eng.crop(r.a, r.cell)}
                  alt=""
                  style={{ imageRendering: 'auto', border: '1px solid var(--border)' }}
                />
                <div className="stations">
                  {g.length > 1 && <strong>{g.length} cases identiques · </strong>}
                  page {r.a.page.page ?? '?'} · {r.cell.row + 1},{r.cell.col + 1}
                  {g.length > 1 &&
                    ` et ${g
                      .slice(1, 4)
                      .map((x) => `p.${x.a.page.page ?? '?'} ${x.cell.row + 1},${x.cell.col + 1}`)
                      .join(', ')}${g.length > 4 ? '…' : ''}`}
                </div>
              </td>
              <td>
                <select
                  value={cur}
                  onChange={(e) =>
                    setChoices(
                      g.map((x) => x.key),
                      e.target.value
                    )
                  }
                >
                  <option value={NONE}>Ne pas compter</option>
                  {r.res.candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.shortName} ({c.score > 0 ? `${Math.round(c.score * 100)} %` : 'nom lu'})
                      {needs.has(c.id) ? ' ★' : ''}
                    </option>
                  ))}
                </select>
                {cur !== NONE && catalog.get(cur)?.name && (
                  <div className="stations">{catalog.get(cur)?.name}</div>
                )}
              </td>
              <td className="stations">
                {(needs.get(cur) ?? needs.get(r.res.candidates[0].id) ?? []).join(', ')}
              </td>
              <td style={{ color: t.color }}>
                {t.label} : {r.j.why}
                <div className="stations">
                  nom lu {readsText(r.reads)} · icône {Math.round(r.cell.score * 100)} %, écart{' '}
                  {Math.round(margin(r.cell) * 100)}
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function ScanAnalysis(): React.JSX.Element {
  // L'analyse vit dans analysisStore : elle continue si on change d'onglet, et on la retrouve en revenant
  const a = useAnalysis()
  const { mode, busy, step, error, nameWarning, dogtags, rows, catalog, needs, choice, eng } = a
  const [showSure, setShowSure] = useState(false)
  const [copied, setCopied] = useState('')

  useEffect(() => refreshMode(), [])

  // Une case est « utile » si un objet recherché figure parmi ses candidats ; un nom lu qui ne
  // ressemble à aucun candidat l'écarte (c'est autre chose).
  const useful = useMemo(
    () => rows.filter((r) => r.u > 0).sort((x, y) => y.u - x.u || y.cell.score - x.cell.score),
    [rows]
  )
  const usefulKeys = useMemo(() => new Set(useful.map((r) => r.key)), [useful])
  const toCheck = useMemo(() => useful.filter((r) => !r.j.reliable), [useful])
  const sure = useMemo(() => useful.filter((r) => r.j.reliable), [useful])
  const others = useMemo(() => rows.filter((r) => !usefulKeys.has(r.key)), [rows, usefulKeys])

  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const r of rows) {
      const id = choice[r.key]
      if (id && id !== NONE) c.set(id, (c.get(id) ?? 0) + 1)
    }
    return c
  }, [rows, choice])

  const stackables = useMemo(
    () => [...counts.keys()].filter((id) => (catalog.get(id)?.stack ?? 1) > 1),
    [counts, catalog]
  )

  /** Outil de mise au point (mode développement) : la liste à confirmer en texte, à coller dans une conversation. */
  const copyList = async (): Promise<void> => {
    const pc = (x: number): string => String(Math.round(x * 100))
    const groups = groupRows(toCheck)
    const verdicts = rows.reduce<Record<string, number>>((m, r) => {
      m[r.res.verdict] = (m[r.res.verdict] ?? 0) + 1
      return m
    }, {})
    const out = [
      `Analyse : ${rows.length} cases, ${rows.filter((r) => r.j.reliable).length} fiables, ${toCheck.length} utiles à confirmer (${groups.length} groupes), ${sure.length} utiles fiables, ${needs.size} objets utiles recherchés`,
      `Noms : ${JSON.stringify(verdicts)}`,
      a.timings,
      ''
    ]
    groups.forEach((g, i) => {
      const r = g[0]
      const pos = g
        .map((x) => `p${x.a.page.page ?? '?'}(${x.cell.row + 1},${x.cell.col + 1})`)
        .join(' ')
      out.push(
        `#${i + 1} x${g.length} ${r.cell.w}x${r.cell.h} ${pos} | ${r.res.verdict} : ${r.j.why} | nom lu ${readsText(r.reads)} | icône ${pc(r.cell.score)} écart ${pc(margin(r.cell))}`
      )
      r.res.candidates.forEach((k, j) => {
        const why = needs.get(k.id)
        out.push(
          `   ${j + 1}. ${k.shortName} | ${k.name} | ${k.score > 0 ? `${pc(k.score)} %` : 'nom lu'}${why ? ` ★ ${why.slice(0, 2).join(' ; ')}` : ''}`
        )
      })
    })
    out.push('', 'Reconnus avec certitude :')
    const tally = new Map<string, number>()
    for (const r of sure) tally.set(choice[r.key], (tally.get(choice[r.key]) ?? 0) + 1)
    for (const [id, n] of tally)
      if (id !== NONE)
        out.push(`  ${n}x ${catalog.get(id)?.shortName ?? id} | ${catalog.get(id)?.name ?? ''}`)
    try {
      await navigator.clipboard.writeText(out.join('\n'))
      setCopied(
        `Copié : ${groups.length} groupes, ${out.length} lignes. Colle-le dans la conversation.`
      )
    } catch (e) {
      setCopied(`Copie impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const usefulFound = [...needs.keys()].filter((id) => counts.has(id)).length

  return (
    <>
      <h3>Reconnaissance des objets (test)</h3>
      <div className="topbar">
        <span className="seg">
          <button
            className={mode === 'regular' ? 'active' : ''}
            disabled={busy}
            onClick={() => setMode('regular')}
          >
            PvP
          </button>
          <button
            className={mode === 'pve' ? 'active' : ''}
            disabled={busy}
            onClick={() => setMode('pve')}
          >
            PvE
          </button>
        </span>
        <button className="active" disabled={busy} onClick={() => void startAnalysis()}>
          {busy ? 'Analyse en cours…' : 'Analyser le dernier scan'}
        </button>
        {step && (
          <span className="muted">
            {step.label} {step.done}/{step.total}
          </span>
        )}
      </div>
      <p className="muted">
        Compare chaque case de tes pages enregistrées aux images de tous les objets du jeu (le
        premier lancement télécharge environ 5 500 petites images, ensuite elles sont en cache), et
        lit le nom écrit sur la case avec l&apos;OCR de Windows pour confirmer l&apos;objet.
        L&apos;analyse continue si tu changes d&apos;onglet. Seules les reconnaissances fiables sont
        comptées d&apos;office ; les objets utiles à ta planque et à tes quêtes dont la
        reconnaissance est douteuse sont à confirmer ci-dessous.
      </p>
      {error && <div className="warn">{error}</div>}
      {nameWarning && <div className="warn">{nameWarning}</div>}
      {a.timings && !busy && <p className="muted">{a.timings}</p>}

      {rows.length > 0 && eng && (
        <>
          <div className="cards">
            <div className="card">
              <div className="label">Cases reconnues</div>
              <div className="value">{rows.length}</div>
            </div>
            <div className="card">
              <div className="label">Dogtags écartés</div>
              <div className="value">{dogtags}</div>
            </div>
            <div className="card">
              <div className="label">Objets utiles trouvés</div>
              <div className="value">
                {usefulFound} / {needs.size}
              </div>
            </div>
            <div className="card">
              <div className="label">À vérifier (utiles)</div>
              <div className="value">{toCheck.length}</div>
            </div>
          </div>

          {import.meta.env.DEV && (
            <div className="topbar">
              <button onClick={() => void copyList()}>Copier la liste à confirmer (dev)</button>
              {copied && <span className="muted">{copied}</span>}
            </div>
          )}

          <h4>
            À confirmer : objets utiles dont la reconnaissance est douteuse ({toCheck.length})
          </h4>
          <p className="muted">
            Ces cases ne sont pas comptées tant que tu n&apos;as pas choisi l&apos;objet. Les
            candidats marqués ★ servent à ta planque ou à tes quêtes.
          </p>
          {toCheck.length === 0 ? (
            <p className="muted">Rien à confirmer.</p>
          ) : (
            <RowsTable list={toCheck} eng={eng} choice={choice} needs={needs} catalog={catalog} />
          )}

          <h4>Reconnus avec certitude ({sure.length} cases)</h4>
          <div className="chips">
            {[
              ...sure.reduce(
                (m, r) => m.set(choice[r.key], (m.get(choice[r.key]) ?? 0) + 1),
                new Map<string, number>()
              )
            ]
              .filter(([id]) => id && id !== NONE)
              .map(([id, n]) => (
                <span key={id} className="chip">
                  {n}× {catalog.get(id)?.shortName ?? id}
                </span>
              ))}
          </div>
          <button style={{ marginTop: 8 }} onClick={() => setShowSure(!showSure)}>
            {showSure ? 'Masquer le détail' : 'Voir et modifier le détail'}
          </button>
          {showSure && (
            <RowsTable list={sure} eng={eng} choice={choice} needs={needs} catalog={catalog} />
          )}

          <p className="muted" style={{ marginTop: 14 }}>
            Autres cases (objets qui ne servent ni à la planque ni aux quêtes en cours) :{' '}
            {others.filter((r) => r.j.reliable).length} comptées car la reconnaissance est fiable,{' '}
            {others.filter((r) => !r.j.reliable).length} laissées de côté.
            {stackables.length > 0 &&
              ` ${stackables.length} objets empilables (munitions, argent…) ne sont pas comptés : leur quantité n'est pas encore lue, ce qui était saisi est conservé.`}
          </p>
          <div className="topbar">
            <button className="active" onClick={() => void saveInventory()}>
              Enregistrer dans l&apos;inventaire
            </button>
            {a.saved && <span style={{ color: '#5fbf6a' }}>{a.saved}</span>}
          </div>
        </>
      )}
    </>
  )
}
