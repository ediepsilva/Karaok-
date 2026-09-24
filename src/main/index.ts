import { join } from 'node:path'
import { app, BrowserWindow, dialog, session, shell } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import type { AppInfo } from '@shared/types'
import { DatabaseError, openDatabase } from './db/database'
import { FolderRepository } from './db/folder-repository'
import { QueueRepository } from './db/queue-repository'
import { SongRepository } from './db/song-repository'
import { registerIpc } from './ipc'
import { LibraryService } from './library/library-service'
import { QueueService } from './library/queue-service'
import { createFileLogger } from './logger'
import { handleMediaProtocol, registerMediaScheme } from './media-protocol'
import { createTrustedOrigin, installPermissionPolicy } from './permissions'

// Permite isolar dados em testes end-to-end sem tocar no perfil do usuário.
if (process.env['KARAOKE_USER_DATA']) app.setPath('userData', process.env['KARAOKE_USER_DATA'])

registerMediaScheme()

const logger = createFileLogger(join(app.getPath('userData'), 'logs'))
let database: DatabaseSync | undefined

process.on('uncaughtException', (error) => logger.error('Exceção não tratada (main)', { error }))
process.on('unhandledRejection', (reason) => logger.error('Promise rejeitada (main)', { reason }))

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f1117',
    title: 'Karaoke Studio',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('render-process-gone', (_e, details) =>
    logger.error('Processo de renderização encerrou', { ...details })
  )

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return win
}

function applyContentSecurityPolicy(): void {
  if (process.env['ELECTRON_RENDERER_URL']) return // o servidor de desenvolvimento usa scripts inline
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; media-src karaoke-media:; connect-src karaoke-media:"
        ]
      }
    })
  })
}

async function boot(): Promise<void> {
  const dataDir = app.getPath('userData')
  const databasePath = join(dataDir, 'karaoke.db')
  logger.info('Inicializando Karaoke Studio', {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    dataDir
  })

  try {
    database = openDatabase(databasePath, logger)
  } catch (error) {
    logger.error('Falha de banco na inicialização', { error })
    const message = error instanceof DatabaseError ? error.message : 'Falha ao acessar o banco.'
    dialog.showErrorBox('Karaoke Studio', `${message}\n\nConsulte o log em:\n${logger.dir}`)
    app.exit(1)
    return
  }

  const repo = new SongRepository(database)
  const info: AppInfo = {
    name: app.getName(),
    version: app.getVersion(),
    dataDir,
    databasePath,
    logDir: logger.dir
  }
  handleMediaProtocol(repo, logger)
  registerIpc({
    library: new LibraryService(repo, new FolderRepository(database), logger),
    queue: new QueueService(new QueueRepository(database), repo, logger),
    logger,
    info
  })
  applyContentSecurityPolicy()
  installPermissionPolicy(
    session.defaultSession,
    createTrustedOrigin(process.env['ELECTRON_RENDERER_URL']),
    logger
  )
  logger.info('Biblioteca carregada', { songs: repo.count() })
  createWindow()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  void app.whenReady().then(boot)
  app.on('window-all-closed', () => app.quit())
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && database) createWindow()
  })
  app.on('quit', () => {
    try {
      database?.close()
    } catch {
      /* ignora */
    }
    logger.info('Aplicativo encerrado')
  })
}
