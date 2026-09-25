import { PAUSE_RELEASE_SEC } from './voice-config'

export type PlayerPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'error'

export interface MicPolicyInput {
  /** Avaliação vocal habilitada pelo usuário. */
  evaluationEnabled: boolean
  /** O usuário apertou "Testar microfone" (diagnóstico). */
  diagnosticsOn: boolean
  phase: PlayerPhase
  /** Há quantos segundos o player está em pausa (0 se não está). */
  pausedForSec: number
}

/**
 * Quando o microfone pode estar aberto. Regra de privacidade: só durante o teste explícito ou
 * durante uma apresentação com a avaliação habilitada; nunca "de graça".
 */
export function shouldMicBeActive(input: MicPolicyInput): boolean {
  if (input.diagnosticsOn) return true
  if (!input.evaluationEnabled) return false
  switch (input.phase) {
    case 'loading':
    case 'playing':
      return true
    case 'paused':
      return input.pausedForSec < PAUSE_RELEASE_SEC
    default:
      return false
  }
}

/** Os quadros só contam para a nota enquanto a música realmente toca. */
export function shouldCountFrames(phase: PlayerPhase): boolean {
  return phase === 'playing'
}
