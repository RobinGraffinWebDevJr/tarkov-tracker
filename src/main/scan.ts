import { app, BrowserWindow, desktopCapturer, ipcMain, screen, shell } from 'electron'
import { appendFile, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { ScanStatus, SearchScan } from '../shared/types'
import { PageCollector } from './pageCollector'
import { findSearchWindow, SUPPORTED_HEIGHT, SUPPORTED_WIDTH, type Bitmap } from './searchWindow'

/**
 * Session de scan : capture de la fenêtre du jeu en boucle (lecture d'écran passive, comme un
 * outil de capture : rien n'est injecté dans le jeu). Cette version ne fait que capturer et
 * enregistrer les images, pour calibrer la reconnaissance sur de vraies images.
 *
 * Deux modes :
 * - vue quelconque : on enregistre les images qui changent (toutes les 1,5 s) ;
 * - fenêtre « Recherche d'objet » visible : on lit la pagination et on enregistre UNE image par
 *   page, dès qu'elle est stable, même si tu tournes les pages vite. La boucle passe alors à 350 ms.
 */
const INTERVAL_MS = 1500
/** Cadence quand la fenêtre « Recherche d'objet » est ouverte : assez rapide pour ne pas rater une page. */
const FAST_MS = 350
/** Plafond d'images enregistrées par session (une capture 1080p en PNG pèse environ 3 Mo). */
const MAX_SAVED = 150
const GAME_TITLE = /escape\s*from\s*tarkov/i
/** Différence moyenne (0-255) sous laquelle deux vues sont considérées identiques. */
const CHANGE_THRESHOLD = 6
/** Intervalle minimal entre deux aperçus envoyés à l'interface (l'encodage coûte, la boucle est rapide). */
const PREVIEW_EVERY_MS = 1200
/** Lignes du journal gardées pour l'interface (tout est écrit dans scan.log). */
const LOG_KEEP = 40

const idleSearch = (): SearchScan => ({ active: false, pages: [], current: null, missing: [] })

const idle = (): ScanStatus => ({
  running: false,
  found: false,
  width: 0,
  height: 0,
  frames: 0,
  saved: 0,
  black: false,
  dir: '',
  message: '',
  preview: null,
  search: idleSearch(),
  log: []
})

let status = idle()
let timer: NodeJS.Timeout | null = null
let lastSig: Buffer | null = null

// État de la lecture de la recherche d'objet
let searchHint: { closeX: number; closeY: number } | null = null
const collector = new PageCollector()
let lastPreviewAt = 0

// Pour ne journaliser que les changements, pas chaque capture
let prevFound: boolean | null = null
let prevSearchActive = false
let prevLoggedPage: number | null | undefined
let prevUnsupported = false

/**
 * Journal de la session : visible dans l'écran de scan et écrit dans scan.log (dossier de la
 * session). Il permet de savoir après coup ce que le scan a vu, sans devoir regarder l'écran.
 */
function note(text: string): void {
  const line = `${new Date().toLocaleTimeString('fr-FR')}  ${text}`
  status = { ...status, log: [...status.log, line].slice(-LOG_KEEP) }
  if (status.dir) void appendFile(join(status.dir, 'scan.log'), line + '\n').catch(() => undefined)
}

function emit(patch: Partial<ScanStatus>): void {
  status = { ...status, ...patch }
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('scan:changed', status)
}

async function writePagesIndex(): Promise<void> {
  await writeFile(
    join(status.dir, 'pages.json'),
    JSON.stringify({ pages: collector.index() }, null, 2)
  )
}

async function tick(): Promise<void> {
  if (!status.running) return
  let fast = false
  try {
    // La fenêtre du jeu est en général aussi grande que l'écran (sans bordure) : on demande
    // la miniature à la taille physique du plus grand écran pour rester en résolution native.
    const d = screen.getAllDisplays().sort((a, b) => b.size.width - a.size.width)[0]
    const size = {
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor)
    }
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size })
    const src = sources.find((s) => GAME_TITLE.test(s.name))
    if (!src) {
      if (prevFound !== false)
        note('Fenêtre du jeu introuvable (Tarkov doit être lancé en fenêtré sans bordure).')
      prevFound = false
      emit({
        found: false,
        search: collector.summary(false, null),
        message: 'Fenêtre du jeu introuvable. Lance Tarkov en fenêtré sans bordure.'
      })
    } else {
      const img = src.thumbnail
      const { width, height } = img.getSize()
      if (width === 0 || height === 0) {
        emit({ found: true, message: 'Fenêtre du jeu réduite : affiche-la à l’écran.' })
      } else {
        if (prevFound !== true) note(`Fenêtre du jeu trouvée (${width}×${height}).`)
        prevFound = true
        const frames = status.frames + 1
        let saved = status.saved
        let message = ''
        let black = false
        let search = status.search

        const supported = width === SUPPORTED_WIDTH && height === SUPPORTED_HEIGHT
        if (!supported && !prevUnsupported)
          note(
            `Résolution ${width}×${height} : la lecture de la recherche d'objet demande du 1920×1080.`
          )
        prevUnsupported = !supported
        const bmp: Bitmap | null = supported ? { width, height, data: img.toBitmap() } : null
        const win = bmp ? findSearchWindow(bmp, searchHint) : null
        searchHint = win ? { closeX: win.closeX, closeY: win.closeY } : null
        if (win && !prevSearchActive)
          note(`Recherche d'objet détectée (grille en ${win.gx},${win.gy}) : une image par page.`)
        if (!win && prevSearchActive) note("Recherche d'objet fermée ou masquée.")
        prevSearchActive = !!win

        if (bmp && win) {
          // --- fenêtre « Recherche d'objet » : une image par page ---
          fast = true
          const obs = collector.observe(bmp, win, saved < MAX_SAVED)
          if (obs.plan) {
            await writeFile(join(status.dir, obs.plan.file), img.toPNG())
            obs.plan.commit()
            if (obs.plan.isNew) saved++
            await writePagesIndex()
          } else if (obs.indexChanged) {
            await writePagesIndex()
          }
          if (obs.kind === 'saved')
            note(`Page ${obs.current ?? '?'} enregistrée (${obs.plan?.file}).`)
          else if (obs.kind === 'replaced')
            note(
              `Page ${obs.current ?? '?'} : le contenu a changé, image remplacée (${obs.plan?.file}).`
            )
          else if (obs.current !== prevLoggedPage) {
            if (obs.current === null)
              note('Numéro de page illisible : la page sera repérée par son contenu.')
            else if (obs.kind === 'seen') note(`Page ${obs.current} déjà enregistrée.`)
            else if (obs.kind === 'limit')
              note(`Limite de ${MAX_SAVED} images atteinte : plus rien n'est enregistré.`)
          }
          if (obs.kind !== 'waiting') prevLoggedPage = obs.current
          search = collector.summary(true, obs.current)
          message =
            saved >= MAX_SAVED
              ? `Limite de ${MAX_SAVED} images enregistrées atteinte.`
              : `Recherche d’objet détectée. Tourne les pages une par une, environ 1 seconde chacune.${
                  search.missing.length ? ` Pages à voir : ${search.missing.join(', ')}.` : ''
                }`
        } else {
          // --- toute autre vue : on enregistre les images qui changent ---
          if (status.search.active) search = collector.summary(false, null)
          collector.lost()
          const sig = img.resize({ width: 32, height: 18 }).toBitmap()
          let sum = 0
          for (let i = 0; i < sig.length; i++) sum += sig[i]
          black = sum / sig.length < 4
          let diff = 255
          if (lastSig && lastSig.length === sig.length) {
            diff = 0
            for (let i = 0; i < sig.length; i++) diff += Math.abs(sig[i] - lastSig[i])
            diff /= sig.length
          }
          if (!black && diff > CHANGE_THRESHOLD && saved < MAX_SAVED) {
            await writeFile(
              join(status.dir, `frame-${String(frames).padStart(4, '0')}.png`),
              img.toPNG()
            )
            saved++
            lastSig = sig
            note(`Image enregistrée (frame-${String(frames).padStart(4, '0')}).`)
          }
          message = black
            ? 'Image noire : passe le jeu en fenêtré sans bordure (le plein écran exclusif ne se capture pas).'
            : saved >= MAX_SAVED
              ? `Limite de ${MAX_SAVED} images enregistrées atteinte.`
              : !supported
                ? `Résolution ${width}×${height} : la lecture de la recherche d’objet demande du 1920×1080.`
                : ''
        }

        const now = Date.now()
        const patch: Partial<ScanStatus> = {
          found: true,
          width,
          height,
          frames,
          saved,
          black,
          message,
          search
        }
        if (!fast || now - lastPreviewAt >= PREVIEW_EVERY_MS) {
          patch.preview = img.resize({ width: 640 }).toDataURL()
          lastPreviewAt = now
        }
        emit(patch)
      }
    }
  } catch (e) {
    emit({ message: e instanceof Error ? e.message : String(e) })
  }
  if (status.running) timer = setTimeout(() => void tick(), fast ? FAST_MS : INTERVAL_MS)
}

