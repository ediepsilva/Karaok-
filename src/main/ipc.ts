import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { AppInfo, IpcResult, LogLevel } from '@shared/types'
import { IPC } from '@shared/ipc-channels'
import type { LibraryService } from './library/library-service'
import type { QueueService } from './library/queue-service'
import type { Logger } from './logger'

export interface IpcDeps {
  library: LibraryService
  queue: QueueService
  logger: Logger
  info: AppInfo
}

const LEVELS: readonly LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR']

async function guard<T>(
  logger: Logger,
  operation: string,
  fn: () => T | Promise<T>
): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    logger.error(`Falha em ${operation}`, { error })
    const message = error instanceof Error ? error.message : 'Erro inesperado.'
    return { ok: false, message }
  }
}

/** Valida ids vindos do renderer (nunca confie no que chega pelo IPC). */
function validId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Identificador inválido.')
  }
  return value
}

export function registerIpc({ library, queue, logger, info }: IpcDeps): void {
  const handle = <T>(channel: string, fn: (...args: unknown[]) => T | Promise<T>): void => {
    ipcMain.handle(channel, (_event, ...args: unknown[]) =>
      guard(logger, channel, () => fn(...args))
    )
  }

  handle(IPC.appInfo, () => info)

  // Biblioteca
  handle(IPC.libraryList, (filter) => library.list(filter as never))
  handle(IPC.libraryFolders, () => library.listFolders())
  handle(IPC.libraryImportFolder, (folder) => library.importFolder(folder as string))
  handle(IPC.libraryRescan, () => library.rescan())
  handle(IPC.libraryRemoveMissing, () => library.removeMissing())
  ipcMain.handle(IPC.libraryPickFolder, (event) =>
    guard(logger, IPC.libraryPickFolder, async () => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options = {
        title: 'Escolha a pasta de músicas MP3+G',
        properties: ['openDirectory' as const]
      }
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    })
  )

  // Músicas
  handle(IPC.songGet, (id) => library.get(validId(id)))
  handle(IPC.songCheckFiles, (id) => library.checkFiles(validId(id)))
  handle(IPC.songMarkPlayed, (id, singer) => {
    queue.markPlayed(validId(id), singer)
    return null
  })
  handle(IPC.songUpdateMetadata, (id, metadata) => library.updateMetadata(validId(id), metadata))
  handle(IPC.songSetFavorite, (id, favorite) => library.setFavorite(validId(id), favorite === true))

  // Fila e histórico
  handle(IPC.queueList, () => queue.list())
  handle(IPC.queueAdd, (songId, singer) => queue.add(validId(songId), singer))
  handle(IPC.queueRemove, (id) => {
    queue.remove(validId(id))
    return null
  })
  handle(IPC.queueMove, (id, direction) => {
    queue.move(validId(id), direction)
    return null
  })
  handle(IPC.queueSetStatus, (id, status) => {
    queue.setStatus(validId(id), status)
    return null
  })
  handle(IPC.queueClear, () => {
    queue.clear()
    return null
  })
  handle(IPC.historyList, (limit) => queue.history(typeof limit === 'number' ? limit : undefined))
  handle(IPC.historyClear, () => {
    queue.clearHistory()
    return null
  })

  ipcMain.on(IPC.log, (_e, level: unknown, message: unknown, context: unknown) => {
    if (typeof message !== 'string' || !LEVELS.includes(level as LogLevel)) return
    const ctx =
      context && typeof context === 'object'
        ? { source: 'renderer', ...context }
        : { source: 'renderer' }
    logger.log(level as LogLevel, message.slice(0, 2000), ctx)
  })
}
