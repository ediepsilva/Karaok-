import { useCallback, useEffect, useRef, useState } from 'react'
import type { HistoryEntry, PlayableSong, QueueItem, Song } from '@shared/types'
import { EditSongDialog } from './components/EditSongDialog'
import { HistoryPanel } from './components/HistoryPanel'
import { LibraryPanel } from './components/LibraryPanel'
import { PlayerPanel } from './components/PlayerPanel'
import { QueuePanel } from './components/QueuePanel'
import { useCamera } from './camera/useCamera'
import { useCelebration } from './celebration/useCelebration'
import { useLibrary } from './hooks/useLibrary'
import { useMelody } from './voice/useMelody'
import { useVoice } from './voice/useVoice'
import { useQueue } from './hooks/useQueue'
import { usePlayer } from './player/usePlayer'

type Tab = 'library' | 'queue' | 'history'

interface Current {
  song: PlayableSong
  /** Item da fila que está tocando; null para músicas tocadas direto da biblioteca. */
  queueItemId: number | null
}

const SINGER_KEY = 'karaoke.singer'

function readStoredSinger(): string {
  try {
    return window.localStorage.getItem(SINGER_KEY) ?? ''
  } catch {
    return ''
  }
}

export function App(): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cameraVideoRef = useRef<HTMLVideoElement>(null)
  const library = useLibrary()
  const queue = useQueue()
  const { refresh: refreshQueue, refreshHistory } = queue

  const [tab, setTab] = useState<Tab>('library')
  const [singer, setSinger] = useState(readStoredSinger)
  const [current, setCurrentState] = useState<Current | null>(null)
  const currentRef = useRef<Current | null>(null)
  const [editing, setEditing] = useState<Song | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const setCurrent = useCallback((value: Current | null): void => {
    currentRef.current = value
    setCurrentState(value)
  }, [])

  const showFlash = useCallback((message: string): void => {
    setFlash(message)
    window.setTimeout(() => setFlash((m) => (m === message ? null : m)), 3000)
  }, [])

  const changeSinger = useCallback((name: string): void => {
    setSinger(name)
    try {
      window.localStorage.setItem(SINGER_KEY, name)
    } catch {
      /* sem armazenamento: o nome vale só nesta sessão */
    }
  }, [])

  // O player precisa do callback de fim de música, que precisa do player: a ref fecha o ciclo.
  const advanceRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const player = usePlayer(audioRef, canvasRef, { onEnded: () => void advanceRef.current() })
  const camera = useCamera(cameraVideoRef)
  const melody = useMelody(player.state.songId)
  const voice = useVoice({
    phase: player.state.status,
    songId: player.state.songId,
    songDurationSec: current?.song.duration ?? (player.state.duration || null),
    songTitle: current?.song.title ?? '',
    singer: current?.song.singer ?? '',
    melody: melody.info?.notes ?? null,
    audioRef
  })
  const celebration = useCelebration(voice.result)

  // "Ligar ao tocar": só liga se o usuário pediu, e só uma vez por música (não religa após desligar).
  const { autoStart } = camera.state.prefs
  const cameraStatus = camera.state.status
  const playing = player.state.status === 'playing'
  const autoStartedFor = useRef<number | null>(null)
  const songId = player.state.songId
  const startCamera = camera.start
  const setCameraAutoStart = camera.setAutoStart
  // Marcar a opção com uma música já tocando vale só a partir da PRÓXIMA música: não liga na hora.
  const changeAutoStart = useCallback(
    (value: boolean): void => {
      if (value) autoStartedFor.current = songId
      setCameraAutoStart(value)
    },
    [setCameraAutoStart, songId]
  )
  const cameraUi = { ...camera, setAutoStart: changeAutoStart }
  useEffect(() => {
    if (!playing || !autoStart || cameraStatus !== 'off' || songId === null) return
    if (autoStartedFor.current === songId) return
    autoStartedFor.current = songId
    void startCamera()
  }, [playing, autoStart, cameraStatus, songId, startCamera])

  const startQueueItem = useCallback(
    async (item: QueueItem): Promise<void> => {
      await queue.setStatus(item.id, 'playing')
      setCurrent({
        queueItemId: item.id,
        song: {
          id: item.songId,
          title: item.title,
          artist: item.artist,
          duration: item.duration,
          singer: item.singer
        }
      })
      await player.load({
        id: item.songId,
        title: item.title,
        artist: item.artist,
        duration: item.duration,
        singer: item.singer
      })
    },
    [player, queue, setCurrent]
  )

  /** Encerra o item atual da fila (feito) e toca o próximo que estiver aguardando. */
  const advance = useCallback(async (): Promise<void> => {
    const cur = currentRef.current
    if (cur?.queueItemId != null) {
      await window.api.queue.setStatus(cur.queueItemId, 'done')
      setCurrent({ ...cur, queueItemId: null })
    }
    const items = await refreshQueue()
    const next = items.find((i) => i.status === 'waiting')
    if (next) await startQueueItem(next)
    await refreshHistory()
  }, [refreshHistory, refreshQueue, setCurrent, startQueueItem])

  useEffect(() => {
    advanceRef.current = advance
  }, [advance])

  /** Toca direto da biblioteca; se havia um item da fila tocando, ele volta a aguardar. */
  const playDirect = useCallback(
    async (song: PlayableSong): Promise<void> => {
      const cur = currentRef.current
      if (cur?.queueItemId != null) await queue.setStatus(cur.queueItemId, 'waiting')
      const playable = { ...song, singer: singer.trim() }
      setCurrent({ song: playable, queueItemId: null })
      await player.load(playable)
      await refreshHistory()
    },
    [player, queue, refreshHistory, setCurrent, singer]
  )

  const enqueue = useCallback(
    async (songId: number, title: string): Promise<void> => {
      if (await queue.add(songId, singer.trim())) showFlash(`Adicionada à fila: ${title}`)
    },
    [queue, showFlash, singer]
  )

  const playAgain = useCallback(
    async (entry: HistoryEntry): Promise<void> => {
      if (entry.songId === null) return
      const result = await window.api.songs.get(entry.songId)
      if (result.ok && result.value) await playDirect(result.value)
    },
    [playDirect]
  )

  useEffect(() => {
    if (tab === 'history') void refreshHistory()
  }, [tab, refreshHistory])

  const hasNext = queue.items.some((i) => i.status === 'waiting')

  return (
    <div className="app">
      <header className="app-header">
        <h1>Karaokê</h1>
        {flash && (
          <div className="flash" role="status" data-testid="flash">
            {flash}
          </div>
        )}
      </header>
      <main className="layout">
        <section className="library" aria-label="Painel">
          <div className="tabs" role="tablist">
            {(
              [
                ['library', 'Biblioteca'],
                ['queue', `Fila${queue.items.length > 0 ? ` (${queue.items.length})` : ''}`],
                ['history', 'Histórico']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={`tab${tab === id ? ' active' : ''}`}
                data-testid={`tab-${id}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'library' && (
            <LibraryPanel
              library={library}
              activeSongId={current?.song.id ?? null}
              singer={singer}
              onSingerChange={changeSinger}
              onPlay={(song) => void playDirect(song)}
              onEnqueue={(song) => void enqueue(song.id, song.title)}
              onEdit={setEditing}
            />
          )}
          {tab === 'queue' && (
            <QueuePanel queue={queue} onPlayNow={(item) => void startQueueItem(item)} />
          )}
          {tab === 'history' && (
            <HistoryPanel
              queue={queue}
              singer={singer}
              onPlayAgain={(entry) => void playAgain(entry)}
              onEnqueueAgain={(entry) =>
                entry.songId !== null && void enqueue(entry.songId, entry.title)
              }
            />
          )}
        </section>
        <PlayerPanel
          song={current?.song ?? null}
          singer={current?.song.singer ?? ''}
          hasNext={hasNext}
          onNext={() => void advance()}
          player={player}
          audioRef={audioRef}
          canvasRef={canvasRef}
          camera={cameraUi}
          cameraVideoRef={cameraVideoRef}
          voice={voice}
          melody={melody}
          celebration={celebration}
        />
      </main>
      {editing && (
        <EditSongDialog
          song={editing}
          onSave={(metadata) => library.saveMetadata(editing.id, metadata)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
