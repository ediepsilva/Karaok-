import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceResult } from '../voice/useVoice'
import { computeApplausePlan } from './applause-plan'
import {
  pickPortugueseVoice,
  playCelebration,
  type CelebrationHandle
} from './celebration-controller'
import {
  DEFAULT_CELEBRATION_PREFS,
  parseCelebrationPrefs,
  type CelebrationPrefs
} from './celebration-prefs'
import type { CelebrationDeps } from './celebration-types'
import { pickCelebrationMessage } from './tts-messages'

const PREFS_KEY = 'karaoke.celebration'

function readStoredPrefs(): CelebrationPrefs {
  try {
    return parseCelebrationPrefs(window.localStorage.getItem(PREFS_KEY))
  } catch {
    return DEFAULT_CELEBRATION_PREFS
  }
}

/** Nota final da apresentação (a do modo usado), ou null se não há nota (apresentação curta demais). */
function finalScore(result: VoiceResult): number | null {
  return result.primary === 'reference' ? (result.reference?.score ?? null) : result.score.score
}

export interface CelebrationController {
  prefs: CelebrationPrefs
  setEnabled(enabled: boolean): void
  setVolume(volume: number): void
}

/**
 * Ao fim de cada apresentação com nota (avaliação básica ou com melodia), toca aplausos
 * proporcionais à nota e uma frase falada (TTS) parabenizando o cantor, com os aplausos abaixados
 * durante a fala e um fade-out no final. Ver docs/FASE5_APLAUSOS_VOZ.md. 100% gerado por código:
 * sem áudio de terceiros, sem depender de internet (voz do próprio sistema operacional).
 */
export function useCelebration(result: VoiceResult | null): CelebrationController {
  const [prefs, setPrefs] = useState<CelebrationPrefs>(DEFAULT_CELEBRATION_PREFS)
  const handledResult = useRef<VoiceResult | null>(null)
  const activeRef = useRef<CelebrationHandle | null>(null)
  const prefsRef = useRef(prefs)
  useEffect(() => {
    prefsRef.current = prefs
  }, [prefs])

  useEffect(() => {
    const timer = window.setTimeout(() => setPrefs(readStoredPrefs()), 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      /* sem armazenamento: a preferência vale só nesta sessão */
    }
  }, [prefs])

  useEffect(() => {
    if (result === null || result === handledResult.current) return
    handledResult.current = result
    if (!prefsRef.current.enabled) return
    const score = finalScore(result)
    if (score === null) return

    const AudioContextCtor = window.AudioContext
    if (!AudioContextCtor || !window.speechSynthesis) return // navegador sem suporte: silencioso
    // Os tipos DOM (eventos com argumento, métodos extras) são mais amplos que a interface mínima
    // que o controlador realmente usa; o formato em tempo de execução é compatível.
    const deps: CelebrationDeps = {
      audioContext: new AudioContextCtor() as unknown as CelebrationDeps['audioContext'],
      speechSynthesis: window.speechSynthesis as unknown as CelebrationDeps['speechSynthesis'],
      createUtterance: (text) =>
        new SpeechSynthesisUtterance(text) as unknown as ReturnType<
          CelebrationDeps['createUtterance']
        >,
      pickVoice: pickPortugueseVoice as unknown as CelebrationDeps['pickVoice']
    }
    const plan = computeApplausePlan(score)
    const message = pickCelebrationMessage({ score, singer: result.singer })
    activeRef.current?.stop()
    activeRef.current = playCelebration(deps, plan, message, prefsRef.current.volume)
  }, [result])

  // ao trocar de música / fechar o app, não deixa nada tocando pra sempre
  useEffect(() => () => activeRef.current?.stop(), [])

  const setEnabled = useCallback((enabled: boolean): void => {
    setPrefs((p) => ({ ...p, enabled }))
  }, [])
  const setVolume = useCallback((volume: number): void => {
    setPrefs((p) => ({ ...p, volume: Math.max(0, Math.min(1, volume)) }))
  }, [])

  return { prefs, setEnabled, setVolume }
}
