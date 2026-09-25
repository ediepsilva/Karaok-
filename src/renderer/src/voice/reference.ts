/**
 * Contratos da avaliação: os dois modos e a origem da melodia de referência (MIDI/KAR, Fase 4B).
 * A comparação com a melodia está em reference-score.ts; a avaliação básica, em basic-score.ts.
 */

import type { ReferenceNote } from '@shared/types'

export type { ReferenceNote }

export type EvaluationMode = 'reference' | 'basic'

export const MODE_LABELS: Record<EvaluationMode, string> = {
  reference: 'AVALIAÇÃO COM MELODIA DE REFERÊNCIA',
  basic: 'AVALIAÇÃO BÁSICA'
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
