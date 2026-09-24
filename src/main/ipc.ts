import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { AppInfo, IpcResult, LogLevel } from '@shared/types'
import { IPC } from '@shared/ipc-channels'
import type { LibraryService } from './library/library-service'
import type { Logger } from './logger'

export interface IpcDeps {
  library: LibraryService
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

function validId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Identificador de música inválido.')
  }
  return value
}

export function registerIpc({ library, logger, info }: IpcDeps): void {
  ipcMain.handle(IPC.appInfo, () => guard(logger, 'app:info', () => info))
  ipcMain.handle(IPC.libraryList, () => guard(logger, 'library:list', () => library.list()))
  ipcMain.handle(IPC.librarySearch, (_e, query: unknown) =>
    guard(logger, 'library:search', () => library.search(typeof query === 'string' ? query : ''))
  )
  ipcMain.handle(IPC.libraryPickFolder, (event) =>
    guard(logger, 'library:pick-folder', async () => {
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
  ipcMain.handle(IPC.libraryImportFolder, (_e, folder: unknown) =>
    guard(logger, 'library:import-folder', () => library.importFolder(folder as string))
  )
  ipcMain.handle(IPC.songCheckFiles, (_e, id: unknown) =>
    guard(logger, 'song:check-files', () => library.checkFiles(validId(id)))
  )
  ipcMain.handle(IPC.songMarkPlayed, (_e, id: unknown) =>
    guard(logger, 'song:mark-played', () => {
      library.markPlayed(validId(id))
      return null
    })
  )
  ipcMain.on(IPC.log, (_e, level: unknown, message: unknown, context: unknown) => {
    if (typeof message !== 'string' || !LEVELS.includes(level as LogLevel)) return
    const ctx =
      context && typeof context === 'object'
        ? { source: 'renderer', ...context }
        : { source: 'renderer' }
    logger.log(level as LogLevel, message.slice(0, 2000), ctx)
  })
}
