import type { DatabaseSync } from 'node:sqlite'
import type { LibraryFolder } from '@shared/types'

/** Pastas de música já importadas (para reescanear sem escolher de novo). */
export class FolderRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): LibraryFolder[] {
    const rows = this.db
      .prepare('SELECT path, added_at, last_scan FROM library_folders ORDER BY path')
      .all() as unknown as { path: string; added_at: string; last_scan: string | null }[]
    return rows.map((r) => ({ path: r.path, addedAt: r.added_at, lastScan: r.last_scan }))
  }

  /** Registra a pasta (ou só atualiza a data do último escaneamento). */
  touch(path: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO library_folders (path, added_at, last_scan) VALUES (?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET last_scan = excluded.last_scan`
      )
      .run(path, now, now)
  }
}
