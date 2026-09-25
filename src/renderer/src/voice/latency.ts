import { MANUAL_LATENCY_MAX_MS, MANUAL_LATENCY_MIN_MS } from './voice-config'

/**
 * Compensação de latência. O que o cantor ouve chega atrasado (saída do áudio) e a voz dele só é
 * capturada depois (entrada do microfone). Sem compensar, um hardware lento pareceria "cantar
 * atrasado". O tempo da música associado a um quadro do microfone é:
 *
 *   tempoDaMúsica = tempoDoPlayerNaAmostra − (latência de saída + latência de entrada + ajuste)
 */
export interface LatencyCalibration {
  /** Estimativa automática (ms) informada pelo navegador/áudio: saída + entrada. */
  autoMs: number
  /** Ida e volta medida por clique alto-falante → microfone (ms), quando o usuário mediu. */
  measuredMs: number | null
  /** Ajuste fino manual (ms, pode ser negativo). */
  manualMs: number
}

export const DEFAULT_LATENCY: LatencyCalibration = { autoMs: 0, measuredMs: null, manualMs: 0 }

export const clampManualMs = (ms: number): number =>
  Math.round(
    Math.max(MANUAL_LATENCY_MIN_MS, Math.min(MANUAL_LATENCY_MAX_MS, Number.isFinite(ms) ? ms : 0))
  )

/** Latência base: a medida (mais confiável) se existir, senão a automática. */
export function baseLatencyMs(c: LatencyCalibration): number {
  return c.measuredMs ?? c.autoMs
}

export function totalLatencyMs(c: LatencyCalibration): number {
  return Math.max(0, baseLatencyMs(c) + c.manualMs)
}

export function compensateSongTime(playerTimeSec: number, c: LatencyCalibration): number {
  return Math.max(0, playerTimeSec - totalLatencyMs(c) / 1000)
}

/** Soma das latências reportadas pelo navegador (segundos → ms). Valores ausentes contam 0. */
export function autoLatencyMs(parts: {
  baseLatency?: number
  outputLatency?: number
  inputLatency?: number
}): number {
  const seconds = [parts.baseLatency, parts.outputLatency, parts.inputLatency]
    .map((v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0))
    .reduce((a, b) => a + b, 0)
  return Math.round(seconds * 1000)
}

/**
 * Atraso (ms) entre o instante em que um clique começou a ser emitido (`emitIndex`, em amostras
 * do mesmo relógio) e o primeiro som acima do ruído gravado no microfone. Null se não houver.
 */
export function findClickDelay(
  recorded: Float32Array,
  sampleRate: number,
  emitIndex: number,
  maxDelayMs = 800
): number | null {
  const before = recorded.subarray(Math.max(0, emitIndex - Math.round(0.3 * sampleRate)), emitIndex)
  let sum = 0
  for (const v of before) sum += v * v
  const noiseRms = before.length > 0 ? Math.sqrt(sum / before.length) : 0
  const threshold = Math.max(0.02, noiseRms * 8)
  const end = Math.min(recorded.length, emitIndex + Math.round((maxDelayMs / 1000) * sampleRate))
  for (let i = emitIndex; i < end; i++) {
    if (Math.abs(recorded[i] ?? 0) > threshold) return ((i - emitIndex) / sampleRate) * 1000
  }
  return null
}

/**
 * Combina várias medições de clique: exige ao menos 2 válidas e pouca dispersão (≤ 15 ms),
 * senão devolve null (a medição não é confiável e não deve ser aplicada).
 */
export function aggregateLoopback(delays: (number | null)[]): number | null {
  const valid = delays.filter((d): d is number => d !== null).sort((a, b) => a - b)
  if (valid.length < 2) return null
  const spread = (valid[valid.length - 1] ?? 0) - (valid[0] ?? 0)
  if (spread > 15) return null
  const mid = Math.floor(valid.length / 2)
  const median = valid.length % 2 ? valid[mid]! : (valid[mid - 1]! + valid[mid]!) / 2
  return Math.round(median)
}
