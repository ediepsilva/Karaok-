import { useCallback, useEffect, useReducer, useRef, type RefObject } from 'react'
import { mediaUrl, type Song } from '@shared/types'
import { CdgCanvasRenderer } from '../cdg/cdg-canvas'
import { CdgDecoder } from '../cdg/cdg-decoder'
import { clampVolume, initialPlayerState, playerReducer, type PlayerState } from './player-state'

const VOLUME_KEY = 'karaoke.volume'
export const AUDIO_ERROR_MESSAGE = 'Não foi possível reproduzir esta música.'
export const CDG_ERROR_MESSAGE = 'Não foi possível exibir os gráficos desta música.'

function readStoredVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY)
    return raw === null ? 1 : clampVolume(Number(raw))
  } catch {
    return 1
  }
}

export interface PlayerControls {
  state: PlayerState
  load(song: Song): Promise<void>
  play(): void
  pause(): void
  stop(): void
  seek(seconds: number): void
  setVolume(volume: number): void
}

/**
 * Coordena o <audio> (relógio de referência) e o decodificador CDG. A cada quadro de animação o
 * CDG é levado ao instante do áudio, então pausar, retomar, parar e buscar ficam sincronizados.
 */
export function usePlayer(
  audioRef: RefObject<HTMLAudioElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>
): PlayerControls {
  const [state, dispatch] = useReducer(playerReducer, undefined, () =>
    initialPlayerState(readStoredVolume())
  )
  const decoderRef = useRef<CdgDecoder | null>(null)
  const rendererRef = useRef<CdgCanvasRenderer | null>(null)
  const loadToken = useRef(0)
  const playCounted = useRef(false)
  const lastTick = useRef(-1)
  const songIdRef = useRef<number | null>(null)

  useEffect(() => {
    const audio = audioRef.current
    const canvas = canvasRef.current
    if (!audio || !canvas) return
    const renderer = new CdgCanvasRenderer(canvas)
    rendererRef.current = renderer
    audio.volume = readStoredVolume()

    const onPlaying = (): void => {
      dispatch({ type: 'playing' })
      if (!playCounted.current && songIdRef.current !== null) {
        playCounted.current = true
        void window.api.songs.markPlayed(songIdRef.current)
      }
    }
    const onPause = (): void => dispatch({ type: 'pause' })
    const onEnded = (): void => {
      dispatch({ type: 'ended' })
      audio.currentTime = 0
      decoderRef.current?.seekTo(0)
    }
    const onDuration = (): void => dispatch({ type: 'duration', duration: audio.duration })
    const onError = (): void => {
      if (!audio.getAttribute('src')) return
      window.api.log('ERROR', 'Falha de reprodução de áudio', {
        songId: songIdRef.current,
        code: audio.error?.code,
        detail: audio.error?.message
      })
      dispatch({ type: 'fail', message: AUDIO_ERROR_MESSAGE })
    }
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('durationchange', onDuration)
    audio.addEventListener('error', onError)

    let frame = 0
    const loop = (): void => {
      const decoder = decoderRef.current
      if (decoder) {
        decoder.seekTo(audio.currentTime)
        renderer.draw(decoder)
      }
      const quarter = Math.floor(audio.currentTime * 4)
      if (quarter !== lastTick.current) {
        lastTick.current = quarter
        dispatch({ type: 'time', time: audio.currentTime })
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(frame)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('durationchange', onDuration)
      audio.removeEventListener('error', onError)
    }
  }, [audioRef, canvasRef])

  const load = useCallback(
    async (song: Song): Promise<void> => {
      const audio = audioRef.current
      if (!audio) return
      const token = ++loadToken.current
      audio.pause()
      audio.removeAttribute('src')
      decoderRef.current = null
      rendererRef.current?.clear()
      playCounted.current = false
      songIdRef.current = song.id
      dispatch({ type: 'load', songId: song.id, duration: song.duration })

      const check = await window.api.songs.checkFiles(song.id)
      if (token !== loadToken.current) return
      if (!check.ok || !check.value.ok) {
        const message = !check.ok ? check.message : check.value.ok ? '' : check.value.message
        dispatch({ type: 'fail', message })
        return
      }

      audio.src = mediaUrl(song.id, 'mp3')
      audio.load()
      audio.play().catch((error: unknown) => {
        if (token !== loadToken.current || (error as Error).name === 'AbortError') return
        window.api.log('ERROR', 'Falha ao iniciar reprodução', {
          songId: song.id,
          error: String(error)
        })
        dispatch({ type: 'fail', message: AUDIO_ERROR_MESSAGE })
      })

      try {
        const response = await fetch(mediaUrl(song.id, 'cdg'))
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const decoder = new CdgDecoder(new Uint8Array(await response.arrayBuffer()))
        if (token === loadToken.current) decoderRef.current = decoder
      } catch (error) {
        if (token !== loadToken.current) return
        window.api.log('ERROR', 'Falha ao carregar CDG', { songId: song.id, error: String(error) })
        dispatch({ type: 'cdg-fail', message: CDG_ERROR_MESSAGE })
      }
    },
    [audioRef]
  )

  const play = useCallback((): void => {
    const audio = audioRef.current
    if (!audio || !audio.getAttribute('src')) return
    audio.play().catch((error: unknown) => {
      if ((error as Error).name === 'AbortError') return
      window.api.log('ERROR', 'Falha ao retomar reprodução', { error: String(error) })
      dispatch({ type: 'fail', message: AUDIO_ERROR_MESSAGE })
    })
  }, [audioRef])

  const pause = useCallback((): void => audioRef.current?.pause(), [audioRef])

  const stop = useCallback((): void => {
    const audio = audioRef.current
    if (!audio || !audio.getAttribute('src')) return
    dispatch({ type: 'stop' })
    audio.pause()
    audio.currentTime = 0
    decoderRef.current?.seekTo(0)
  }, [audioRef])

  const seek = useCallback(
    (seconds: number): void => {
      const audio = audioRef.current
      if (audio && audio.getAttribute('src') && Number.isFinite(seconds))
        audio.currentTime = seconds
    },
    [audioRef]
  )

  const setVolume = useCallback(
    (volume: number): void => {
      const v = clampVolume(volume)
      if (audioRef.current) audioRef.current.volume = v
      dispatch({ type: 'volume', volume: v })
      try {
        window.localStorage.setItem(VOLUME_KEY, String(v))
      } catch {
        /* armazenamento indisponível: volume só vale na sessão */
      }
    },
    [audioRef]
  )

  return { state, load, play, pause, stop, seek, setVolume }
}
