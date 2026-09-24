import type { Song } from '@shared/types'
import type { LibraryController } from '../hooks/useLibrary'
import { formatTime } from '../format'

interface Props {
  library: LibraryController
  activeSongId: number | null
  onPlay(song: Song): void
}

export function LibraryPanel({ library, activeSongId, onPlay }: Props): React.JSX.Element {
  const { songs, query, setQuery, loading, importing, error, lastImport, addFolder } = library

  return (
    <section className="library" aria-label="Biblioteca">
      <div className="toolbar">
        <input
          type="search"
          className="search"
          placeholder="Pesquisar música ou artista"
          aria-label="Pesquisar música ou artista"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn primary" onClick={() => void addFolder()} disabled={importing}>
          {importing ? 'Importando…' : 'Adicionar pasta de músicas'}
        </button>
      </div>

      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {lastImport && (
        <div className="notice info" role="status" data-testid="import-summary">
          <span>
            {lastImport.added} música(s) adicionada(s), {lastImport.duplicates} já cadastrada(s),{' '}
            {lastImport.mp3WithoutCdg} MP3 sem CDG, {lastImport.cdgWithoutMp3} CDG sem MP3
            {lastImport.issues.length > 0 && `, ${lastImport.issues.length} com problema`}.
          </span>
          <button className="link" onClick={library.dismissImport}>
            Fechar
          </button>
        </div>
      )}

      <div className="table-head">
        <span>Música</span>
        <span>Artista</span>
        <span className="num">Duração</span>
      </div>
      <ul className="song-list" data-testid="song-list">
        {songs.map((song) => (
          <li key={song.id}>
            <button
              className={`song-row${song.id === activeSongId ? ' active' : ''}`}
              onClick={() => onPlay(song)}
              title="Clique para tocar"
            >
              <span className="title">{song.title}</span>
              <span className="artist">{song.artist || 'Artista desconhecido'}</span>
              <span className="num">{song.duration > 0 ? formatTime(song.duration) : '—'}</span>
            </button>
          </li>
        ))}
        {!loading && songs.length === 0 && (
          <li className="empty">
            {query
              ? 'Nenhuma música encontrada para esta busca.'
              : 'Nenhuma música na biblioteca. Use “Adicionar pasta de músicas”.'}
          </li>
        )}
      </ul>
      <div className="count" data-testid="song-count">
        {songs.length} música(s)
      </div>
    </section>
  )
}
