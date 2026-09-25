import type { Song } from '@shared/types'
import type { LibraryController } from '../hooks/useLibrary'
import { formatTime } from '../format'

interface Props {
  library: LibraryController
  activeSongId: number | null
  singer: string
  onSingerChange(name: string): void
  onPlay(song: Song): void
  onEnqueue(song: Song): void
  onEdit(song: Song): void
}

export function LibraryPanel({
  library,
  activeSongId,
  singer,
  onSingerChange,
  onPlay,
  onEnqueue,
  onEdit
}: Props): React.JSX.Element {
  const { songs, query, setQuery, loading, busy, error, notice, lastImport } = library
  const canEnqueue = singer.trim().length > 0

  return (
    <div className="panel-body" aria-label="Biblioteca">
      <div className="toolbar">
        <input
          type="search"
          className="search"
          placeholder="Pesquisar título, artista, gênero ou código"
          aria-label="Pesquisar música ou artista"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn primary" onClick={() => void library.addFolder()} disabled={busy}>
          {busy ? 'Aguarde…' : 'Adicionar pasta de músicas'}
        </button>
      </div>

      <div className="toolbar sub">
        <label className="singer-field">
          Cantor
          <input
            className="search"
            placeholder="Nome de quem vai cantar"
            aria-label="Nome do cantor"
            data-testid="singer-input"
            maxLength={60}
            value={singer}
            onChange={(e) => onSingerChange(e.target.value)}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={library.favoritesOnly}
            data-testid="favorites-only"
            onChange={(e) => library.setFavoritesOnly(e.target.checked)}
          />
          Só favoritas
        </label>
        <button className="btn small" onClick={() => void library.rescan()} disabled={busy}>
          Reescanear pastas
        </button>
        <button
          className="btn small"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Remover do catálogo as músicas cujos arquivos não existem mais?')) {
              void library.removeMissing()
            }
          }}
        >
          Limpar indisponíveis
        </button>
      </div>

      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice info" role="status" data-testid="library-notice">
          <span>{notice}</span>
          <button className="link" onClick={library.dismissNotice}>
            Fechar
          </button>
        </div>
      )}
      {lastImport && (
        <div className="notice info" role="status" data-testid="import-summary">
          <span>
            {lastImport.added} música(s) adicionada(s)
            {(lastImport.foundInZip > 0 || lastImport.withMelody > 0) &&
              ` (${[
                lastImport.foundInZip > 0 ? `${lastImport.foundInZip} em ZIP` : '',
                lastImport.withMelody > 0 ? `${lastImport.withMelody} com melodia MIDI/KAR` : ''
              ]
                .filter(Boolean)
                .join(', ')})`}
            , {lastImport.duplicates} já cadastrada(s), {lastImport.mp3WithoutCdg} MP3 sem CDG,{' '}
            {lastImport.cdgWithoutMp3} CDG sem MP3
            {lastImport.issues.length > 0 && `, ${lastImport.issues.length} com problema`}.
          </span>
          <button className="link" onClick={library.dismissNotice}>
            Fechar
          </button>
        </div>
      )}
      {lastImport && lastImport.issues.length > 0 && (
        <details className="issues" data-testid="import-issues">
          <summary>Ver problemas da importação</summary>
          <ul>
            {lastImport.issues.map((issue) => (
              <li key={issue.path + issue.reason}>
                <strong>{issue.path}</strong>: {issue.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="table-head">
        <span>Música</span>
        <span>Artista</span>
        <span className="num">Duração</span>
        <span />
      </div>
      <ul className="song-list" data-testid="song-list">
        {songs.map((song) => (
          <li key={song.id} className={`song-item${song.id === activeSongId ? ' active' : ''}`}>
            <button className="song-row" onClick={() => onPlay(song)} title="Clique para tocar">
              <span className="title">
                {song.title}
                {song.source === 'zip' && <span className="tag">ZIP</span>}
                {song.hasMelody && (
                  <span
                    className="tag melody"
                    data-testid="tag-melody"
                    title="Tem melodia de referência: a avaliação compara a sua voz com ela"
                  >
                    {song.melodyFormat === 'kar' ? 'KAR' : 'MIDI'}
                  </span>
                )}
                {song.code && <span className="tag">{song.code}</span>}
              </span>
              <span className="artist">{song.artist || 'Artista desconhecido'}</span>
              <span className="num">{song.duration > 0 ? formatTime(song.duration) : '—'}</span>
            </button>
            <div className="row-actions">
              <button
                className={`icon-btn${song.favorite ? ' on' : ''}`}
                aria-label={song.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                aria-pressed={song.favorite}
                data-testid="btn-favorite"
                title="Favorita"
                onClick={() => void library.toggleFavorite(song)}
              >
                {song.favorite ? '★' : '☆'}
              </button>
              <button
                className="icon-btn"
                aria-label="Adicionar à fila"
                data-testid="btn-enqueue"
                title={canEnqueue ? 'Adicionar à fila' : 'Informe o nome do cantor primeiro'}
                disabled={!canEnqueue}
                onClick={() => onEnqueue(song)}
              >
                ＋
              </button>
              <button
                className="icon-btn"
                aria-label="Editar informações"
                data-testid="btn-edit"
                title="Editar título, artista, gênero…"
                onClick={() => onEdit(song)}
              >
                ✎
              </button>
            </div>
          </li>
        ))}
        {!loading && songs.length === 0 && (
          <li className="empty">
            {query || library.favoritesOnly
              ? 'Nenhuma música encontrada.'
              : 'Nenhuma música na biblioteca. Use “Adicionar pasta de músicas”.'}
          </li>
        )}
      </ul>
      <div className="count" data-testid="song-count">
        {songs.length} música(s)
      </div>
    </div>
  )
}
