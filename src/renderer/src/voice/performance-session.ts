import type { ReferenceNote } from '@shared/types'
import { computeBasicScore, type BasicScore } from './basic-score'
import { EVALUATION_PROFILES, type EvaluationProfile } from './evaluation-profile'
import { compensateSongTime, type LatencyCalibration } from './latency'
import { computeReferenceScore, type ReferenceScore } from './reference-score'
import type { FrameAnalysis } from './voice-analyzer'
import { MAX_FRAME_GAP_SEC } from './voice-config'
import { VoiceMetrics, type PitchPoint, type VoiceSummary } from './voice-metrics'

export interface PerformanceResult {
  songId: number | null
  songDurationSec: number | null
  /** Fração da música coberta pela apresentação (0–1), ou null se a duração é desconhecida. */
  completedFraction: number | null
  summary: VoiceSummary
  /** AVALIAÇÃO BÁSICA: sempre calculada (complementa a avaliação com melodia). */
  score: BasicScore
  /** AVALIAÇÃO COM MELODIA DE REFERÊNCIA, se a música tem melodia (MIDI/KAR); senão null. */
  reference: ReferenceScore | null
  /** Qual nota apresentar: a com melodia quando ela pôde ser calculada, senão a básica. */
  primary: 'reference' | 'basic'
  /** Nível de dificuldade usado nesta apresentação (Amador/Semiprofissional/Profissional). */
  evaluationProfile: EvaluationProfile
  /** Linha do tempo de pitch (tempo da música já compensado pela latência). */
  track: readonly PitchPoint[]
  finishedAt: string
}

/**
 * Uma apresentação: recebe os quadros do microfone SOMENTE enquanto a música toca (iniciar/pausar/
 * retomar), aplica a compensação de latência ao tempo de cada quadro e, no fim, produz o resumo e
 * a nota da AVALIAÇÃO BÁSICA (sempre) e, se houver melodia de referência, da AVALIAÇÃO COM
 * MELODIA DE REFERÊNCIA.
 */
export class PerformanceSession {
  private readonly metrics: VoiceMetrics
  private running = false
  private latency: LatencyCalibration
  private lastFrameTime: number | null = null
  private melody: readonly ReferenceNote[] | null

  constructor(
    private readonly frameSec: number,
    latency: LatencyCalibration,
    private readonly songId: number | null = null,
    private readonly songDurationSec: number | null = null,
    melody: readonly ReferenceNote[] | null = null,
    private readonly profile: EvaluationProfile = EVALUATION_PROFILES.semiPro
  ) {
    this.metrics = new VoiceMetrics(frameSec)
    this.latency = latency
    this.melody = melody
  }

  /** A melodia pode chegar depois do início (leitura do MIDI/KAR é assíncrona). */
  setMelody(melody: readonly ReferenceNote[] | null): void {
    this.melody = melody
  }

  get isRunning(): boolean {
    return this.running
  }

  get voicedFraction(): number {
    return this.metrics.voicedFraction
  }

  get frameCount(): number {
    return this.metrics.frameCount
  }

  /** Tempo analisado (s), medido pelo relógio do microfone. */
  get elapsedSec(): number {
    return this.metrics.elapsedSec
  }

  setLatency(latency: LatencyCalibration): void {
    this.latency = latency
  }

  start(): void {
    this.running = true
    this.lastFrameTime = null
  }

  pause(): void {
    this.running = false
    this.lastFrameTime = null // o tempo parado não conta como tempo de apresentação
  }

  resume(): void {
    this.running = true
    this.lastFrameTime = null
  }

  /** Devolve true se o quadro foi contabilizado (só enquanto a apresentação está rodando). */
  addFrame(frame: FrameAnalysis, playerTimeSec: number | null): boolean {
    if (!this.running) return false
    const songTime = playerTimeSec === null ? null : compensateSongTime(playerTimeSec, this.latency)
    // Intervalo real desde o quadro anterior (se quadros foram descartados, o tempo continua certo).
    const gap = this.lastFrameTime === null ? this.frameSec : frame.time - this.lastFrameTime
    this.lastFrameTime = frame.time
    const dt = gap > 0 && gap <= MAX_FRAME_GAP_SEC ? gap : this.frameSec
    this.metrics.add(frame, songTime, dt)
    return true
  }

  finish(): PerformanceResult {
    this.running = false
    const summary = this.metrics.summary()
    const completed =
      this.songDurationSec !== null && this.songDurationSec > 0
        ? Math.min(1, summary.durationSec / this.songDurationSec)
        : null
    const reference =
      this.melody && this.melody.length > 0
        ? computeReferenceScore(this.metrics.pitchTrack, this.melody, { profile: this.profile })
        : null
    return {
      songId: this.songId,
      songDurationSec: this.songDurationSec,
      completedFraction: completed,
      summary,
      score: computeBasicScore(summary, this.profile),
      reference,
      primary: reference !== null && reference.score !== null ? 'reference' : 'basic',
      evaluationProfile: this.profile,
      track: this.metrics.pitchTrack,
      finishedAt: new Date().toISOString()
    }
  }
}
