import type { ReferenceNote } from '@shared/types'
import { MODE_LABELS } from './reference'
import type { PitchPoint } from './voice-metrics'
import {
  CONSISTENCY_HIGH_CENTS,
  CONSISTENCY_LOW_CENTS,
  MIN_NOTE_FRAMES,
  MIN_REFERENCE_NOTES,
  MIN_REFERENCE_NOTE_SEC,
  NOTE_HIT_CENTS,
  ONSET_FULL_SEC,
  ONSET_HOLD_SEC,
  ONSET_SEARCH_AFTER_SEC,
  ONSET_SEARCH_BEFORE_SEC,
  ONSET_TOLERANCE_CENTS,
  ONSET_ZERO_SEC,
  PHRASE_GAP_SEC,
  PITCH_FULL_CENTS,
  PITCH_ZERO_CENTS,
  PRESENCE_FULL_FRACTION,
  RANGE_SLACK_SEC,
  REFERENCE_FORMULA_VERSION,
  REFERENCE_GATE_MIN_PRESENCE,
  REFERENCE_WEIGHTS,
  SUSTAIN_FULL_FRACTION,
  SUSTAIN_TOLERANCE_CENTS,
  ATTACK_TRIM_SEC,
  TRANSPOSE_MAX_RESIDUAL_SEMITONES,
  TRANSPOSE_MIN_CONSISTENCY,
  TRANSPOSE_MIN_SEMITONES,
  VOICE_CLARITY_MIN
} from './voice-config'

export interface ReferenceComponents {
  /** Afinação: proximidade do pitch cantado ao da nota (quadro a quadro). */
  pitch: number
  /** Notas corretas: fração (por duração) das notas acertadas. */
  notes: number
  /** Ritmo: pontualidade da entrada de cada nota; null se nenhuma entrada é mensurável. */
  rhythm: number | null
  /** Entrada das frases: pontualidade da primeira nota de cada frase; null se não mensurável. */
  phrases: number | null
  /** Duração: quanto de cada nota foi sustentado dentro do pitch. */
  duration: number
  /** Percentual cantado: fração do tempo das notas com voz. */
  presence: number
  /** Consistência: estabilidade do pitch dentro de cada nota. */
  consistency: number
}

export interface NoteResult {
  start: number
  midi: number
  /** 0–1: afinação média dos quadros de voz da nota. */
  pitch: number
  /** Atraso da entrada em ms (positivo = entrou depois), ou null se não mensurável/não cantou. */
  onsetMs: number | null
  hit: boolean
  sung: boolean
}

export interface ReferenceScore {
  mode: 'reference'
  label: string
  formulaVersion: number
  score: number | null
  insufficientReason: string | null
  components: ReferenceComponents
  /** Transposição detectada (semitons, oitava ignorada): 0 = no tom da melodia. */
  transposeSemitones: number
  notesEvaluated: number
  notesHit: number
  /** Mediana do atraso das entradas (ms), ou null. */
  medianOnsetMs: number | null
  perNote: NoteResult[]
}

