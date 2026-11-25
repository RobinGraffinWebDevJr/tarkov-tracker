import { app, BrowserWindow, desktopCapturer, ipcMain, screen, shell } from 'electron'
import { mkdir, writeFile } from 'fs/promises'
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
  search: idleSearch()
})

let status = idle()
let timer: NodeJS.Timeout | null = null
let lastSig: Buffer | null = null

// État de la lecture de la recherche d'objet
let searchHint: { closeX: number; closeY: number } | null = null
const collector = new PageCollector()
let lastPreviewAt = 0

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
        const frames = status.frames + 1
        let saved = status.saved
        let message = ''
        let black = false
        let search = status.search

        const supported = width === SUPPORTED_WIDTH && height === SUPPORTED_HEIGHT
        const bmp: Bitmap | null = supported ? { width, height, data: img.toBitmap() } : null
        const win = bmp ? findSearchWindow(bmp, searchHint) : null
        searchHint = win ? { closeX: win.closeX, closeY: win.closeY } : null

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
  status = { ...idle(), running: true, dir, message: 'Recherche de la fenêtre du jeu…' }
  emit({})
  void tick()
}

function stop(): void {
  if (timer) clearTimeout(timer)
  timer = null
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
