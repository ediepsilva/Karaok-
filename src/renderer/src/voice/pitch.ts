import { MAX_FREQ_HZ, MIN_FREQ_HZ, MPM_PEAK_RATIO } from './voice-config'

/**
 * Detecção de frequência fundamental pelo método MPM (McLeod Pitch Method: função de diferença
 * quadrada normalizada + escolha do primeiro pico relevante + interpolação parabólica).
 * Implementação própria, sem dependências.
 */

export interface PitchResult {
  /** Hz, ou null se não houver pico confiável no intervalo. */
  frequency: number | null
  /** 0–1: quão periódico é o sinal (≈1 = tom limpo; baixo = ruído/fala sussurrada). */
  clarity: number
}

export interface NoteInfo {
  /** MIDI fracionário (69 = A4 = 440 Hz). */
  midi: number
  /** Nome da nota mais próxima, ex.: "A4", "C#3". */
  name: string
  /** Desvio (-50..+50) em centésimos de semitom em relação à nota mais próxima. */
  cents: number
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export function frequencyToNote(frequency: number): NoteInfo {
  const midi = 69 + 12 * Math.log2(frequency / 440)
  const nearest = Math.round(midi)
  const index = ((nearest % 12) + 12) % 12
  return {
    midi,
    name: `${NOTE_NAMES[index]}${Math.floor(nearest / 12) - 1}`,
    cents: Math.round((midi - nearest) * 100)
  }
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Nível do quadro: RMS, pico e RMS em dBFS (mínimo -120). */
export function frameLevel(samples: Float32Array): { rms: number; peak: number; dbfs: number } {
  let sum = 0
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0
    sum += v * v
    const a = Math.abs(v)
    if (a > peak) peak = a
  }
  const rms = samples.length > 0 ? Math.sqrt(sum / samples.length) : 0
  return { rms, peak, dbfs: rms > 1e-6 ? 20 * Math.log10(rms) : -120 }
}

/** Reduz a taxa por média de blocos (passa-baixa simples) para acelerar a análise. */
function decimate(samples: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return samples
  const out = new Float32Array(Math.floor(samples.length / factor))
  for (let i = 0; i < out.length; i++) {
    let sum = 0
    const base = i * factor
    for (let k = 0; k < factor; k++) sum += samples[base + k]!
    out[i] = sum / factor
  }
  return out
}

export interface DetectOptions {
  minFrequency?: number
  maxFrequency?: number
}

/** Taxa da busca grosseira (barata) e da etapa de refinamento (precisa), em Hz. */
const COARSE_RATE = 8000
const FINE_RATE = 16000

/** NSDF para um único atraso τ (custo O(n)); usado só no refinamento, em poucos atrasos. */
function nsdfAt(x: Float32Array, tau: number): number {
  const limit = x.length - tau
  if (tau < 0 || limit <= 0) return 0
  let acf = 0
  let m = 0
  for (let i = 0; i < limit; i++) {
    const a = x[i]!
    const b = x[i + tau]!
    acf += a * b
    m += a * a + b * b
  }
  return m > 0 ? (2 * acf) / m : 0
}

/** Vértice da parábola por 3 pontos (y0,y1,y2 em τ-1,τ,τ+1): deslocamento e valor no pico. */
function parabolicPeak(y0: number, y1: number, y2: number): { shift: number; value: number } {
  const denom = y0 - 2 * y1 + y2
  const shift = denom !== 0 ? Math.max(-1, Math.min(1, (0.5 * (y0 - y2)) / denom)) : 0
  return { shift, value: y1 - 0.25 * (y0 - y2) * shift }
}

/**
 * Frequência fundamental em duas etapas, para custar pouco no tempo real:
 *  1. busca grosseira do primeiro pico relevante (MPM) a ~8 kHz, com m(τ) por recorrência;
 *  2. refinamento em apenas 7 atrasos ao redor do pico, a ~16 kHz, com interpolação parabólica.
 */
export function detectPitch(
  input: Float32Array,
  sampleRate: number,
  options: DetectOptions = {}
): PitchResult {
  const none: PitchResult = { frequency: null, clarity: 0 }
  const coarseFactor = Math.max(1, Math.round(sampleRate / COARSE_RATE))
  const x = decimate(input, coarseFactor)
  const rate = sampleRate / coarseFactor
  const n = x.length
  const minTau = Math.max(2, Math.floor(rate / (options.maxFrequency ?? MAX_FREQ_HZ)))
  const maxTau = Math.min(
    Math.floor(n / 2),
    Math.ceil(rate / (options.minFrequency ?? MIN_FREQ_HZ))
  )
  if (n < 32 || maxTau <= minTau + 2) return none

  // Função de diferença quadrada normalizada: nsdf[τ] = 2·r(τ) / m(τ), com
  // m(τ) = Σ (x[i]² + x[i+τ]²) obtido por recorrência: m(τ) = m(τ-1) - x[τ-1]² - x[n-τ]².
  const nsdf = new Float32Array(maxTau + 2)
  let m = 0
  for (let i = 0; i < n; i++) m += 2 * x[i]! * x[i]!
  if (m < 1e-10) return none
  const last = Math.min(maxTau + 1, n - 1)
  for (let tau = 0; tau <= last; tau++) {
    let acf = 0
    const limit = n - tau
    for (let i = 0; i < limit; i++) acf += x[i]! * x[i + tau]!
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0
    m -= x[tau]! * x[tau]! + x[n - 1 - tau]! * x[n - 1 - tau]!
  }

  // Picos: máximo local entre cruzamentos de zero (subida) do nsdf.
  const peaks: number[] = []
  let tau = 1
  while (tau < maxTau && nsdf[tau]! > 0) tau++ // pula o lóbulo inicial (τ ≈ 0)
  while (tau < maxTau + 1) {
    while (tau < maxTau + 1 && nsdf[tau]! <= 0) tau++
    let best = -1
    let bestValue = -Infinity
    while (tau < maxTau + 1 && nsdf[tau]! > 0) {
      if (nsdf[tau]! > bestValue) {
        bestValue = nsdf[tau]!
        best = tau
      }
      tau++
    }
    if (best >= minTau && best <= maxTau) peaks.push(best)
  }
  if (peaks.length === 0) return none

  let highest = 0
  for (const p of peaks) highest = Math.max(highest, nsdf[p]!)
  const chosen = peaks.find((p) => nsdf[p]! >= MPM_PEAK_RATIO * highest) ?? peaks[0]
  if (chosen === undefined) return none

  const coarse = parabolicPeak(nsdf[chosen - 1]!, nsdf[chosen]!, nsdf[chosen + 1]!)
  let period = chosen + coarse.shift
  let periodRate = rate
  let clarity = coarse.value

  // Etapa 2: refinamento em taxa maior, só ao redor do pico encontrado.
  const fineFactor = Math.max(1, Math.round(sampleRate / FINE_RATE))
  if (fineFactor < coarseFactor) {
    const fine = decimate(input, fineFactor)
    const fineRate = sampleRate / fineFactor
    const center = Math.round((period * fineRate) / rate)
    if (center - 3 >= 1 && center + 3 < fine.length / 2) {
      const values: number[] = []
      for (let t = center - 3; t <= center + 3; t++) values.push(nsdfAt(fine, t))
      let bestIndex = 1
      for (let i = 1; i <= 5; i++) if (values[i]! > values[bestIndex]!) bestIndex = i
      const refined = parabolicPeak(
        values[bestIndex - 1]!,
        values[bestIndex]!,
        values[bestIndex + 1]!
      )
      period = center - 3 + bestIndex + refined.shift
      periodRate = fineRate
      clarity = refined.value
    }
  }

  const frequency = periodRate / period
  if (!Number.isFinite(frequency) || frequency <= 0) return none
  return { frequency, clarity: Math.max(0, Math.min(1, clarity)) }
}
