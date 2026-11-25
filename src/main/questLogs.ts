import { BrowserWindow, dialog, ipcMain } from 'electron'
import { execFile } from 'child_process'
import { open, readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import type { GameMode, QuestLogImport } from '../shared/types'
import {
  inferPrerequisites,
  sessionModeOf,
  parseQuestEvents,
  replayQuests,
  type KeyedQuestEvent
} from '../shared/quests'
import { getTasks } from './tasks'

/**
 * Import des quêtes depuis les logs du jeu. Lecture seule et ponctuelle : on ouvre les fichiers
 * texte que le jeu écrit déjà dans son dossier « Logs », une fois, quand l'utilisateur clique.
 * Rien n'est surveillé en continu, rien n'est écrit, et le jeu n'est ni touché ni observé.
 */

/** Un fichier de notifications dépasse rarement quelques Mo ; au-delà, ce n'est pas le bon fichier. */
const MAX_FILE_BYTES = 64 * 1024 * 1024
const NOTIFICATION_FILE = /notifications.*\.log$/i
const SESSION_DIR = /^log_/i
const INSTALL_DIRS = [
  'C:\\Battlestate Games\\Escape from Tarkov',
  'C:\\Battlestate Games\\EFT',
  'D:\\Battlestate Games\\Escape from Tarkov',
  'D:\\Battlestate Games\\EFT',
  'C:\\Program Files (x86)\\Battlestate Games\\EFT',
  'C:\\Program Files\\Battlestate Games\\EFT'
]

/** Journaux où l'adresse du serveur est écrite dès les premières lignes. */
const PROBE_FILE = /(backend|application)/i
const HEAD_BYTES = 256 * 1024
async function readHead(path: string, bytes: number): Promise<string> {
  const h = await open(path, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await h.read(buf, 0, bytes, 0)
    return buf.toString('utf-8', 0, bytesRead)
  } finally {
    await h.close()
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

/** Dossier d'installation lu dans le registre Windows (le lanceur BSG y inscrit son emplacement). */
function registryInstallDir(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null)
    execFile(
      'reg',
      [
        'query',
        'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov',
        '/v',
        'InstallLocation'
      ],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        const m = !err && /InstallLocation\s+REG_SZ\s+(.+)/i.exec(stdout)
        resolve(m ? m[1].trim() : null)
      }
    )
  })
}

/** Accepte le dossier Logs lui-même, ou le dossier du jeu qui le contient. */
async function resolveLogsDir(dir: string): Promise<string | null> {
  for (const c of [dir, join(dir, 'Logs'), join(dir, 'build', 'Logs')]) {
    if (!(await isDir(c))) continue
    try {
      if ((await readdir(c)).some((n) => SESSION_DIR.test(n))) return c
    } catch {
      /* dossier illisible : on essaie le suivant */
    }
  }
  return null
}

async function findLogsDir(): Promise<string | null> {
  const reg = await registryInstallDir()
  for (const base of [...(reg ? [reg] : []), ...INSTALL_DIRS]) {
    const found = await resolveLogsDir(base)
    if (found) return found
  }
  return null
}

const fail = (dir: string, error: string): QuestLogImport => ({
  ok: false,
  error,
  dir,
  files: 0,
  totalEvents: 0,
  otherMode: 0,
  otherModes: [],
  wipes: 0,
  events: 0,
  since: null,
  until: null,
  quests: {},
  inferred: [],
  unknown: 0
})

async function importQuests(mode: GameMode, choose: boolean): Promise<QuestLogImport> {
  let dir: string | null
  if (choose) {
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      title: 'Choisis le dossier du jeu ou son dossier « Logs »',
      properties: ['openDirectory' as const]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return { ...fail('', ''), canceled: true }
    dir = await resolveLogsDir(res.filePaths[0])
    if (!dir)
      return fail(
        res.filePaths[0],
        'Ce dossier ne contient pas de logs du jeu (dossiers « log_… »).'
      )
  } else {
    dir = await findLogsDir()
    if (!dir) return fail('', 'Dossier de logs introuvable : choisis-le à la main.')
  }

  // Un message peut apparaître dans deux fichiers : on dédoublonne par identifiant de message.
  const events = new Map<string, KeyedQuestEvent>()
  const other = new Set<string>()
  const otherModes = new Set<GameMode>()
  let files = 0
  const sessions = (await readdir(dir)).filter((n) => SESSION_DIR.test(n)).sort()
  for (const s of sessions) {
    const sdir = join(dir, s)
    let all: string[]
    try {
      all = await readdir(sdir)
    } catch {
      continue
    }
    const found: KeyedQuestEvent[] = []
    let sessionMode: GameMode | null = null
    for (const n of all.filter((n) => NOTIFICATION_FILE.test(n))) {
      const path = join(sdir, n)
      try {
        const st = await stat(path)
        if (st.size < 100 || st.size > MAX_FILE_BYTES) continue
        const text = await readFile(path, 'utf-8') // ouverture en lecture seule
        files++
        found.push(...parseQuestEvents(text))
        sessionMode ??= sessionModeOf(text)
      } catch {
        /* fichier verrouillé ou disparu : on passe au suivant */
      }
    }
    if (!found.length) continue
    // Pas d'adresse de serveur dans les notifications : on la cherche au début des autres journaux
    for (const n of sessionMode ? [] : all.filter((n) => PROBE_FILE.test(n))) {
      try {
        sessionMode = sessionModeOf(await readHead(join(sdir, n), HEAD_BYTES))
      } catch {
        /* illisible : on passe au suivant */
      }
      if (sessionMode) break
    }
    for (const e of found) {
      if (sessionMode === mode) events.set(e.key, e)
      else other.add(e.key)
    }
    if (sessionMode && sessionMode !== mode) otherModes.add(sessionMode)
  }
  if (!events.size)
    return {
      ...fail(
        dir,
        other.size
          ? `Aucun message de quête pour le mode ${mode === 'pve' ? 'PvE' : 'PvP'} : les logs en contiennent ${other.size} pour l'autre mode (ou d'une session dont le mode est inconnu). Change de mode en haut de la page.`
          : 'Aucun message de quête trouvé dans ces logs.'
      ),
      files,
      otherMode: other.size,
      otherModes: [...otherModes]
    }

  const tasks = await getTasks(mode)
  const restartable = new Set(tasks.tasks.filter((t) => t.restartable).map((t) => t.id))
  const replay = replayQuests([...events.values()], restartable)
  const { quests, inferred } = inferPrerequisites(replay.quests, tasks.tasks)
  const known = new Set(tasks.tasks.map((t) => t.id))
  const unknown = tasks.tasks.length
    ? Object.keys(replay.quests).filter((id) => !known.has(id)).length
    : 0
  return {
    ok: true,
    dir,
    files,
    totalEvents: events.size,
    otherMode: other.size,
    otherModes: [...otherModes],
    wipes: replay.wipes,
    events: replay.events,
    since: replay.since,
    until: replay.until,
    quests,
    inferred,
    unknown
  }
}

export function initQuestLogs(): void {
  ipcMain.handle('tasks:get', (_e, mode: GameMode, force?: boolean) => getTasks(mode, !!force))
  ipcMain.handle('quests:import-logs', (_e, mode: GameMode, choose?: boolean) =>
    importQuests(mode, !!choose).catch((e: unknown) =>
      fail('', e instanceof Error ? e.message : String(e))
    )
  )
}
