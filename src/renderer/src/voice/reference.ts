/**
 * Contratos para a futura AVALIAÇÃO COM MELODIA DE REFERÊNCIA (Fase 4B: MIDI/KAR).
 *
 * Na Fase 4A só existe o modo "basic". Estes tipos NÃO implementam comparação com melodia:
 * apenas fixam o formato dos dados para que a 4B se encaixe sem reescrever a captura.
 */

export type EvaluationMode = 'reference' | 'basic'

export const MODE_LABELS: Record<EvaluationMode, string> = {
  reference: 'AVALIAÇÃO COM MELODIA DE REFERÊNCIA',
  basic: 'AVALIAÇÃO BÁSICA'
}

/** Nota esperada pela melodia de referência. */
export interface ReferenceNote {
  /** Início (s) no tempo da música. */
  start: number
  duration: number
  /** Número MIDI (69 = A4). */
  midi: number
  lyric?: string
}

export interface ReferenceMelody {
  songId: number
  source: 'midi' | 'kar' | 'json'
  notes: ReferenceNote[]
}

/** Onde a melodia vem. Na 4A ninguém fornece melodia. */
export interface ReferenceProvider {
  getMelody(songId: number): Promise<ReferenceMelody | null>
}

export const noReferenceProvider: ReferenceProvider = {
  getMelody: () => Promise.resolve(null)
}

/** Modo de avaliação: só "reference" quando há melodia utilizável. */
export function selectEvaluationMode(melody: ReferenceMelody | null): EvaluationMode {
  return melody !== null && melody.notes.length > 0 ? 'reference' : 'basic'
}
