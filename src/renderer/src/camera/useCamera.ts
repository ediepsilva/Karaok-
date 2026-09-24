import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from 'react'
import {
  cameraReducer,
  describeCameraError,
  initialCameraState,
  isDeviceUnavailableError,
  parseCameraPrefs,
  pickDevice,
  toCameraDevices,
  type CameraLayout,
  type CameraPrefs,
  type CameraState
} from './camera-state'

const PREFS_KEY = 'karaoke.camera'

function readPrefs(): CameraPrefs {
  try {
    return parseCameraPrefs(window.localStorage.getItem(PREFS_KEY))
  } catch {
    return parseCameraPrefs(null)
  }
}

function writePrefs(prefs: CameraPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* sem armazenamento: as preferências valem só nesta sessão */
  }
}

export interface CameraController {
  state: CameraState
  /**
   * O fluxo de vídeo ao vivo (ou null). É a fonte única da imagem do cantor: módulos futuros
   * (transmissão remota, avaliação) devem consumir este stream, e não abrir outra captura.
   */
  stream: MediaStream | null
  start(): Promise<void>
  stop(): void
  toggle(): void
  selectDevice(deviceId: string): void
  setLayout(layout: CameraLayout): void
  setMirror(mirror: boolean): void
  setAutoStart(autoStart: boolean): void
}

/** Câmera do cantor: captura só de vídeo, com escolha de dispositivo e tratamento de falhas. */
export function useCamera(videoRef: RefObject<HTMLVideoElement | null>): CameraController {
  const [state, dispatch] = useReducer(cameraReducer, undefined, () =>
    initialCameraState(readPrefs())
  )
  const [stream, setStream] = useState<MediaStream | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const startToken = useRef(0)
  const prefsRef = useRef(state.prefs)

  useEffect(() => {
    prefsRef.current = state.prefs
    writePrefs(state.prefs)
  }, [state.prefs])

  const refreshDevices = useCallback(async (): Promise<void> => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      dispatch({ type: 'devices', devices: toCameraDevices(list) })
    } catch (error) {
      window.api.log('WARN', 'Falha ao listar câmeras', { error: String(error) })
    }
  }, [])

  const release = useCallback((): void => {
    startToken.current++ // invalida qualquer start() em andamento
    const current = streamRef.current
    streamRef.current = null
    current?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    const video = videoRef.current
    if (video) video.srcObject = null
    setStream(null)
  }, [videoRef])

  const open = useCallback(
    (deviceId: string | null): Promise<MediaStream> =>
      navigator.mediaDevices.getUserMedia({
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: false // o microfone só entra com a avaliação vocal
      }),
    []
  )

  const start = useCallback(async (): Promise<void> => {
    release()
    const token = ++startToken.current
    dispatch({ type: 'starting' })

    let notice: string | null = null
    let acquired: MediaStream
    try {
      const devices = toCameraDevices(await navigator.mediaDevices.enumerateDevices())
      const wanted = prefsRef.current.deviceId
      const chosen = pickDevice(devices, wanted)
      if (wanted && !chosen && devices.length > 0) {
        notice = 'A câmera escolhida não está conectada; usando a câmera padrão.'
      }
      try {
        acquired = await open(chosen)
      } catch (error) {
        if (chosen === null || !isDeviceUnavailableError(error)) throw error
        notice = 'A câmera escolhida não está disponível; usando a câmera padrão.'
        acquired = await open(null)
      }
    } catch (error) {
      if (token !== startToken.current) return
      window.api.log('WARN', 'Falha ao iniciar a câmera', { error: String(error) })
      dispatch({ type: 'failed', message: describeCameraError(error) })
      return
    }

    if (token !== startToken.current) {
      acquired.getTracks().forEach((track) => track.stop()) // o usuário desligou no meio
      return
    }

    const [track] = acquired.getVideoTracks()
    track?.addEventListener('ended', () => {
      if (streamRef.current !== acquired) return
      window.api.log('WARN', 'Câmera desconectada durante o uso')
      release()
      dispatch({ type: 'failed', message: 'A câmera foi desconectada.' })
    })

    streamRef.current = acquired
    setStream(acquired)
    const video = videoRef.current
    if (video) {
      video.srcObject = acquired
      video.play().catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') {
          window.api.log('WARN', 'Falha ao exibir a câmera', { error: String(error) })
        }
      })
    }
    const deviceId = track?.getSettings().deviceId ?? ''
    dispatch({ type: 'started', deviceId, notice })
    window.api.log('INFO', 'Câmera ligada', { label: track?.label })
    void refreshDevices() // agora os nomes das câmeras estão disponíveis
  }, [open, refreshDevices, release, videoRef])

  const stop = useCallback((): void => {
    release()
    dispatch({ type: 'stopped' })
  }, [release])

  const toggle = useCallback((): void => {
    if (streamRef.current || state.status === 'starting') stop()
    else void start()
  }, [start, state.status, stop])

  const selectDevice = useCallback(
    (deviceId: string): void => {
      dispatch({ type: 'prefs', prefs: { deviceId } })
      prefsRef.current = { ...prefsRef.current, deviceId }
      if (streamRef.current) void start() // troca ao vivo
    },
    [start]
  )

  const setLayout = useCallback(
    (layout: CameraLayout): void => dispatch({ type: 'prefs', prefs: { layout } }),
    []
  )
  const setMirror = useCallback(
    (mirror: boolean): void => dispatch({ type: 'prefs', prefs: { mirror } }),
    []
  )
  const setAutoStart = useCallback(
    (autoStart: boolean): void => dispatch({ type: 'prefs', prefs: { autoStart } }),
    []
  )

  // Lista de câmeras + hot-plug. Adiado para fora do corpo do efeito (evita setState síncrono).
  useEffect(() => {
    const timer = window.setTimeout(() => void refreshDevices(), 0)
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
    return () => {
      window.clearTimeout(timer)
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
    }
  }, [refreshDevices])

  // Ao fechar/desmontar, a câmera precisa apagar a luz.
  useEffect(() => release, [release])

  return {
    state,
    stream,
    start,
    stop,
    toggle,
    selectDevice,
    setLayout,
    setMirror,
    setAutoStart
  }
}
