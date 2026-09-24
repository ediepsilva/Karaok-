import { useCallback, useRef, useState } from 'react'
import type { Song } from '@shared/types'
import { LibraryPanel } from './components/LibraryPanel'
import { PlayerPanel } from './components/PlayerPanel'
import { useLibrary } from './hooks/useLibrary'
import { usePlayer } from './player/usePlayer'

export function App(): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const library = useLibrary()
  const player = usePlayer(audioRef, canvasRef)
  const [current, setCurrent] = useState<Song | null>(null)

  const playSong = useCallback(
    (song: Song): void => {
      setCurrent(song)
      void player.load(song)
    },
    [player]
  )

  return (
    <div className="app">
      <header className="app-header">
        <h1>Karaokê</h1>
      </header>
      <main className="layout">
        <LibraryPanel library={library} activeSongId={current?.id ?? null} onPlay={playSong} />
        <PlayerPanel song={current} player={player} audioRef={audioRef} canvasRef={canvasRef} />
      </main>
    </div>
  )
}
