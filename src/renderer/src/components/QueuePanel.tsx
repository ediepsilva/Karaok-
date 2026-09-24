import type { QueueItem } from '@shared/types'
import type { QueueController } from '../hooks/useQueue'
import { formatTime } from '../format'

interface Props {
  queue: QueueController
  onPlayNow(item: QueueItem): void
}

export function QueuePanel({ queue, onPlayNow }: Props): React.JSX.Element {
  const { items, error } = queue

  return (
    <div className="panel-body" aria-label="Fila de cantores">
      <div className="toolbar">
        <span className="hint">
          Adicione músicas na aba Biblioteca com o botão ＋. Ao terminar uma música, a próxima da
          fila toca sozinha.
        </span>
        <button
          className="btn small"
          disabled={items.length === 0}
          data-testid="queue-clear"
          onClick={() => {
            if (window.confirm('Limpar toda a fila?')) void queue.clear()
          }}
        >
          Limpar fila
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <ol className="queue-list" data-testid="queue-list">
        {items.map((item, index) => (
          <li
            key={item.id}
            className={`queue-item${item.status === 'playing' ? ' playing' : ''}`}
            data-status={item.status}
          >
            <span className="pos">{index + 1}</span>
            <div className="who">
              <div className="singer" data-testid="queue-singer">
                {item.singer || '—'}
              </div>
              <div className="song">
                {item.title}
                {item.artist && <span className="artist"> — {item.artist}</span>}
              </div>
            </div>
            <span className="num">{item.duration > 0 ? formatTime(item.duration) : '—'}</span>
            <span className={`badge ${item.status}`} data-testid="queue-status">
              {item.status === 'playing' ? 'Tocando' : 'Aguardando'}
            </span>
            <div className="row-actions always">
              <button
                className="icon-btn"
                aria-label="Tocar agora"
                title="Tocar agora"
                data-testid="queue-play"
                onClick={() => onPlayNow(item)}
              >
                ▶
              </button>
              <button
                className="icon-btn"
                aria-label="Mover para cima"
                title="Mover para cima"
                disabled={index === 0}
                data-testid="queue-up"
                onClick={() => void queue.move(item.id, 'up')}
              >
                ↑
              </button>
              <button
                className="icon-btn"
                aria-label="Mover para baixo"
                title="Mover para baixo"
                disabled={index === items.length - 1}
                data-testid="queue-down"
                onClick={() => void queue.move(item.id, 'down')}
              >
                ↓
              </button>
              <button
                className="icon-btn"
                aria-label="Remover da fila"
                title="Remover da fila"
                data-testid="queue-remove"
                onClick={() => void queue.remove(item.id)}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="empty">A fila está vazia.</li>}
      </ol>
      <div className="count" data-testid="queue-count">
        {items.length} na fila
      </div>
    </div>
  )
}
