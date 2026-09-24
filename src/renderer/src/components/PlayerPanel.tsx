import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { PlayableSong } from '@shared/types'
import { formatTime } from '../format'
import type { CameraController } from '../camera/useCamera'
import { CameraControls } from './CameraControls'
import type { PlayerControls } from '../player/usePlayer'

interface Props {
  song: PlayableSong | null
  /** Cantor da vez, quando a música veio da fila. */
  singer: string
  onNext(): void
  hasNext: boolean
  player: PlayerControls
  audioRef: RefObject<HTMLAudioElement | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
  camera: CameraController
  cameraVideoRef: RefObject<HTMLVideoElement | null>
}

export function PlayerPanel({
  song,
  singer,
  onNext,
  hasNext,
  player,
  audioRef,
  canvasRef,
  camera,
  cameraVideoRef
}: Props): React.JSX.Element {
  const { state } = player
  const stageRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback((): void => {
    const stage = stageRef.current
    if (!stage) return
    const action = document.fullscreenElement
      ? document.exitFullscreen()
      : stage.requestFullscreen()
    action.catch((error: unknown) =>
      window.api.log('WARN', 'Falha ao alternar tela cheia', { error: String(error) })
    )
  }, [])

  const hasSong = state.songId !== null && state.status !== 'error'
  const canPlay = hasSong && (state.status === 'paused' || state.status === 'stopped')
  const canPause = state.status === 'playing'
  const canStop = hasSong && state.status !== 'stopped'
  const duration = state.duration

  return (
    <section className="player" aria-label="Player">
      <div className="now-playing">
        <div className="np-title" data-testid="np-title">
          {song?.title ?? 'Nenhuma música selecionada'}
        </div>
        <div className="np-artist" data-testid="np-artist">
          {song ? song.artist || 'Artista desconhecido' : 'Escolha uma música na biblioteca'}
          {song && singer && <span className="np-singer"> · Cantor: {singer}</span>}
        </div>
      </div>

      <div
        ref={stageRef}
        className={`stage cam-${camera.state.prefs.layout}${camera.state.status === 'on' ? ' cam-on' : ''}${fullscreen ? ' fullscreen' : ''}`}
        data-testid="stage"
      >
        <canvas ref={canvasRef} className="cdg-canvas" data-testid="cdg-canvas" />
        <video
          ref={cameraVideoRef}
          className={`camera-view${camera.state.prefs.mirror ? ' mirror' : ''}`}
          data-testid="camera-video"
          muted
          playsInline
          autoPlay
        />
        <audio ref={audioRef} preload="auto" data-testid="audio" />
        {fullscreen && (
          <button className="btn fs-exit" onClick={toggleFullscreen}>
            Sair da tela cheia (Esc)
          </button>
        )}
      </div>

      {state.status === 'error' && (
        <div className="notice error" role="alert" data-testid="player-error">
          {state.error}
        </div>
      )}
      {state.cdgError && state.status !== 'error' && (
        <div className="notice warn" role="alert" data-testid="cdg-error">
          {state.cdgError}
        </div>
      )}

      <CameraControls camera={camera} />

      <div className="timeline">
        <span className="time" data-testid="time-current">
          {formatTime(state.currentTime)}
        </span>
        <input
          type="range"
          className="seek"
          aria-label="Posição"
          min={0}
          max={duration > 0 ? duration : 1}
          step={0.1}
          value={Math.min(state.currentTime, duration > 0 ? duration : 1)}
          disabled={!hasSong || duration <= 0}
          onChange={(e) => player.seek(Number(e.target.value))}
        />
        <span className="time" data-testid="time-duration">
          {formatTime(duration)}
        </span>
      </div>

      <div className="controls">
        <button className="btn" onClick={player.play} disabled={!canPlay} data-testid="btn-play">
          ▶ Play
        </button>
        <button className="btn" onClick={player.pause} disabled={!canPause} data-testid="btn-pause">
          ⏸ Pause
        </button>
        <button className="btn" onClick={player.stop} disabled={!canStop} data-testid="btn-stop">
          ⏹ Stop
        </button>
        <button
          className="btn"
          onClick={onNext}
          disabled={!hasNext}
          title={hasNext ? 'Ir para a próxima da fila' : 'A fila não tem próxima música'}
          data-testid="btn-next"
        >
          ⏭ Próxima
        </button>
        <label className="volume">
          Volume
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.volume}
            aria-label="Volume"
            data-testid="volume"
            onChange={(e) => player.setVolume(Number(e.target.value))}
          />
          <span className="time">{Math.round(state.volume * 100)}%</span>
        </label>
        <button className="btn" onClick={toggleFullscreen} data-testid="btn-fullscreen">
          ⛶ Tela cheia
        </button>
      </div>
      <div className="status" data-testid="player-status">
        {state.status}
      </div>
    </section>
  )
}
