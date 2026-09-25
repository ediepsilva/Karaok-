import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { ReferenceNote } from '@shared/types'
import { totalLatencyMs, clampManualMs, type LatencyCalibration } from './latency'
import { describeMicError, isMicDeviceUnavailable } from './mic-errors'
import { MicEngine, listMicrophones, type MicDevice, type MicInfo } from './mic-engine'
import { shouldMicBeActive, type PlayerPhase } from './mic-policy'
import { PerformanceSession, type PerformanceResult } from './performance-session'
import type { FrameAnalysis, FrameState } from './voice-analyzer'
import { FINISH_GRACE_SEC, HOP_SAMPLES, PAUSE_RELEASE_SEC } from './voice-config'
import { parseVoicePrefs, type VoicePrefs } from './voice-prefs'

const PREFS_KEY = 'karaoke.voice'
/** Janela (quadros) do "% de voz" ao vivo: ~5 s. */
const RECENT_FRAMES = 470

function readPrefs(): VoicePrefs {
  try {
    return parseVoicePrefs(window.localStorage.getItem(PREFS_KEY))
  } catch {
    return parseVoicePrefs(null)
  }
}

export type MicStatus = 'off' | 'starting' | 'on' | 'error'

/** Leitura ao vivo para a tela de diagnóstico (atualizada ~10 vezes por segundo). */
export interface VoiceLive {
  dbfs: number
  frequency: number | null
  note: string | null
  cents: number | null
  clarity: number
  state: FrameState | 'idle'
  /** % do tempo com voz nos últimos ~5 s. */
  voicedPct: number
  noiseFloorDb: number
  roomNoisy: boolean
  clipping: boolean
  framesPerSec: number
  /** Quadros descartados por atraso do processamento nesta captura. */
  droppedFrames: number
}

const IDLE_LIVE: VoiceLive = {
  dbfs: -120,
  frequency: null,
  note: null,
  cents: null,
  clarity: 0,
  state: 'idle',
  voicedPct: 0,
  noiseFloorDb: -120,
  roomNoisy: false,
  clipping: false,
  framesPerSec: 0,
  droppedFrames: 0
}

export interface PerformanceView {
  running: boolean
  seconds: number
  voicedPct: number
}

/** Resultado de uma apresentação, com o contexto para exibir na tela. */
export interface VoiceResult extends PerformanceResult {
  songTitle: string
  singer: string
}

export interface VoiceInput {
  phase: PlayerPhase
  songId: number | null
  songDurationSec: number | null
  songTitle: string
  singer: string
  /** Melodia de referência (MIDI/KAR) da música, ou null: então a avaliação é a básica. */
  melody: readonly ReferenceNote[] | null
  audioRef: RefObject<HTMLAudioElement | null>
}

export interface VoiceController {
  prefs: VoicePrefs
  devices: MicDevice[]
  micStatus: MicStatus
  micError: string | null
  micNotice: string | null
  info: MicInfo | null
  live: VoiceLive
  latency: LatencyCalibration
  totalLatencyMs: number
  diagnosticsOn: boolean
  measuring: boolean
  latencyMessage: string | null
  performance: PerformanceView | null
  result: VoiceResult | null
  setEnabled(enabled: boolean): void
  setDeviceId(deviceId: string): void
  setManualLatency(ms: number): void
  clearMeasuredLatency(): void
  toggleDiagnostics(): void
  measureLatency(): Promise<void>
  clearResult(): void
}

interface SessionSlot {
  songId: number | null
  songTitle: string
  singer: string
  songDurationSec: number | null
  running: boolean
  session: PerformanceSession | null
  finishTimer: number | null
}

/**
 * Coordena microfone, análise e apresentação.
 *
 * Privacidade: o microfone só abre (a) no teste explícito ou (b) durante uma apresentação com a
 * avaliação habilitada, e é liberado ao terminar (pausas longas também liberam).
 */