export interface ReferenceOptions {
  /** Aceita cantar num tom diferente (mede a afinação relativa). Padrão: true. */
  allowTransposition?: boolean
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

/** Diferença de tom em semitons ignorando a oitava, no intervalo (-6, 6]. */
export function wrapSemitones(delta: number): number {
  let d = ((delta % 12) + 12) % 12
  if (d > 6) d -= 12
  return d
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** Mediana ponderada. */
function weightedMedian(values: { value: number; weight: number }[]): number {
  const s = [...values].sort((a, b) => a.value - b.value)
  const total = s.reduce((n, v) => n + v.weight, 0)
  let acc = 0
  for (const v of s) {
    acc += v.weight
    if (acc >= total / 2) return v.value
  }
  return 0
}

interface VoicedFrame {
  t: number
  midi: number
}

/** Primeiro índice com t >= alvo (busca binária). */
function lowerBound(frames: VoicedFrame[], t: number): number {
  let lo = 0
  let hi = frames.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (frames[mid]!.t < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

const frameScore = (absCents: number): number =>
  clamp01(1 - Math.max(0, absCents - PITCH_FULL_CENTS) / (PITCH_ZERO_CENTS - PITCH_FULL_CENTS))

const EMPTY: ReferenceComponents = {
  pitch: 0,
  notes: 0,
  rhythm: null,
  phrases: null,
  duration: 0,
  presence: 0,
  consistency: 0
}

function insufficient(reason: string, notesEvaluated = 0): ReferenceScore {
  return {
    mode: 'reference',
    label: MODE_LABELS.reference,
    formulaVersion: REFERENCE_FORMULA_VERSION,
    score: null,
    insufficientReason: reason,
    components: EMPTY,
    transposeSemitones: 0,
    notesEvaluated,
    notesHit: 0,
    medianOnsetMs: null,
    perNote: []
  }
}

/**
 * AVALIAÇÃO COM MELODIA DE REFERÊNCIA. Compara a linha do tempo de pitch do cantor (já com o
 * tempo da música compensado pela latência) com as notas da melodia.
 *
 *   nota = 100 × gate × Σ peso × componente        (pesos em REFERENCE_WEIGHTS)
 *   gate = min(1, presença / 0,10)
 *
 * A oitava é ignorada (vozes graves e agudas cantam a mesma melodia). Se o cantor estiver todo
 * em outro tom, a transposição é detectada, informada e a afinação é medida em relação a ela.
 * Componentes não mensuráveis (ex.: melodia sem pausas) saem da conta e os pesos são
 * renormalizados. Só entram notas dentro do trecho que a apresentação cobriu.
 */
export function computeReferenceScore(
  track: readonly PitchPoint[],
  melody: readonly ReferenceNote[],
  options: ReferenceOptions = {}
): ReferenceScore {
  const allowTransposition = options.allowTransposition ?? true

  const timed = track.filter((p) => p.songTime !== null)
  if (timed.length === 0) return insufficient('Não há dados de voz alinhados ao tempo da música.')
  const times = timed.map((p) => p.songTime as number)
  const tStart = Math.min(...times)
  const tEnd = Math.max(...times)

  // Passo de tempo de cada ponto (mediana das diferenças entre pontos consecutivos).
  const sortedTimes = [...times].sort((a, b) => a - b)
  const diffs: number[] = []
  for (let i = 1; i < sortedTimes.length; i++) {
    const d = sortedTimes[i]! - sortedTimes[i - 1]!
    if (d > 0 && d < 0.1) diffs.push(d)
  }
  const step = diffs.length > 0 ? median(diffs) : 0.0107

  const voiced: VoicedFrame[] = timed
    .filter((p) => p.frequency !== null && p.clarity >= VOICE_CLARITY_MIN)
    .map((p) => ({
      t: p.songTime as number,
      midi: 69 + 12 * Math.log2((p.frequency as number) / 440)
    }))
    .sort((a, b) => a.t - b.t)

  // Notas dentro do trecho coberto pela apresentação.
  const notes = melody
    .filter(
      (n) => n.start >= tStart - RANGE_SLACK_SEC && n.start + n.duration <= tEnd + RANGE_SLACK_SEC
    )
    .sort((a, b) => a.start - b.start)
  const totalNoteSec = notes.reduce((s, n) => s + n.duration, 0)
  if (notes.length < MIN_REFERENCE_NOTES || totalNoteSec < MIN_REFERENCE_NOTE_SEC) {
    return insufficient(
      `Poucas notas da melodia foram avaliadas (${notes.length}): cante um trecho maior da música.`,
      notes.length
    )
  }

  // ---- 1) transposição global (mediana ponderada do erro de cada nota, oitava ignorada) ----
  const window = (n: ReferenceNote): VoicedFrame[] => {
    const trim = Math.min(ATTACK_TRIM_SEC, n.duration * 0.3)
    const from = lowerBound(voiced, n.start + trim)
    const to = lowerBound(voiced, n.start + n.duration)
    return voiced.slice(from, to)
  }
  const noteErrors = notes.map((n) => {
    const frames = window(n)
    return frames.length >= MIN_NOTE_FRAMES
      ? { value: median(frames.map((f) => wrapSemitones(f.midi - n.midi))), weight: n.duration }
      : null
  })
  const measurable = noteErrors.filter((e): e is { value: number; weight: number } => e !== null)
  let shift = 0
  if (allowTransposition && measurable.length > 0) {
    const m = weightedMedian(measurable)
    const candidate = Math.round(m)
    // Transposição = a melodia toda deslocada por semitons EXATOS (ex.: a faixa está em outro tom).
    // Um desvio que não é semitom inteiro é desafinação, e um deslocamento que só "salva" poucas
    // notas é coincidência: nenhum dos dois é absorvido.
    if (
      Math.abs(m) >= TRANSPOSE_MIN_SEMITONES &&
      Math.abs(m - candidate) <= TRANSPOSE_MAX_RESIDUAL_SEMITONES
    ) {
      const total = measurable.reduce((s, e) => s + e.weight, 0)
      const consistent = measurable
        .filter((e) => Math.abs(wrapSemitones(e.value - candidate)) <= 1)
        .reduce((s, e) => s + e.weight, 0)
      if (consistent / total >= TRANSPOSE_MIN_CONSISTENCY) shift = candidate
    }
  }

  // ---- 2) por nota ----
  const perNote: NoteResult[] = []
  let pitchSum = 0
  let hitDur = 0
  let sustainSum = 0
  let presenceSum = 0
  let consistencySum = 0
  let hits = 0
  const onsetScores: { score: number; weight: number; phraseFirst: boolean }[] = []
  const onsetDelays: number[] = []

  notes.forEach((n, i) => {
    const all = voiced.slice(lowerBound(voiced, n.start), lowerBound(voiced, n.start + n.duration))
    const frames = window(n)
    const errCents = frames.map((f) => wrapSemitones(f.midi - n.midi - shift) * 100)
    const sung = frames.length >= MIN_NOTE_FRAMES

    // afinação
    const pitch = sung
      ? errCents.reduce((s, e) => s + frameScore(Math.abs(e)), 0) / errCents.length
      : 0
    pitchSum += pitch * n.duration

    // nota acertada
    const hit = sung && median(errCents.map(Math.abs)) <= NOTE_HIT_CENTS
    if (hit) {
      hits++
      hitDur += n.duration
    }

    // duração: tempo dentro do pitch (±100 centésimos) em relação à duração da nota
    const inTolerance = frames.filter(
      (_, k) => Math.abs(errCents[k]!) <= SUSTAIN_TOLERANCE_CENTS
    ).length
    sustainSum += clamp01((inTolerance * step) / n.duration / SUSTAIN_FULL_FRACTION) * n.duration

    // presença: tempo com voz na nota
    presenceSum += Math.min(n.duration, all.length * step)

    // consistência: desvio-padrão do pitch dentro da nota
    if (frames.length >= 5) {
      const mean = errCents.reduce((s, e) => s + e, 0) / errCents.length
      const std = Math.sqrt(errCents.reduce((s, e) => s + (e - mean) ** 2, 0) / errCents.length)
      consistencySum +=
        (1 -
          clamp01(
            (std - CONSISTENCY_LOW_CENTS) / (CONSISTENCY_HIGH_CENTS - CONSISTENCY_LOW_CENTS)
          )) *
        n.duration
    }

    // entrada da nota
    const prev = notes[i - 1]
    const gapBefore = prev ? n.start - (prev.start + prev.duration) : Infinity
    const samePitchAsPrev =
      prev !== undefined &&
      gapBefore < 0.05 &&
      Math.abs(wrapSemitones(n.midi - prev.midi)) * 100 < ONSET_TOLERANCE_CENTS
    let onsetMs: number | null = null
    if (!samePitchAsPrev) {
      const onset = findOnset(voiced, n, shift)
      if (onset !== null) {
        onsetMs = Math.round(onset * 1000)
        onsetDelays.push(onset * 1000)
        const late = Math.abs(onset)
        onsetScores.push({
          score: clamp01(1 - (late - ONSET_FULL_SEC) / (ONSET_ZERO_SEC - ONSET_FULL_SEC)),
          weight: Math.min(n.duration, 1),
          phraseFirst: gapBefore >= PHRASE_GAP_SEC
        })
      } else {
        // sem entrada reconhecível no pitch certo (não cantou ou cantou outra nota): entrada perdida
        onsetScores.push({
          score: 0,
          weight: Math.min(n.duration, 1),
          phraseFirst: gapBefore >= PHRASE_GAP_SEC
        })
      }
    }
    perNote.push({
      start: n.start,
      midi: n.midi,
      pitch: Math.round(pitch * 100) / 100,
      onsetMs,
      hit,
      sung
    })
  })

  const weightedMean = (items: { score: number; weight: number }[]): number | null => {
    const w = items.reduce((s, x) => s + x.weight, 0)
    return w === 0 ? null : items.reduce((s, x) => s + x.score * x.weight, 0) / w
  }

  const presence = clamp01(presenceSum / totalNoteSec / PRESENCE_FULL_FRACTION)
  const components: ReferenceComponents = {
    pitch: pitchSum / totalNoteSec,
    notes: hitDur / totalNoteSec,
    rhythm: weightedMean(onsetScores),
    phrases: weightedMean(onsetScores.filter((o) => o.phraseFirst)),
    duration: sustainSum / totalNoteSec,
    presence,
    consistency: consistencySum / totalNoteSec
  }

  // Soma ponderada; componentes não mensuráveis (null) saem e os pesos restantes são renormalizados.
  let weighted = 0
  let weightUsed = 0
  for (const key of Object.keys(REFERENCE_WEIGHTS) as (keyof ReferenceComponents)[]) {
    const value = components[key]
    if (value === null) continue
    weighted += REFERENCE_WEIGHTS[key] * value
    weightUsed += REFERENCE_WEIGHTS[key]
  }
  const gate = clamp01(presenceSum / totalNoteSec / REFERENCE_GATE_MIN_PRESENCE)
  const score = Math.round(100 * gate * (weightUsed > 0 ? weighted / weightUsed : 0))

  return {
    mode: 'reference',
    label: MODE_LABELS.reference,
    formulaVersion: REFERENCE_FORMULA_VERSION,
    score,
    insufficientReason: null,
    components,
    transposeSemitones: shift,
    notesEvaluated: notes.length,
    notesHit: hits,
    medianOnsetMs: onsetDelays.length > 0 ? Math.round(median(onsetDelays)) : null,
    perNote
  }
}

/**
 * Entrada da nota: atraso (s, negativo = adiantado) do primeiro momento, entre um pouco antes e
 * depois do início da nota, em que o cantor está no pitch certo por pelo menos ONSET_HOLD_SEC.
 * Se já estava no pitch certo no começo da busca (nota emendada), a entrada é imediata (0).
 */
function findOnset(voiced: VoicedFrame[], note: ReferenceNote, shift: number): number | null {
  const from = note.start - ONSET_SEARCH_BEFORE_SEC
  const to = note.start + ONSET_SEARCH_AFTER_SEC
  const frames = voiced.slice(lowerBound(voiced, from), lowerBound(voiced, to))
  const on = (f: VoicedFrame): boolean =>
    Math.abs(wrapSemitones(f.midi - note.midi - shift) * 100) <= ONSET_TOLERANCE_CENTS
  for (let i = 0; i < frames.length; i++) {
    if (!on(frames[i]!)) continue
    // segura o pitch por ONSET_HOLD_SEC (aceita pequenas falhas de 1 quadro)
    let j = i
    let misses = 0
    while (j < frames.length && frames[j]!.t - frames[i]!.t < ONSET_HOLD_SEC) {
      if (!on(frames[j]!)) {
        misses++
        if (misses > 1) break
      }
      j++
    }
    if (misses > 1) continue
    if (frames[j - 1]!.t - frames[i]!.t < ONSET_HOLD_SEC * 0.5 && j < frames.length) continue
    const alreadySounding = frames[i]!.t - from < 0.03
    return alreadySounding ? 0 : frames[i]!.t - note.start
  }
  return null
}
