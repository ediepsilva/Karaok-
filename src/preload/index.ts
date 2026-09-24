import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { KaraokeApi } from '../shared/types'

const api: KaraokeApi = {
  app: { info: () => ipcRenderer.invoke(IPC.appInfo) },
  library: {
    list: (filter) => ipcRenderer.invoke(IPC.libraryList, filter),
    pickFolder: () => ipcRenderer.invoke(IPC.libraryPickFolder),
    importFolder: (folder) => ipcRenderer.invoke(IPC.libraryImportFolder, folder),
    folders: () => ipcRenderer.invoke(IPC.libraryFolders),
    rescan: () => ipcRenderer.invoke(IPC.libraryRescan),
    removeMissing: () => ipcRenderer.invoke(IPC.libraryRemoveMissing)
  },
  songs: {
    get: (id) => ipcRenderer.invoke(IPC.songGet, id),
    checkFiles: (id) => ipcRenderer.invoke(IPC.songCheckFiles, id),
    markPlayed: (id, singer) => ipcRenderer.invoke(IPC.songMarkPlayed, id, singer),
    updateMetadata: (id, metadata) => ipcRenderer.invoke(IPC.songUpdateMetadata, id, metadata),
    setFavorite: (id, favorite) => ipcRenderer.invoke(IPC.songSetFavorite, id, favorite)
  },
  queue: {
    list: () => ipcRenderer.invoke(IPC.queueList),
    add: (songId, singer) => ipcRenderer.invoke(IPC.queueAdd, songId, singer),
    remove: (id) => ipcRenderer.invoke(IPC.queueRemove, id),
    move: (id, direction) => ipcRenderer.invoke(IPC.queueMove, id, direction),
    setStatus: (id, status) => ipcRenderer.invoke(IPC.queueSetStatus, id, status),
    clear: () => ipcRenderer.invoke(IPC.queueClear)
  },
  history: {
    list: (limit) => ipcRenderer.invoke(IPC.historyList, limit),
    clear: () => ipcRenderer.invoke(IPC.historyClear)
  },
  log: (level, message, context) => ipcRenderer.send(IPC.log, level, message, context)
}

contextBridge.exposeInMainWorld('api', api)
