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
  },
  {
    version: 2,
    name: 'zip songs, favorites, code, queue, history and library folders',
    sql: `
      ALTER TABLE songs ADD COLUMN source TEXT NOT NULL DEFAULT 'files';
      ALTER TABLE songs ADD COLUMN zip_mp3_entry TEXT NOT NULL DEFAULT '';
      ALTER TABLE songs ADD COLUMN zip_cdg_entry TEXT NOT NULL DEFAULT '';
      ALTER TABLE songs ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE songs ADD COLUMN code TEXT NOT NULL DEFAULT '';
      ALTER TABLE songs ADD COLUMN genre_norm TEXT NOT NULL DEFAULT '';
      ALTER TABLE songs ADD COLUMN code_norm TEXT NOT NULL DEFAULT '';
      CREATE INDEX idx_songs_favorite ON songs (favorite);
      CREATE INDEX idx_songs_code ON songs (code_norm);

      CREATE TABLE queue (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id    INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
        singer     TEXT    NOT NULL DEFAULT '',
        position   INTEGER NOT NULL,
        status     TEXT    NOT NULL DEFAULT 'waiting'
                   CHECK (status IN ('waiting', 'playing', 'done')),
        created_at TEXT    NOT NULL
      );
      CREATE INDEX idx_queue_status_position ON queue (status, position);

      CREATE TABLE history (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id   INTEGER REFERENCES songs (id) ON DELETE SET NULL,
        title     TEXT NOT NULL,
        artist    TEXT NOT NULL DEFAULT '',
        singer    TEXT NOT NULL DEFAULT '',
        played_at TEXT NOT NULL
      );
      CREATE INDEX idx_history_played_at ON history (played_at);

      CREATE TABLE library_folders (
        path      TEXT PRIMARY KEY COLLATE NOCASE,
        added_at  TEXT NOT NULL,
        last_scan TEXT
      );
    `
  }
]
