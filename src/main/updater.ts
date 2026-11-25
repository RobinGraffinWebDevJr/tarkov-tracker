import { app, BrowserWindow, ipcMain } from 'electron'
import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { rename, rm } from 'fs/promises'
import { spawn } from 'child_process'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { UpdateState } from '../shared/types'

/**
 * Mise à jour depuis les Releases GitHub (même principe que poe2-tracker) :
 * vérification au lancement puis toutes les 5 minutes, téléchargement SEULEMENT sur clic,
 * contrôle de l'empreinte SHA-256 publiée avec la release, remplacement de l'exe puis relance.
 * Actif uniquement pour l'exe portable Windows (variable PORTABLE_EXECUTABLE_FILE posée par
 * electron-builder) ; en développement, rien ne se passe.
 */
const REPO = 'RobinGraffinWebDevJr/tarkov-tracker'
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`
const ASSET = 'tarkov-tracker-windows-x64.exe'
/** Bien sous la limite de l'API GitHub sans compte (60 requêtes par heure). */
const EVERY_MS = 5 * 60 * 1000
const USER_AGENT = `tarkov-tracker/${app.getVersion()}`

interface Release {
  tag_name: string
  assets: { name: string; browser_download_url: string }[]
}

let state: UpdateState = { kind: 'disabled', version: app.getVersion() }
let pending: { latest: string; exeUrl: string; shaUrl: string } | null = null

const exePath = (): string | undefined => process.env['PORTABLE_EXECUTABLE_FILE']

function set(next: UpdateState): void {
  state = next
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:changed', state)
}

/** Compare « 0.1.10 » et « 0.1.2 » numériquement. */
function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number)
  const b = current.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

async function check(): Promise<void> {
  if (state.kind === 'downloading') return
  try {
    const res = await fetch(LATEST, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) throw new Error(`GitHub : HTTP ${res.status}`)
    const rel = (await res.json()) as Release
    const latest = rel.tag_name.replace(/^v/, '')
    const exe = rel.assets.find((a) => a.name === ASSET)
    const sha = rel.assets.find((a) => a.name === `${ASSET}.sha256`)
    if (!isNewer(latest, app.getVersion()) || !exe || !sha) {
      set({ kind: 'up-to-date', version: app.getVersion() })
      return
    }
    pending = { latest, exeUrl: exe.browser_download_url, shaUrl: sha.browser_download_url }
    set({ kind: 'available', version: app.getVersion(), latest })
  } catch {
    // Hors ligne ou limite GitHub : on garde l'état précédent, on réessaiera dans 5 minutes.
  }
}

async function install(): Promise<void> {
  const target = exePath()
  if (!pending || !target || state.kind !== 'available') return
  const { latest, exeUrl, shaUrl } = pending
  const staged = `${target}.new`
  const old = `${target}.old`
  try {
    set({ kind: 'downloading', version: app.getVersion(), latest })

    const shaText = await (await fetch(shaUrl, { headers: { 'User-Agent': USER_AGENT } })).text()
    const expected = shaText.trim().split(/\s+/)[0]?.toLowerCase()
    if (!expected || !/^[0-9a-f]{64}$/.test(expected)) throw new Error('empreinte SHA-256 illisible')

    const res = await fetch(exeUrl, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok || !res.body) throw new Error(`téléchargement : HTTP ${res.status}`)
    const hash = createHash('sha256')
    const out = createWriteStream(staged)
    const source = Readable.fromWeb(res.body as never)
    source.on('data', (chunk: Buffer) => hash.update(chunk))
    await pipeline(source, out)
    if (hash.digest('hex') !== expected) throw new Error('empreinte SHA-256 incorrecte, mise à jour refusée')

    // Windows interdit de supprimer un exe en cours d'exécution mais pas de le renommer.
    await rm(old, { force: true })
    await rename(target, old)
    await rename(staged, target)

    spawn(target, [], { detached: true, stdio: 'ignore' }).unref()
    app.quit()
  } catch (e) {
    await rm(staged, { force: true }).catch(() => undefined)
    set({ kind: 'failed', version: app.getVersion(), message: e instanceof Error ? e.message : String(e) })
  }
}

export function initUpdater(): void {
  ipcMain.handle('update:get', () => state)
  ipcMain.handle('update:install', () => install())

  const target = exePath()
  if (!app.isPackaged || process.platform !== 'win32' || !target) return
  // Reste de la mise à jour précédente (l'ancien exe, renommé avant le remplacement)
  void rm(`${target}.old`, { force: true }).catch(() => undefined)
  set({ kind: 'up-to-date', version: app.getVersion() })
  void check()
  setInterval(() => void check(), EVERY_MS)
}
