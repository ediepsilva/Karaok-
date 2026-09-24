import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { KaraokeApi } from '../shared/types'

const api: KaraokeApi = {
  app: { info: () => ipcRenderer.invoke(IPC.appInfo) },
  library: {
    list: () => ipcRenderer.invoke(IPC.libraryList),
    search: (query) => ipcRenderer.invoke(IPC.librarySearch, query),
    pickFolder: () => ipcRenderer.invoke(IPC.libraryPickFolder),
    importFolder: (folder) => ipcRenderer.invoke(IPC.libraryImportFolder, folder)
  },
  songs: {
    checkFiles: (id) => ipcRenderer.invoke(IPC.songCheckFiles, id),
    markPlayed: (id) => ipcRenderer.invoke(IPC.songMarkPlayed, id)
  },
  log: (level, message, context) => ipcRenderer.send(IPC.log, level, message, context)
}

contextBridge.exposeInMainWorld('api', api)
