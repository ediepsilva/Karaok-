import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { AppInfo, IpcResult, LogLevel } from '@shared/types'
import { IPC } from '@shared/ipc-channels'
import type { LibraryService } from './library/library-service'
import type { MelodyService } from './melody/melody-service'
import type { QueueService } from './library/queue-service'
import type { Logger } from './logger'
import type { MicGate } from './mic-gate'

export interface IpcDeps {
  library: LibraryService
  queue: QueueService
  melody: MelodyService
  micGate: MicGate
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

export function registerIpc({ library, queue, melody, micGate, logger, info }: IpcDeps): void {
  const handle = <T>(channel: string, fn: (...args: unknown[]) => T | Promise<T>): void => {
    ipcMain.handle(channel, (_event, ...args: unknown[]) =>
      guard(logger, channel, () => fn(...args))
    )
  }

  handle(IPC.appInfo, () => info)
  handle(IPC.appOpenLogs, async () => {
    const failure = await shell.openPath(info.logDir)
    if (failure) throw new Error(failure)
    return null
  })

  // Biblioteca
  handle(IPC.libraryList, (filter) => library.list(filter as never))
  handle(IPC.libraryFolders, () => library.listFolders())
  handle(IPC.libraryImportFolder, (folder) => library.importFolder(folder as string))
  handle(IPC.libraryRescan, () => library.rescan())
  handle(IPC.libraryRemoveMissing, () => library.removeMissing())
  // O seletor é modal e fica aberto até o usuário escolher ou cancelar (sem timeout). Uma segunda
  // chamada enquanto ele está aberto reaproveita a mesma escolha em vez de abrir outro diálogo.
  let pendingPick: Promise<string | null> | null = null
  ipcMain.handle(IPC.libraryPickFolder, (event) =>
    guard(logger, IPC.libraryPickFolder, () => {
      if (pendingPick) {
        logger.warn('Seletor de pasta já aberto: chamada repetida ignorada')
        return pendingPick
      }
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options = {
        title: 'Escolha a pasta de músicas MP3+G',
        properties: ['openDirectory' as const]
      }
      const openedAt = Date.now()
      logger.info('Seletor de pasta aberto')
      pendingPick = (owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options))
        .then((result) => {
          const picked = result.canceled ? null : (result.filePaths[0] ?? null)
          logger.info('Seletor de pasta fechado', {
            motivo: picked === null ? 'cancelado pelo usuário' : 'pasta escolhida',
            abertoPorMs: Date.now() - openedAt
          })
          return picked
        })
        .finally(() => {
          pendingPick = null
        })
      return pendingPick
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

  // Melodia de referência (MIDI/KAR ao lado da música)
  handle(IPC.melodyGet, (songId) => melody.get(validId(songId)))
  handle(IPC.melodySetTrack, (songId, trackIndex) => melody.setTrack(validId(songId), trackIndex))

  // Microfone: armar a trava e informar o estado (a permissão em si é decidida em permissions.ts)
  handle(IPC.voiceArm, () => {
    micGate.arm()
    return null
  })
  handle(IPC.voiceActive, (active) => {
    if (typeof active !== 'boolean') throw new Error('Estado do microfone inválido.')
    if (micGate.isActive !== active) {
      logger.info(active ? 'Microfone ativo' : 'Microfone liberado')
    }
    micGate.setActive(active)
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
