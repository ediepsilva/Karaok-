import type { DatabaseSync } from 'node:sqlite'
import type { Song } from '@shared/types'
import { normalizeForSearch } from '../library/filename'

export interface NewSong {
  title: string
  artist: string
  genre?: string
  language?: string
  mp3Path: string
  cdgPath: string
  duration: number
}

interface SongRow {
  id: number
  title: string
  artist: string
  genre: string
  language: string
  mp3_path: string
  cdg_path: string
  duration: number
  date_added: string
  last_played: string | null
  play_count: number
}

function toSong(row: SongRow): Song {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    genre: row.genre,
    language: row.language,
    mp3Path: row.mp3_path,
    cdgPath: row.cdg_path,
    duration: row.duration,
    dateAdded: row.date_added,
    lastPlayed: row.last_played,
    playCount: row.play_count
  }
}

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`)

export class SongRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** Insere em uma transação. Caminhos MP3 já cadastrados (sem diferenciar maiúsculas) são ignorados. */
  addMany(songs: NewSong[]): { added: number; duplicates: number } {
    const insert = this.db.prepare(`
      INSERT INTO songs (title, artist, genre, language, mp3_path, cdg_path, duration, date_added,
                         title_norm, artist_norm)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`)
    let added = 0
    const now = new Date().toISOString()
    this.db.exec('BEGIN')
    try {
      for (const s of songs) {
        const info = insert.run(
          s.title,
          s.artist,
          s.genre ?? '',
          s.language ?? '',
          s.mp3Path,
          s.cdgPath,
          s.duration,
          now,
          normalizeForSearch(s.title),
          normalizeForSearch(s.artist)
        )
        added += Number(info.changes)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return { added, duplicates: songs.length - added }
  }

  list(): Song[] {
    const rows = this.db
      .prepare('SELECT * FROM songs ORDER BY artist_norm, title_norm')
      .all() as unknown as SongRow[]
    return rows.map(toSong)
  }

  /** Cada palavra da busca deve aparecer no título ou no artista (sem acentos, sem caixa). */
  search(query: string): Song[] {
    const words = normalizeForSearch(query).split(' ').filter(Boolean)
    if (words.length === 0) return this.list()
    const clause = "(title_norm LIKE ? ESCAPE '\\' OR artist_norm LIKE ? ESCAPE '\\')"
    const where = words.map(() => clause).join(' AND ')
    const params = words.flatMap((w) => [`%${escapeLike(w)}%`, `%${escapeLike(w)}%`])
    const rows = this.db
      .prepare(`SELECT * FROM songs WHERE ${where} ORDER BY artist_norm, title_norm`)
      .all(...params) as unknown as SongRow[]
    return rows.map(toSong)
  }

  getById(id: number): Song | undefined {
    const row = this.db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as SongRow | undefined
    return row ? toSong(row) : undefined
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM songs').get() as { n: number }
    return row.n
  }

  markPlayed(id: number): void {
    this.db
      .prepare('UPDATE songs SET play_count = play_count + 1, last_played = ? WHERE id = ?')
      .run(new Date().toISOString(), id)
  }
}
