export interface Migration {
  version: number
  name: string
  sql: string
}

/** Migrações em ordem. Nunca edite uma já publicada: adicione uma nova. */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'create songs and settings',
    sql: `
      CREATE TABLE songs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT    NOT NULL,
        artist      TEXT    NOT NULL DEFAULT '',
        genre       TEXT    NOT NULL DEFAULT '',
        language    TEXT    NOT NULL DEFAULT '',
        mp3_path    TEXT    NOT NULL,
        cdg_path    TEXT    NOT NULL,
        duration    REAL    NOT NULL DEFAULT 0,
        date_added  TEXT    NOT NULL,
        last_played TEXT,
        play_count  INTEGER NOT NULL DEFAULT 0,
        title_norm  TEXT    NOT NULL,
        artist_norm TEXT    NOT NULL DEFAULT ''
      );
      CREATE UNIQUE INDEX idx_songs_mp3_path ON songs (mp3_path COLLATE NOCASE);
      CREATE INDEX idx_songs_cdg_path ON songs (cdg_path COLLATE NOCASE);
      CREATE INDEX idx_songs_title ON songs (title_norm);
      CREATE INDEX idx_songs_artist ON songs (artist_norm);
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `
  }
]
