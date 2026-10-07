import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type HemisphereApi } from '@shared/ipc'
import type { ServerStatus } from '@shared/server'

const api: HemisphereApi = {
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.windowToggleMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
    onMaximizedChange: (cb) => {
      const listener = (_e: unknown, maximized: boolean): void => cb(maximized)
      ipcRenderer.on(IPC.windowMaximizedChanged, listener)
      return () => ipcRenderer.removeListener(IPC.windowMaximizedChanged, listener)
    },
  },
  openLink: (key) => ipcRenderer.send(IPC.openLink, key),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  server: {
    getStatus: () => ipcRenderer.invoke(IPC.serverStatusGet),
    onStatus: (cb) => {
      const listener = (_e: unknown, status: ServerStatus): void => cb(status)
      ipcRenderer.on(IPC.serverStatusUpdate, listener)
      return () => ipcRenderer.removeListener(IPC.serverStatusUpdate, listener)
    },
  },
  playtime: {
    get: () => ipcRenderer.invoke(IPC.playtimeGet),
  },
}

contextBridge.exposeInMainWorld('hemisphere', api)