async function start(): Promise<void> {
  if (status.running) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = join(app.getPath('documents'), 'Tarkov Tracker', 'scans', stamp)
  await mkdir(dir, { recursive: true })
  lastSig = null
  searchHint = null
  collector.reset()
  lastPreviewAt = 0
  prevFound = null
  prevSearchActive = false
  prevLoggedPage = undefined
  prevUnsupported = false
  status = { ...idle(), running: true, dir, message: 'Recherche de la fenêtre du jeu…' }
  note('Session démarrée.')
  emit({})
  void tick()
}

function stop(): void {
  if (timer) clearTimeout(timer)
  timer = null
  const sum = collector.summary(false, null)
  note(
    `Session terminée : ${status.saved} image(s) enregistrée(s), ${status.frames} capture(s). Pages : ${
      sum.pages.length ? sum.pages.map((p) => p.page ?? '?').join(', ') : 'aucune'
    }${sum.missing.length ? `. Pages à voir : ${sum.missing.join(', ')}` : ''}.`
  )
  emit({ running: false, message: '' })
}

export function initScan(): void {
  ipcMain.handle('scan:get', () => status)
  ipcMain.handle('scan:start', () => start())
  ipcMain.handle('scan:stop', () => stop())
  ipcMain.handle('scan:open-dir', async () => {
    const dir = status.dir || join(app.getPath('documents'), 'Tarkov Tracker', 'scans')
    await mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })
}
