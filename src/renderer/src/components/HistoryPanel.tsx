import type { HistoryEntry } from '@shared/types'
import type { QueueController } from '../hooks/useQueue'

interface Props {
  queue: QueueController
  singer: string
  onPlayAgain(entry: HistoryEntry): void
  onEnqueueAgain(entry: HistoryEntry): void
}

const formatDate = (iso: string): string => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function HistoryPanel({
  queue,
  singer,
  onPlayAgain,
  onEnqueueAgain
}: Props): React.JSX.Element {
  const { history } = queue

  return (
    <div className="panel-body" aria-label="Histórico">
      <div className="toolbar">
        <span className="hint">Músicas já tocadas, da mais recente para a mais antiga.</span>
        <button
          className="btn small"
          disabled={history.length === 0}
          data-testid="history-clear"
          onClick={() => {
            if (window.confirm('Limpar todo o histórico?')) void queue.clearHistory()
          }}
        >
          Limpar histórico
        </button>
      </div>
      <ul className="history-list" data-testid="history-list">
        {history.map((entry) => (
          <li key={entry.id} className="history-item">
            <span className="when">{formatDate(entry.playedAt)}</span>
            <div className="who">
              <div className="song">
                {entry.title}
                {entry.artist && <span className="artist"> — {entry.artist}</span>}
              </div>
              <div className="singer">{entry.singer || 'Sem cantor'}</div>
            </div>
            <div className="row-actions always">
              <button
                className="icon-btn"
                aria-label="Tocar de novo"
                title={entry.songId === null ? 'Música removida da biblioteca' : 'Tocar de novo'}
                disabled={entry.songId === null}
                onClick={() => onPlayAgain(entry)}
              >
                ▶
              </button>
              <button
                className="icon-btn"
                aria-label="Adicionar à fila"
                title={singer.trim() ? 'Adicionar à fila' : 'Informe o nome do cantor primeiro'}
                disabled={entry.songId === null || !singer.trim()}
                onClick={() => onEnqueueAgain(entry)}
              >
                ＋
              </button>
            </div>
          </li>
        ))}
        {history.length === 0 && <li className="empty">Nada foi tocado ainda.</li>}
      </ul>
    </div>
  )
}
