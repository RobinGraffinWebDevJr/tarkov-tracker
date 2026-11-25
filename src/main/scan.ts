import { app, BrowserWindow, desktopCapturer, ipcMain, screen, shell } from 'electron'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { ScanStatus } from '../shared/types'

/**
 * Session de scan : capture de la fenêtre du jeu en boucle (lecture d'écran passive, comme un
 * outil de capture : rien n'est injecté dans le jeu). Cette version ne fait que capturer et
 * enregistrer les images qui changent, pour calibrer la reconnaissance sur de vraies images.
 */
const INTERVAL_MS = 1500
/** Plafond d'images enregistrées par session (une capture 1080p en PNG pèse environ 3 Mo). */
const MAX_SAVED = 150
const GAME_TITLE = /escape\s*from\s*tarkov/i
/** Différence moyenne (0-255) sous laquelle deux vues sont considérées identiques. */
const CHANGE_THRESHOLD = 6

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
  preview: null
})

let status = idle()
let timer: NodeJS.Timeout | null = null
let lastSig: Buffer | null = null

function emit(patch: Partial<ScanStatus>): void {
  status = { ...status, ...patch }
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('scan:changed', status)
}

async function tick(): Promise<void> {
  if (!status.running) return
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
      emit({ found: false, message: 'Fenêtre du jeu introuvable. Lance Tarkov en fenêtré sans bordure.' })
    } else {
      const img = src.thumbnail
      const { width, height } = img.getSize()
      if (width === 0 || height === 0) {
        emit({ found: true, message: 'Fenêtre du jeu réduite : affiche-la à l’écran.' })
      } else {
        const sig = img.resize({ width: 32, height: 18 }).toBitmap()
        let sum = 0
        for (let i = 0; i < sig.length; i++) sum += sig[i]
        const black = sum / sig.length < 4
        let diff = 255
        if (lastSig && lastSig.length === sig.length) {
          diff = 0
          for (let i = 0; i < sig.length; i++) diff += Math.abs(sig[i] - lastSig[i])
          diff /= sig.length
        }
        const frames = status.frames + 1
        let saved = status.saved
        if (!black && diff > CHANGE_THRESHOLD && saved < MAX_SAVED) {
          await writeFile(join(status.dir, `frame-${String(frames).padStart(4, '0')}.png`), img.toPNG())
          saved++
          lastSig = sig
        }
        emit({
          found: true,
          width,
          height,
          frames,
          saved,
          black,
          preview: img.resize({ width: 640 }).toDataURL(),
          message: black
            ? 'Image noire : passe le jeu en fenêtré sans bordure (le plein écran exclusif ne se capture pas).'
            : saved >= MAX_SAVED
              ? `Limite de ${MAX_SAVED} images enregistrées atteinte.`
              : ''
        })
      }
    }
  } catch (e) {
    emit({ message: e instanceof Error ? e.message : String(e) })
  }
  if (status.running) timer = setTimeout(() => void tick(), INTERVAL_MS)
}

async function start(): Promise<void> {
  if (status.running) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = join(app.getPath('documents'), 'Tarkov Tracker', 'scans', stamp)
  await mkdir(dir, { recursive: true })
  lastSig = null
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
