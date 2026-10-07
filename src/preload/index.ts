import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type HemisphereApi } from '@shared/ipc'
import type { ServerStatus } from '@shared/server'
import type { AccountsState } from '@shared/auth'
import type { GameState } from '@shared/game'

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
  auth: {
    getState: () => ipcRenderer.invoke(IPC.authState),
    onChange: (cb) => {
      const listener = (_e: unknown, state: AccountsState): void => cb(state)
      ipcRenderer.on(IPC.authChanged, listener)
      return () => ipcRenderer.removeListener(IPC.authChanged, listener)
    },
    signIn: (language) => ipcRenderer.invoke(IPC.authSignIn, language),
    cancel: () => ipcRenderer.send(IPC.authCancel),
    switchTo: (id) => ipcRenderer.invoke(IPC.authSwitch, id),
    signOut: (id) => ipcRenderer.invoke(IPC.authSignOut, id),
    addDevOffline: (name) => ipcRenderer.invoke(IPC.authDevOffline, name),
  },
  game: {
    getState: () => ipcRenderer.invoke(IPC.gameState),
    onState: (cb) => {
      const listener = (_e: unknown, state: GameState): void => cb(state)
      ipcRenderer.on(IPC.gameStateChanged, listener)
      return () => ipcRenderer.removeListener(IPC.gameStateChanged, listener)
    },
    play: () => ipcRenderer.send(IPC.gamePlay),
    javaInfo: () => ipcRenderer.invoke(IPC.gameJava),
  },
}

contextBridge.exposeInMainWorld('hemisphere', api)
