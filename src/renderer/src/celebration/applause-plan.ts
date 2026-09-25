import {
  APPLAUSE_CHEER_SCORE,
  APPLAUSE_MAX_CLAPS,
  APPLAUSE_MAX_DURATION_SEC,
  APPLAUSE_MAX_PEAK_GAIN,
  APPLAUSE_MIN_CLAPS,
  APPLAUSE_MIN_DURATION_SEC,
  APPLAUSE_MIN_PEAK_GAIN
} from './celebration-config'

export interface ApplausePlan {
  /** Número de palmas individuais espalhadas pela duração. */
  claps: number
  /** Volume de pico (0–1) do "tapete" de aplausos. */
  peakGain: number
  /** Duração total dos aplausos (s). */
  durationSec: number
  /** Nota alta o bastante para incluir assobios/gritos de torcida. */
  cheer: boolean
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * Quanto maior a nota, mais palmas, mais alto e mais longo. Uma nota 0 ainda gera uma salva de
 * palmas educada (nunca silêncio total): ninguém sai do palco sem aplauso nenhum.
 */
export function computeApplausePlan(score: number): ApplausePlan {
  const t = clamp01(score / 100)
  return {
    claps: Math.round(lerp(APPLAUSE_MIN_CLAPS, APPLAUSE_MAX_CLAPS, t)),
    peakGain: lerp(APPLAUSE_MIN_PEAK_GAIN, APPLAUSE_MAX_PEAK_GAIN, t),
    durationSec: lerp(APPLAUSE_MIN_DURATION_SEC, APPLAUSE_MAX_DURATION_SEC, t),
    cheer: score >= APPLAUSE_CHEER_SCORE
  }
}
