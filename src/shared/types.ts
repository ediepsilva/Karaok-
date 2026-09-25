/** Tipos compartilhados entre main, preload e renderer. */

export type SongSource = 'files' | 'zip'

export interface Song {
  id: number
  title: string
  artist: string
  genre: string
  language: string
  code: string
  /** `files`: mp3Path/cdgPath são arquivos; `zip`: ambos apontam para o .zip. */
  source: SongSource
  mp3Path: string
  cdgPath: string
  /** Duração estimada em segundos (derivada do tamanho do CDG). */
  duration: number
  dateAdded: string
  lastPlayed: string | null
  playCount: number
  favorite: boolean
}

/** O mínimo que o player precisa para tocar uma música. */
export interface PlayableSong {
  id: number
  title: string
  artist: string
  duration: number
  /** Cantor da vez (fila); vai para o histórico. */
  singer?: string
}

export interface SongMetadata {
  title: string
  artist: string
  genre: string
  language: string
  code: string
}

export interface LibraryFilter {
  query?: string
  favoritesOnly?: boolean
}

export interface ImportIssue {
  path: string
  reason: string
}

export interface ImportResult {
  folder: string
  /** Músicas (pares MP3+CDG ou ZIPs válidos) encontradas na pasta. */
  found: number
  /** Quantas dessas estavam dentro de arquivos ZIP. */
  foundInZip: number
  added: number
  duplicates: number
  mp3WithoutCdg: number
  cdgWithoutMp3: number
  issues: ImportIssue[]
}

export interface RescanResult {
  folders: number
  found: number
  added: number
  duplicates: number
  unavailableFolders: string[]
}

export interface LibraryFolder {
  path: string
  addedAt: string
  lastScan: string | null
}

export type QueueStatus = 'waiting' | 'playing' | 'done'

export interface QueueItem {
  id: number
  songId: number
  singer: string
  position: number
  status: QueueStatus
  title: string
  artist: string
  duration: number
}

export type MoveDirection = 'up' | 'down'

export interface HistoryEntry {
  id: number
  /** null se a música foi removida da biblioteca depois. */
  songId: number | null
  title: string
  artist: string
  singer: string
  playedAt: string
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
    list(filter?: LibraryFilter): Promise<IpcResult<Song[]>>
    /** Abre o seletor de pasta; devolve o caminho escolhido ou null se cancelado. */
    pickFolder(): Promise<IpcResult<string | null>>
    importFolder(folder: string): Promise<IpcResult<ImportResult>>
    folders(): Promise<IpcResult<LibraryFolder[]>>
    rescan(): Promise<IpcResult<RescanResult>>
    /** Remove do catálogo músicas cujos arquivos não existem mais; devolve quantas. */
    removeMissing(): Promise<IpcResult<number>>
  }
  songs: {
    get(id: number): Promise<IpcResult<Song | null>>
    checkFiles(id: number): Promise<IpcResult<SongFileStatus>>
    markPlayed(id: number, singer?: string): Promise<IpcResult<null>>
    updateMetadata(id: number, metadata: SongMetadata): Promise<IpcResult<Song>>
    setFavorite(id: number, favorite: boolean): Promise<IpcResult<Song>>
  }
  queue: {
    list(): Promise<IpcResult<QueueItem[]>>
    add(songId: number, singer: string): Promise<IpcResult<QueueItem>>
    remove(id: number): Promise<IpcResult<null>>
    move(id: number, direction: MoveDirection): Promise<IpcResult<null>>
    setStatus(id: number, status: QueueStatus): Promise<IpcResult<null>>
    clear(): Promise<IpcResult<null>>
  }
  history: {
    list(limit?: number): Promise<IpcResult<HistoryEntry[]>>
    clear(): Promise<IpcResult<null>>
  }
  voice: {
    /** Arma a trava do microfone: o próximo pedido de áudio (e só ele) será concedido. */
    arm(): Promise<IpcResult<null>>
    /** Informa ao main que o microfone abriu/fechou (auditoria e consulta de dispositivos). */
    setActive(active: boolean): Promise<IpcResult<null>>
  }
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void
}

export const MEDIA_SCHEME = 'karaoke-media'

export function mediaUrl(songId: number, kind: 'mp3' | 'cdg'): string {
  return `${MEDIA_SCHEME}://song/${songId}/${kind}`
}
