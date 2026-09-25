import type { FrameAnalysis } from './voice-analyzer'
import {
  GAP_TOLERANCE_SEC,
  MIN_RUN_SEC,
  STABILITY_TOLERANCE_CENTS,
  STABILITY_WINDOW
} from './voice-config'

/** Resumo de uma apresentação: só fatos medidos, sem julgamento musical. */
export interface VoiceSummary {
  /** Tempo analisado (s), somando só os quadros recebidos durante a apresentação. */
  durationSec: number
  voicedSec: number
  voicedFraction: number
  noiseFraction: number
  silenceFraction: number
  clippingFraction: number
  /** Maior trecho contínuo sem voz (s), silêncio ou ruído. */
  longestGapSec: number
  /** Corridas de voz (com lacunas curtas fundidas) de pelo menos MIN_RUN_SEC. */
  voicedRunCount: number
  meanRunSec: number
  longestRunSec: number
  /** Fração dos quadros de voz cujo pitch ficou perto da mediana local (0–1). */
  stableFraction: number
  /** Mediana do ruído ambiente (dBFS) durante a apresentação. */
  ambientNoiseDb: number
  /** Nível médio (dBFS) dos quadros de voz. */
  meanVoiceDb: number
}

/** Um ponto da linha do tempo de pitch (guardada para a futura comparação com melodia, Fase 4B). */
export interface PitchPoint {
  /** Tempo da música (s), já compensado pela latência; null se não havia música tocando. */
  songTime: number | null
  frequency: number | null
  clarity: number
  dbfs: number
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

/**
 * Acumula quadros analisados e produz o resumo. Cada quadro cobre `dt` segundos (por padrão,
 * `frameSec`). Se o processamento atrasar e quadros forem descartados, quem chama informa o
 * intervalo real (`dt`): as durações continuam sendo tempo decorrido, não contagem de quadros.
 * Lacunas curtas (≤ GAP_TOLERANCE_SEC) entre quadros de voz não interrompem a "corrida" de voz.
 */
export class VoiceMetrics {
  private frames = 0
  private elapsed = 0
  private voicedSec = 0
  private noiseSec = 0
  private silenceSec = 0
  private clippingSec = 0
  private stableSec = 0
  private voiceDbWeighted = 0

  private runs: number[] = []
  private runStart = -1 // tempo (s) em que a corrida atual começou
  private lastVoiceEnd = 0
  private gapStart = 0
  private longestGap = 0

  private recentMidi: number[] = []
  private noiseFloors: number[] = []
  private readonly points: PitchPoint[] = []

  constructor(private readonly frameSec: number) {}

  get frameCount(): number {
    return this.frames
  }

  get elapsedSec(): number {
    return this.elapsed
  }

  get voicedFraction(): number {
    return this.elapsed === 0 ? 0 : this.voicedSec / this.elapsed
  }

  get pitchTrack(): readonly PitchPoint[] {
    return this.points
  }

  add(frame: FrameAnalysis, songTime: number | null = null, dtSec: number = this.frameSec): void {
    const start = this.elapsed
    const end = start + dtSec
    this.elapsed = end
    if (this.frames++ % 10 === 0) this.noiseFloors.push(frame.noiseFloorDb)
    if (frame.clipping) this.clippingSec += dtSec
    this.points.push({
      songTime,
      frequency: frame.frequency,
      clarity: frame.clarity,
      dbfs: frame.dbfs
    })

    if (frame.state === 'voice') {
      this.voicedSec += dtSec
      this.voiceDbWeighted += frame.dbfs * dtSec
      if (this.runStart < 0) {
        this.runStart = start
      } else if (start - this.lastVoiceEnd > GAP_TOLERANCE_SEC) {
        this.closeRun() // zera a mediana local: a nova corrida não herda o pitch da anterior
        this.runStart = start
      }
      this.lastVoiceEnd = end
      this.trackStability(frame.midi, dtSec)
      this.longestGap = Math.max(this.longestGap, start - this.gapStart)
      this.gapStart = end
    } else {
      if (frame.state === 'noise') this.noiseSec += dtSec
      else this.silenceSec += dtSec
      this.longestGap = Math.max(this.longestGap, end - this.gapStart)
    }
  }

  private trackStability(midi: number | null, dtSec: number): void {
    if (midi === null) return
    if (this.recentMidi.length >= STABILITY_WINDOW) {
      const local = median(this.recentMidi)
      if (Math.abs(midi - local) * 100 <= STABILITY_TOLERANCE_CENTS) this.stableSec += dtSec
    } else {
      this.stableSec += dtSec // ainda sem histórico: não penaliza o início
    }
    this.recentMidi.push(midi)
    if (this.recentMidi.length > STABILITY_WINDOW) this.recentMidi.shift()
  }

  private closeRun(): void {
    if (this.runStart < 0) return
    const length = this.lastVoiceEnd - this.runStart
    if (length >= MIN_RUN_SEC) this.runs.push(length)
    this.runStart = -1
    this.recentMidi = [] // nova corrida: a mediana local recomeça
  }

  summary(): VoiceSummary {
    // Fecha a corrida em andamento sem alterar o estado (o resumo pode ser pedido várias vezes).
    const runs = [...this.runs]
    if (this.runStart >= 0) {
      const length = this.lastVoiceEnd - this.runStart
      if (length >= MIN_RUN_SEC) runs.push(length)
    }
    const total = this.elapsed
    const fraction = (seconds: number): number => (total === 0 ? 0 : seconds / total)
    return {
      durationSec: total,
      voicedSec: this.voicedSec,
      voicedFraction: fraction(this.voicedSec),
      noiseFraction: fraction(this.noiseSec),
      silenceFraction: fraction(this.silenceSec),
      clippingFraction: fraction(this.clippingSec),
      longestGapSec: total === 0 ? 0 : this.longestGap,
      voicedRunCount: runs.length,
      meanRunSec: runs.length === 0 ? 0 : runs.reduce((a, b) => a + b, 0) / runs.length,
      longestRunSec: runs.length === 0 ? 0 : Math.max(...runs),
      stableFraction: this.voicedSec === 0 ? 0 : this.stableSec / this.voicedSec,
      ambientNoiseDb: median(this.noiseFloors),
      meanVoiceDb: this.voicedSec === 0 ? -120 : this.voiceDbWeighted / this.voicedSec
    }
  }
}
