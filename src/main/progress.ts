import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { emptyProgress, type GameMode, type Progress } from '../shared/types'

const progressPath = (mode: GameMode): string =>
  join(app.getPath('userData'), `progress-${mode}.json`)

export async function loadProgress(mode: GameMode): Promise<Progress> {
  try {
    return { ...emptyProgress(), ...JSON.parse(await readFile(progressPath(mode), 'utf-8')) }
  } catch {
    return emptyProgress()
  }
}

export async function saveProgress(mode: GameMode, p: Progress): Promise<void> {
  await writeFile(progressPath(mode), JSON.stringify(p, null, 2))
}
