import type { DatabaseSync } from 'node:sqlite'
import type { LibraryFilter, Song, SongMetadata, SongSource } from '@shared/types'
import { normalizeForSearch } from '../library/filename'

export interface NewSong {
  title: string
  artist: string
  genre?: string
  language?: string
  code?: string
  mp3Path: string
  cdgPath: string
  duration: number
  source?: SongSource
  zipMp3Entry?: string
  zipCdgEntry?: string
}

/** Dados extras, só do main, para localizar a mídia de uma música dentro de um ZIP. */
export interface SongLocation {
  source: SongSource
  mp3Path: string
  cdgPath: string
  zipMp3Entry: string
  zipCdgEntry: string
}

interface SongRow {
  id: number
  title: string
  artist: string
  genre: string
  language: string
  code: string
  source: SongSource
  mp3_path: string
  cdg_path: string
  zip_mp3_entry: string
  zip_cdg_entry: string
  duration: number
  date_added: string
  last_played: string | null
  play_count: number
  favorite: number
}

function toSong(row: SongRow): Song {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    genre: row.genre,
    language: row.language,
    code: row.code,
    source: row.source,
    mp3Path: row.mp3_path,
    cdgPath: row.cdg_path,
    duration: row.duration,
    dateAdded: row.date_added,
    lastPlayed: row.last_played,
    playCount: row.play_count,
    favorite: row.favorite === 1
  }
}

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`)

/** Cada palavra da busca precisa aparecer no título, artista, gênero ou código. */
const WORD_CLAUSE =
  "(title_norm LIKE ? ESCAPE '\\' OR artist_norm LIKE ? ESCAPE '\\' " +
  "OR genre_norm LIKE ? ESCAPE '\\' OR code_norm LIKE ? ESCAPE '\\')"

export class SongRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** Insere em uma transação. Caminhos já cadastrados (sem diferenciar maiúsculas) são ignorados. */
  addMany(songs: NewSong[]): { added: number; duplicates: number } {
    const insert = this.db.prepare(`
      INSERT INTO songs (title, artist, genre, language, code, mp3_path, cdg_path, duration,
                         date_added, title_norm, artist_norm, genre_norm, code_norm,
                         source, zip_mp3_entry, zip_cdg_entry)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`)
    let added = 0
    const now = new Date().toISOString()
    this.db.exec('BEGIN')
    try {
      for (const s of songs) {
        const genre = s.genre ?? ''
        const code = s.code ?? ''
        const info = insert.run(
          s.title,
          s.artist,
          genre,
          s.language ?? '',
          code,
          s.mp3Path,
          s.cdgPath,
          s.duration,
          now,
          normalizeForSearch(s.title),
          normalizeForSearch(s.artist),
          normalizeForSearch(genre),
          normalizeForSearch(code),
          s.source ?? 'files',
          s.zipMp3Entry ?? '',
          s.zipCdgEntry ?? ''
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

  list(filter: LibraryFilter = {}): Song[] {
    const conditions: string[] = []
    const params: string[] = []
    for (const word of normalizeForSearch(filter.query ?? '')
      .split(' ')
      .filter(Boolean)) {
      conditions.push(WORD_CLAUSE)
      const like = `%${escapeLike(word)}%`
      params.push(like, like, like, like)
    }
    if (filter.favoritesOnly) conditions.push('favorite = 1')
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = this.db
      .prepare(`SELECT * FROM songs ${where} ORDER BY artist_norm, title_norm`)
      .all(...params) as unknown as SongRow[]
    return rows.map(toSong)
  }

  /** Compatibilidade com a Fase 1: busca por texto. */
  search(query: string): Song[] {
    return this.list({ query })
  }

  getById(id: number): Song | undefined {
    const row = this.db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as SongRow | undefined
    return row ? toSong(row) : undefined
  }

  /** Onde estão os arquivos da música (inclui as entradas dentro do ZIP). */
  getLocation(id: number): SongLocation | undefined {
    const row = this.db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as SongRow | undefined
    return row
      ? {
          source: row.source,
          mp3Path: row.mp3_path,
          cdgPath: row.cdg_path,
          zipMp3Entry: row.zip_mp3_entry,
          zipCdgEntry: row.zip_cdg_entry
        }
      : undefined
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM songs').get() as { n: number }
    return row.n
  }

  updateMetadata(id: number, meta: SongMetadata): Song | undefined {
    this.db
      .prepare(
        `UPDATE songs SET title = ?, artist = ?, genre = ?, language = ?, code = ?,
           title_norm = ?, artist_norm = ?, genre_norm = ?, code_norm = ? WHERE id = ?`
      )
      .run(
        meta.title,
        meta.artist,
        meta.genre,
        meta.language,
        meta.code,
        normalizeForSearch(meta.title),
        normalizeForSearch(meta.artist),
        normalizeForSearch(meta.genre),
        normalizeForSearch(meta.code),
        id
      )
    return this.getById(id)
  }

  setFavorite(id: number, favorite: boolean): Song | undefined {
    this.db.prepare('UPDATE songs SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, id)
    return this.getById(id)
  }

  /** Incrementa o contador de execuções e a data da última vez tocada. */
  markPlayed(id: number): void {
    this.db
      .prepare('UPDATE songs SET play_count = play_count + 1, last_played = ? WHERE id = ?')
      .run(new Date().toISOString(), id)
  }

  /** Apaga músicas pelo id (fila cai em cascata; histórico mantém o registro sem vínculo). */
  deleteMany(ids: number[]): number {
    if (ids.length === 0) return 0
    const remove = this.db.prepare('DELETE FROM songs WHERE id = ?')
    let removed = 0
    this.db.exec('BEGIN')
    try {
      for (const id of ids) removed += Number(remove.run(id).changes)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return removed
  }

  /** id + localização de todas as músicas, para verificar disponibilidade. */
  listLocations(): { id: number; location: SongLocation }[] {
    const rows = this.db.prepare('SELECT * FROM songs').all() as unknown as SongRow[]
    return rows.map((row) => ({
      id: row.id,
      location: {
        source: row.source,
        mp3Path: row.mp3_path,
        cdgPath: row.cdg_path,
        zipMp3Entry: row.zip_mp3_entry,
        zipCdgEntry: row.zip_cdg_entry
      }
    }))
  }
}
