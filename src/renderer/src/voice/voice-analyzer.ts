import { detectPitch, frameLevel, frequencyToNote } from './pitch'
import {
  ABOVE_NOISE_FLOOR_DB,
  ABSOLUTE_SILENCE_DB,
  CLIPPING_PEAK,
  NOISE_FLOOR_MIN_DB,
  NOISE_FLOOR_RISE,
  NOISY_ROOM_DB,
  VOICE_CLARITY_MIN
} from './voice-config'

export type FrameState = 'silence' | 'noise' | 'voice'

/** Resultado da análise de um quadro do microfone. */
export interface FrameAnalysis {
  /** Segundos desde o início da captura (relógio do microfone). */
  time: number
  dbfs: number
  peak: number
  clipping: boolean
  /** Hz; só é informado quando o quadro é "voz". */
  frequency: number | null
  clarity: number
  /** MIDI fracionário e nota mais próxima (só em quadros de voz). */
  midi: number | null
  note: string | null
  cents: number | null
  state: FrameState
  /** Ruído ambiente estimado (dBFS) neste momento. */
  noiseFloorDb: number
}

/**
 * Classifica cada quadro em silêncio, ruído ou voz e acompanha o ruído ambiente.
 *
 *  - silêncio: nível abaixo de max(piso absoluto, ruído ambiente + margem);
 *  - voz: acima disso E com pitch claro (periodicidade) dentro da faixa vocal;
 *  - ruído: acima do limiar, mas sem pitch claro (chiado, sopro, bateria, fala sussurrada).
 *
 * Limite conhecido: não distingue canto de fala nem canto de instrumento melódico.
 */
export class VoiceAnalyzer {
  private noiseFloor: number

  constructor(
    private readonly sampleRate: number,
    initialNoiseFloorDb = NOISE_FLOOR_MIN_DB
  ) {
    this.noiseFloor = initialNoiseFloorDb
  }

  get noiseFloorDb(): number {
    return this.noiseFloor
  }

  get roomIsNoisy(): boolean {
    return this.noiseFloor > NOISY_ROOM_DB
  }

  get voiceThresholdDb(): number {
    return Math.max(ABSOLUTE_SILENCE_DB, this.noiseFloor + ABOVE_NOISE_FLOOR_DB)
  }

  analyze(samples: Float32Array, time: number): FrameAnalysis {
    const { peak, dbfs } = frameLevel(samples)
    const audible = dbfs >= this.voiceThresholdDb
    let frequency: number | null = null
    let clarity = 0
    let state: FrameState = 'silence'

    if (audible) {
      const pitch = detectPitch(samples, this.sampleRate)
      clarity = pitch.clarity
      if (pitch.frequency !== null && pitch.clarity >= VOICE_CLARITY_MIN) {
        frequency = pitch.frequency
        state = 'voice'
      } else {
        state = 'noise'
      }
    }

    // O ruído ambiente só acompanha quadros que não são voz: cai rápido, sobe devagar.
    if (state !== 'voice') {
      this.noiseFloor =
        dbfs < this.noiseFloor
          ? Math.max(dbfs, NOISE_FLOOR_MIN_DB)
          : this.noiseFloor +
            NOISE_FLOOR_RISE * (Math.min(dbfs, this.noiseFloor + 12) - this.noiseFloor)
    }

    const note = frequency !== null ? frequencyToNote(frequency) : null
    return {
      time,
      dbfs,
      peak,
      clipping: peak >= CLIPPING_PEAK,
      frequency,
      clarity,
      midi: note?.midi ?? null,
      note: note?.name ?? null,
      cents: note?.cents ?? null,
      state,
      noiseFloorDb: this.noiseFloor
    }
  }
}
