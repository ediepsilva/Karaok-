import { useCallback, useEffect, useState } from 'react'
import { profileFor, type EvaluationLevel, type EvaluationProfile } from './evaluation-profile'
import { levelFor, parseSingerLevels, withLevel, type SingerLevels } from './singer-level-prefs'

const KEY = 'karaoke.singerLevels'

function readStored(): SingerLevels {
  try {
    return parseSingerLevels(window.localStorage.getItem(KEY))
  } catch {
    return {}
  }
}

export interface EvaluationLevelController {
  level: EvaluationLevel
  profile: EvaluationProfile
  /** Troca o nível do cantor atual (fica guardado para a próxima vez que ele cantar). */
  setLevel(level: EvaluationLevel): void
}

/**
 * Nível de dificuldade (Amador/Semiprofissional/Profissional) do cantor da vez, escolhido antes
 * de iniciar a apresentação e guardado por nome de cantor (pré-seleciona da próxima vez que esse
 * nome for usado). Ver docs/NIVEIS_AVALIACAO.md.
 */
export function useEvaluationLevel(singer: string): EvaluationLevelController {
  const [levels, setLevels] = useState<SingerLevels>({})

  useEffect(() => {
    const timer = window.setTimeout(() => setLevels(readStored()), 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(levels))
    } catch {
      /* sem armazenamento: o nível vale só nesta sessão */
    }
  }, [levels])

  const level = levelFor(levels, singer)

  const setLevel = useCallback(
    (next: EvaluationLevel): void => {
      setLevels((current) => withLevel(current, singer, next))
    },
    [singer]
  )

  return { level, profile: profileFor(level), setLevel }
}
