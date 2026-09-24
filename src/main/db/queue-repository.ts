import type { DatabaseSync } from 'node:sqlite'
import type { HistoryEntry, MoveDirection, QueueItem, QueueStatus } from '@shared/types'

interface QueueRow {
  id: number
  song_id: number
  singer: string
  position: number
  status: QueueStatus
  title: string
  artist: string
  duration: number
}

interface HistoryRow {
  id: number
  song_id: number | null
  title: string
  artist: string
  singer: string
  played_at: string
}

const QUEUE_SELECT = `
  SELECT q.id, q.song_id, q.singer, q.position, q.status, s.title, s.artist, s.duration
  FROM queue q JOIN songs s ON s.id = q.song_id`

const toItem = (r: QueueRow): QueueItem => ({
  id: r.id,
  songId: r.song_id,
  singer: r.singer,
  position: r.position,
  status: r.status,
  title: r.title,
  artist: r.artist,
  duration: r.duration
})

/** Fila de cantores e histórico de execuções. */
export class QueueRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** Itens ativos (aguardando ou tocando) na ordem da fila. */
  list(): QueueItem[] {
    const rows = this.db
      .prepare(`${QUEUE_SELECT} WHERE q.status != 'done' ORDER BY q.position, q.id`)
      .all() as unknown as QueueRow[]
    return rows.map(toItem)
  }

  get(id: number): QueueItem | undefined {
    const row = this.db.prepare(`${QUEUE_SELECT} WHERE q.id = ?`).get(id) as QueueRow | undefined
    return row ? toItem(row) : undefined
  }

  add(songId: number, singer: string): QueueItem {
    const max = this.db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM queue').get() as {
      p: number
    }
    const info = this.db
      .prepare(
        'INSERT INTO queue (song_id, singer, position, status, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(songId, singer, max.p + 1, 'waiting', new Date().toISOString())
    return this.get(Number(info.lastInsertRowid)) as QueueItem
  }

  remove(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM queue WHERE id = ?').run(id).changes) > 0
  }

  /** Troca de lugar com o vizinho ativo mais próximo na direção pedida. */
  move(id: number, direction: MoveDirection): boolean {
    const items = this.list()
    const index = items.findIndex((i) => i.id === id)
    const neighbor = items[direction === 'up' ? index - 1 : index + 1]
    const current = items[index]
    if (index < 0 || !neighbor || !current) return false
    const update = this.db.prepare('UPDATE queue SET position = ? WHERE id = ?')
    this.db.exec('BEGIN')
    try {
      update.run(neighbor.position, current.id)
      update.run(current.position, neighbor.id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return true
  }

  /**
   * Muda o status. Só pode haver um item "tocando": ao iniciar outro, o anterior volta a
   * "aguardando" (ex.: o usuário trocou de música à mão).
   */
  setStatus(id: number, status: QueueStatus): boolean {
    this.db.exec('BEGIN')
    try {
      if (status === 'playing') {
        this.db
          .prepare("UPDATE queue SET status = 'waiting' WHERE status = 'playing' AND id != ?")
          .run(id)
      }
      const info = this.db.prepare('UPDATE queue SET status = ? WHERE id = ?').run(status, id)
      this.db.exec('COMMIT')
      return Number(info.changes) > 0
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  clear(): void {
    this.db.prepare('DELETE FROM queue').run()
  }

  /** Após reiniciar o app nada está tocando: itens "tocando" voltam a "aguardando". */
  resetPlaying(): number {
    return Number(
      this.db.prepare("UPDATE queue SET status = 'waiting' WHERE status = 'playing'").run().changes
    )
  }

  addHistory(songId: number, singer: string): void {
    this.db
      .prepare(
        `INSERT INTO history (song_id, title, artist, singer, played_at)
         SELECT id, title, artist, ?, ? FROM songs WHERE id = ?`
      )
      .run(singer, new Date().toISOString(), songId)
  }

  listHistory(limit = 100): HistoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM history ORDER BY played_at DESC, id DESC LIMIT ?')
      .all(Math.min(Math.max(1, Math.floor(limit)), 1000)) as unknown as HistoryRow[]
    return rows.map((r) => ({
      id: r.id,
      songId: r.song_id,
      title: r.title,
      artist: r.artist,
      singer: r.singer,
      playedAt: r.played_at
    }))
  }

  clearHistory(): void {
    this.db.prepare('DELETE FROM history').run()
  }
}
