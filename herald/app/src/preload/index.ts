import { contextBridge, ipcRenderer } from 'electron'
import type { HeraldBridge } from '@herald/api'

const bridge: HeraldBridge = {
  info: () => ipcRenderer.invoke('info'),
  session: {
    current: () => ipcRenderer.invoke('session:current'),
    signIn: (name, code) => ipcRenderer.invoke('session:signIn', name, code),
    signOut: () => ipcRenderer.invoke('session:signOut'),
    onEnded: (cb) => {
      const listener = () => cb()
      ipcRenderer.on('session:ended', listener)
      return () => ipcRenderer.removeListener('session:ended', listener)
    },
  },
  api: (method, path, body) => ipcRenderer.invoke('api', method, path, body),
  settings: { get: () => ipcRenderer.invoke('settings:get'), set: (patch) => ipcRenderer.invoke('settings:set', patch) },
  // Wrapped: contextBridge functions must not be passed straight to React handlers (they would receive the event)
  window: { minimize: () => ipcRenderer.send('window:minimize'), toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'), close: () => ipcRenderer.send('window:close') },
  copy: (text) => ipcRenderer.send('copy', text),
  images: { upload: (bytes, width, height) => ipcRenderer.invoke('image:upload', bytes, width, height), get: (id) => ipcRenderer.invoke('image:get', id) },
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    onState: (cb) => {
      const listener = (_e: unknown, s: Parameters<typeof cb>[0]) => cb(s)
      ipcRenderer.on('update:state', listener)
      return () => ipcRenderer.removeListener('update:state', listener)
    },
    install: () => ipcRenderer.send('update:install'),
  },
  launcher: {
    newStaffCode: (version) => ipcRenderer.invoke('launcher:newStaffCode', version),
    checkDiscord: (id) => ipcRenderer.invoke('launcher:checkDiscord', id),
    latest: () => ipcRenderer.invoke('launcher:latest'),
  },
}

contextBridge.exposeInMainWorld('herald', bridge)
