import type { HistoryEntry, MoveDirection, QueueItem, QueueStatus } from '@shared/types'
import type { QueueRepository } from '../db/queue-repository'
import type { SongRepository } from '../db/song-repository'
import type { Logger } from '../logger'
import { LibraryError } from './library-service'

const MAX_SINGER_LENGTH = 60
const STATUSES: readonly QueueStatus[] = ['waiting', 'playing', 'done']

/** Fila de cantores + histórico de execuções. */
export class QueueService {
  constructor(
    private readonly queue: QueueRepository,
    private readonly songs: SongRepository,
    private readonly logger: Logger
  ) {
    const reset = queue.resetPlaying()
    if (reset > 0) logger.info('Itens da fila que estavam tocando voltaram a aguardar', { reset })
  }

  list(): QueueItem[] {
    return this.queue.list()
  }

  add(songId: number, singer: unknown): QueueItem {
    if (typeof singer !== 'string' || !singer.trim()) {
      throw new LibraryError('Informe o nome do cantor.')
    }
    const name = singer.replace(/\s+/g, ' ').trim()
    if (name.length > MAX_SINGER_LENGTH) {
      throw new LibraryError(`O nome do cantor é longo demais (máximo ${MAX_SINGER_LENGTH}).`)
    }
    if (!this.songs.getById(songId)) throw new LibraryError('Música não encontrada na biblioteca.')
    const item = this.queue.add(songId, name)
    this.logger.info('Música adicionada à fila', { queueId: item.id, songId, singer: name })
    return item
  }

  remove(id: number): void {
    this.queue.remove(id)
  }

  move(id: number, direction: unknown): void {
    if (direction !== 'up' && direction !== 'down') throw new LibraryError('Direção inválida.')
    this.queue.move(id, direction as MoveDirection)
  }

  setStatus(id: number, status: unknown): void {
    if (!STATUSES.includes(status as QueueStatus)) throw new LibraryError('Status inválido.')
    if (!this.queue.setStatus(id, status as QueueStatus)) {
      throw new LibraryError('Item da fila não encontrado.')
    }
  }

  clear(): void {
    this.queue.clear()
    this.logger.info('Fila limpa')
  }

  /** Registra uma execução: contador da música, data e histórico (com o cantor da vez). */
  markPlayed(songId: number, singer: unknown): void {
    const name = typeof singer === 'string' ? singer.slice(0, MAX_SINGER_LENGTH) : ''
    this.songs.markPlayed(songId)
    this.queue.addHistory(songId, name)
  }

  history(limit?: number): HistoryEntry[] {
    return this.queue.listHistory(typeof limit === 'number' ? limit : 100)
  }

  clearHistory(): void {
    this.queue.clearHistory()
    this.logger.info('Histórico limpo')
  }
}
