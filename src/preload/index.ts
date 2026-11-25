import { contextBridge, ipcRenderer } from 'electron'
import type { GameMode, HideoutData, Progress, UpdateState } from '../shared/types'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  getHideout: (mode: GameMode, force = false): Promise<HideoutData> =>
    ipcRenderer.invoke('hideout:get', mode, force),
  loadProgress: (mode: GameMode): Promise<Progress> => ipcRenderer.invoke('progress:load', mode),
  saveProgress: (mode: GameMode, p: Progress): Promise<void> =>
    ipcRenderer.invoke('progress:save', mode, p),
  getUpdateState: (): Promise<UpdateState> => ipcRenderer.invoke('update:get'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdate: (cb: (s: UpdateState) => void): (() => void) => {
    const handler = (_e: unknown, s: UpdateState): void => cb(s)
    ipcRenderer.on('update:changed', handler)
    return () => ipcRenderer.removeListener('update:changed', handler)
  }
}
export type Api = typeof api

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