export function useVoice(input: VoiceInput): VoiceController {
  const { phase, songId, songDurationSec, songTitle, singer, melody, audioRef } = input
  const [prefs, setPrefs] = useState<VoicePrefs>(readPrefs)
  const [devices, setDevices] = useState<MicDevice[]>([])
  const [micStatus, setMicStatus] = useState<MicStatus>('off')
  const [micError, setMicError] = useState<string | null>(null)
  const [micNotice, setMicNotice] = useState<string | null>(null)
  const [info, setInfo] = useState<MicInfo | null>(null)
  const [live, setLive] = useState<VoiceLive>(IDLE_LIVE)
  const [diagnosticsOn, setDiagnosticsOn] = useState(false)
  const [measuring, setMeasuring] = useState(false)
  const [latencyMessage, setLatencyMessage] = useState<string | null>(null)
  const [performanceView, setPerformanceView] = useState<PerformanceView | null>(null)
  const [result, setResult] = useState<VoiceResult | null>(null)
  const [pausedLong, setPausedLong] = useState(false)
  const [grace, setGrace] = useState(false)
  const [autoMs, setAutoMs] = useState(0)

  const latency: LatencyCalibration = {
    autoMs,
    measuredMs: prefs.measuredLatencyMs,
    manualMs: prefs.manualLatencyMs
  }

  // ---- refs: dados de alta frequência (não causam renderização) ----
  const engineRef = useRef<MicEngine | null>(null)
  const tokenRef = useRef(0)
  const desiredRef = useRef(false)
  const deviceRef = useRef(prefs.deviceId)
  const latencyRef = useRef(latency)
  const liveRef = useRef<VoiceLive>(IDLE_LIVE)
  const recentRef = useRef<{ flags: Uint8Array; head: number; count: number; voiced: number }>({
    flags: new Uint8Array(RECENT_FRAMES),
    head: 0,
    count: 0,
    voiced: 0
  })
  const frameCountRef = useRef(0)
  const slotRef = useRef<SessionSlot | null>(null)
  const graceRef = useRef(false)
  const melodyRef = useRef(melody)

  useEffect(() => {
    latencyRef.current = latency
    slotRef.current?.session?.setLatency(latency)
  })

  // A melodia chega de forma assíncrona: vale também para uma apresentação já iniciada.
  useEffect(() => {
    melodyRef.current = melody
    slotRef.current?.session?.setMelody(melody)
  }, [melody])

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      /* sem armazenamento: as preferências valem só nesta sessão */
    }
  }, [prefs])

  // ---------- quadros vindos do microfone ----------
  const handleFrame = useCallback(
    (a: FrameAnalysis, ageSec: number): void => {
      const engine = engineRef.current
      frameCountRef.current++
      // janela circular de ~5 s com contador (custo constante por quadro)
      const recent = recentRef.current
      const isVoice = a.state === 'voice' ? 1 : 0
      if (recent.count === RECENT_FRAMES) recent.voiced -= recent.flags[recent.head]!
      else recent.count++
      recent.flags[recent.head] = isVoice
      recent.voiced += isVoice
      recent.head = (recent.head + 1) % RECENT_FRAMES
      liveRef.current = {
        ...liveRef.current,
        dbfs: a.dbfs,
        frequency: a.frequency,
        note: a.note,
        cents: a.cents,
        clarity: a.clarity,
        state: a.state,
        voicedPct: recent.count > 0 ? (100 * recent.voiced) / recent.count : 0,
        droppedFrames: engine?.droppedFrames ?? 0,
        noiseFloorDb: a.noiseFloorDb,
        roomNoisy: engine?.roomIsNoisy ?? false,
        clipping: a.clipping
      }

      const slot = slotRef.current
      if (slot && slot.running && engine) {
        if (!slot.session) {
          slot.session = new PerformanceSession(
            HOP_SAMPLES / (engine.sampleRate || 48000),
            latencyRef.current,
            slot.songId,
            slot.songDurationSec,
            melodyRef.current
          )
          slot.session.start()
        }
        const audio = audioRef.current
        const playerTime = graceRef.current || !audio ? null : audio.currentTime - ageSec
        slot.session.addFrame(a, playerTime)
      }
    },
    [audioRef]
  )

  // ---------- abrir / fechar o microfone ----------
  const stopEngine = useCallback((): void => {
    tokenRef.current++
    const engine = engineRef.current
    const wasActive = engine?.active ?? false
    engine?.stop()
    if (wasActive) void window.api.voice.setActive(false)
    liveRef.current = IDLE_LIVE
    recentRef.current = { flags: new Uint8Array(RECENT_FRAMES), head: 0, count: 0, voiced: 0 }
    setMicStatus('off')
    setInfo(null)
    setLive(IDLE_LIVE)
  }, [])

  const startEngine = useCallback(
    async (deviceId: string): Promise<void> => {
      const token = ++tokenRef.current
      if (!engineRef.current) {
        engineRef.current = new MicEngine({
          onFrame: handleFrame,
          onEnded: () => {
            window.api.log('WARN', 'Microfone desconectado durante o uso')
            stopEngine()
            setMicStatus('error')
            setMicError('O microfone foi desconectado.')
          }
        })
      }
      const engine = engineRef.current
      setMicStatus('starting')
      setMicError(null)
      setMicNotice(null)
      try {
        let started: MicInfo
        let notice: string | null = null
        try {
          await window.api.voice.arm()
          started = await engine.start(deviceId)
        } catch (error) {
          if (!deviceId || !isMicDeviceUnavailable(error)) throw error
          notice = 'O microfone escolhido não está disponível; usando o microfone padrão.'
          await window.api.voice.arm()
          started = await engine.start('')
        }
        if (token !== tokenRef.current || !desiredRef.current) {
          engine.stop() // o usuário desligou no meio
          return
        }
        await window.api.voice.setActive(true)
        frameCountRef.current = 0
        setInfo(started)
        setAutoMs(started.autoLatencyMs)
        setMicNotice(notice)
        setMicStatus('on')
        window.api.log('INFO', 'Microfone ligado', {
          label: started.label,
          sampleRate: started.sampleRate,
          autoLatencyMs: started.autoLatencyMs
        })
        void listMicrophones().then(setDevices)
      } catch (error) {
        engine.stop()
        if (token !== tokenRef.current) return
        window.api.log('WARN', 'Falha ao iniciar o microfone', { error: String(error) })
        setMicStatus('error')
        setMicError(describeMicError(error))
      }
    },
    [handleFrame, stopEngine]
  )

  // Política de privacidade: quando o microfone pode estar aberto.
  const micDesired =
    shouldMicBeActive({
      evaluationEnabled: prefs.enabled,
      diagnosticsOn,
      phase,
      pausedForSec: pausedLong ? PAUSE_RELEASE_SEC : 0
    }) || grace

  useEffect(() => {
    desiredRef.current = micDesired
    deviceRef.current = prefs.deviceId
    // Adiado para fora do corpo do efeito (e agrupa mudanças rápidas de estado).
    const timer = window.setTimeout(() => {
      if (!micDesired) {
        if (engineRef.current?.active) stopEngine()
        return
      }
      const engine = engineRef.current
      if (engine?.active) {
        // já aberto: só reabre se o usuário trocou de dispositivo
        const current = info?.deviceId ?? ''
        if (prefs.deviceId && current && prefs.deviceId !== current)
          void startEngine(prefs.deviceId)
        return
      }
      void startEngine(prefs.deviceId)
    }, 0)
    return () => window.clearTimeout(timer)
    // `info` só é lido para detectar troca de dispositivo; não deve reiniciar a captura sozinho.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micDesired, prefs.deviceId, startEngine, stopEngine])

  // Pausa longa libera o microfone (ele reabre ao retomar).
  useEffect(() => {
    if (phase !== 'paused') return
    const timer = window.setTimeout(() => setPausedLong(true), PAUSE_RELEASE_SEC * 1000)
    return () => {
      window.clearTimeout(timer)
      setPausedLong(false)
    }
  }, [phase])

  // Ao fechar o app/desmontar: o microfone precisa ser liberado.
  useEffect(
    () => () => {
      tokenRef.current++
      if (engineRef.current?.active) void window.api.voice.setActive(false)
      engineRef.current?.stop()
    },
    []
  )

  // Lista de microfones + hot-plug.
  useEffect(() => {
    const refresh = (): void => {
      void listMicrophones().then(setDevices)
    }
    const timer = window.setTimeout(refresh, 0)
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => {
      window.clearTimeout(timer)
      navigator.mediaDevices.removeEventListener('devicechange', refresh)
    }
  }, [])

  // ---------- apresentação (início / pausa / fim) ----------
  const finalize = useCallback((slot: SessionSlot): void => {
    if (slot.finishTimer !== null) window.clearTimeout(slot.finishTimer)
    slot.finishTimer = null
    slot.running = false
    if (slotRef.current === slot) slotRef.current = null
    graceRef.current = false
    setGrace(false)
    const session = slot.session
    if (!session) return
    const finished = session.finish()
    setResult({ ...finished, songTitle: slot.songTitle, singer: slot.singer })
    setPerformanceView(null)
    window.api.log('INFO', 'Avaliação concluída', {
      songId: slot.songId,
      mode: finished.primary,
      score: finished.primary === 'reference' ? finished.reference?.score : finished.score.score,
      basicScore: finished.score.score,
      referenceNotes: finished.reference?.notesEvaluated,
      transposeSemitones: finished.reference?.transposeSemitones,
      durationSec: Math.round(finished.summary.durationSec),
      voicedFraction: Number(finished.summary.voicedFraction.toFixed(3)),
      formulaVersion: finished.score.formulaVersion
    })
  }, [])

  useEffect(() => {
    // Toda a lógica de sessão roda adiada (evita setState síncrono dentro do efeito).
    const timer = window.setTimeout(() => {
      let slot = slotRef.current
      if (!prefs.enabled) {
        if (slot) {
          if (slot.finishTimer !== null) window.clearTimeout(slot.finishTimer)
          slotRef.current = null // avaliação desligada: descarta sem nota
          graceRef.current = false
          setGrace(false)
          setPerformanceView(null)
        }
        return
      }
      if (phase === 'loading' || phase === 'playing') {
        if (slot && slot.songId !== songId) {
          finalize(slot) // trocou de música: encerra a anterior
          slot = null
        }
        if (slot && slot.finishTimer !== null) {
          finalize(slot) // recomeçou durante a tolerância: encerra e abre outra
          slot = null
        }
        if (!slot) {
          slot = {
            songId,
            songTitle,
            singer,
            songDurationSec,
            running: false,
            session: null,
            finishTimer: null
          }
          slotRef.current = slot
        }
        slot.running = phase === 'playing'
        if (slot.session) {
          if (phase === 'playing') slot.session.resume()
          else slot.session.pause()
        }
      } else if (phase === 'paused') {
        if (slot) {
          slot.running = false
          slot.session?.pause()
        }
      } else if (slot && slot.finishTimer === null) {
        // parou/terminou: espera os últimos quadros do microfone (latência) e encerra
        const graceMs = (FINISH_GRACE_SEC + totalLatencyMs(latencyRef.current) / 1000) * 1000
        graceRef.current = true
        setGrace(true)
        const target = slot
        slot.finishTimer = window.setTimeout(() => finalize(target), graceMs)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [phase, songId, prefs.enabled, songTitle, singer, songDurationSec, finalize])

  // ---------- atualização da interface (~10x/s) ----------
  useEffect(() => {
    if (micStatus !== 'on') return
    let last = window.performance.now()
    const timer = window.setInterval(() => {
      const now = window.performance.now()
      const dt = (now - last) / 1000
      last = now
      const fps = dt > 0 ? frameCountRef.current / dt : 0
      frameCountRef.current = 0
      liveRef.current = { ...liveRef.current, framesPerSec: fps }
      setLive(liveRef.current)
      const slot = slotRef.current
      const session = slot?.session
      setPerformanceView(
        slot && session
          ? {
              running: session.isRunning,
              seconds: session.elapsedSec,
              voicedPct: session.voicedFraction * 100
            }
          : null
      )
    }, 100)
    return () => window.clearInterval(timer)
  }, [micStatus])

  // ---------- ações ----------
  const setEnabled = useCallback((enabled: boolean): void => {
    setPrefs((p) => ({ ...p, enabled }))
  }, [])
  const setDeviceId = useCallback((deviceId: string): void => {
    setPrefs((p) => ({ ...p, deviceId }))
  }, [])
  const setManualLatency = useCallback((ms: number): void => {
    setPrefs((p) => ({ ...p, manualLatencyMs: clampManualMs(ms) }))
  }, [])
  const clearMeasuredLatency = useCallback((): void => {
    setPrefs((p) => ({ ...p, measuredLatencyMs: null }))
    setLatencyMessage('Medição removida: usando a latência informada pelo sistema.')
  }, [])
  const toggleDiagnostics = useCallback((): void => setDiagnosticsOn((v) => !v), [])

  const measureLatency = useCallback(async (): Promise<void> => {
    const engine = engineRef.current
    if (!engine?.active) {
      setLatencyMessage('Ligue “Testar microfone” antes de medir a latência.')
      return
    }
    setMeasuring(true)
    setLatencyMessage(
      'Medindo… mantenha o ambiente em silêncio e o volume do alto-falante audível.'
    )
    try {
      const ms = await engine.measureRoundTrip()
      if (ms === null) {
        setLatencyMessage(
          'Não foi possível medir: o microfone não ouviu os cliques de forma consistente. ' +
            'A medição exige alto-falantes (não fones) e silêncio. Você pode ajustar manualmente.'
        )
      } else {
        setPrefs((p) => ({ ...p, measuredLatencyMs: ms }))
        setLatencyMessage(`Latência de ida e volta medida: ${ms} ms (aplicada).`)
      }
    } catch (error) {
      window.api.log('WARN', 'Falha ao medir latência', { error: String(error) })
      setLatencyMessage('Falha ao medir a latência.')
    } finally {
      setMeasuring(false)
    }
  }, [])

  return {
    prefs,
    devices,
    micStatus,
    micError,
    micNotice,
    info,
    live,
    latency,
    totalLatencyMs: totalLatencyMs(latency),
    diagnosticsOn,
    measuring,
    latencyMessage,
    performance: performanceView,
    result,
    setEnabled,
    setDeviceId,
    setManualLatency,
    clearMeasuredLatency,
    toggleDiagnostics,
    measureLatency,
    clearResult: () => setResult(null)
  }
}
