/** Tipos compartilhados entre main, preload e renderer. */

export interface Song {
  id: number
  title: string
  artist: string
  genre: string
  language: string
  mp3Path: string
  cdgPath: string
  /** Duração estimada em segundos (derivada do tamanho do CDG). */
  duration: number
  dateAdded: string
  lastPlayed: string | null
  playCount: number
}

export interface ImportIssue {
  path: string
  reason: string
}

export interface ImportResult {
  folder: string
  /** Pares MP3+CDG encontrados na pasta. */
  found: number
  added: number
  duplicates: number
  mp3WithoutCdg: number
  cdgWithoutMp3: number
  issues: ImportIssue[]
}

export interface AppInfo {
  name: string
  version: string
  dataDir: string
  databasePath: string
  logDir: string
}

export type SongFileStatus = { ok: true } | { ok: false; message: string }

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

/** Resultado de operações IPC que podem falhar de forma esperada. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; message: string }

export interface KaraokeApi {
  app: { info(): Promise<IpcResult<AppInfo>> }
  library: {
    list(): Promise<IpcResult<Song[]>>
    search(query: string): Promise<IpcResult<Song[]>>
    /** Abre o seletor de pasta; devolve o caminho escolhido ou null se cancelado. */
    pickFolder(): Promise<IpcResult<string | null>>
    importFolder(folder: string): Promise<IpcResult<ImportResult>>
  }
  songs: {
    checkFiles(id: number): Promise<IpcResult<SongFileStatus>>
    markPlayed(id: number): Promise<IpcResult<null>>
  }
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void
}

export const MEDIA_SCHEME = 'karaoke-media'

export function mediaUrl(songId: number, kind: 'mp3' | 'cdg'): string {
  return `${MEDIA_SCHEME}://song/${songId}/${kind}`
}
