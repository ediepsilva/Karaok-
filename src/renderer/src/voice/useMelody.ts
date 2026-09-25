import { useCallback, useEffect, useRef, useState } from 'react'
import type { MelodyInfo } from '@shared/types'

export interface MelodyController {
  /** Melodia de referência da música atual (MIDI/KAR), ou null se não há. */
  info: MelodyInfo | null
  /** Motivo de o arquivo de melodia não ter sido usado (o app cai para a avaliação básica). */
  error: string | null
  loading: boolean
  /** Troca a trilha usada como melodia (fica guardada para esta música). */
  setTrack(trackIndex: number): Promise<void>
}

/** Carrega a melodia de referência da música atual sempre que a música muda. */
export function useMelody(songId: number | null): MelodyController {
  const [info, setInfo] = useState<MelodyInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const token = useRef(0)

  useEffect(() => {
    const mine = ++token.current
    // Adiado para fora do corpo do efeito (evita setState síncrono) e agrupa trocas rápidas.
    const timer = window.setTimeout(() => {
      setInfo(null)
      setError(null)
      if (songId === null) return
      setLoading(true)
      void window.api.melody.get(songId).then((result) => {
        if (mine !== token.current) return
        setLoading(false)
        if (result.ok) setInfo(result.value)
        else {
          setError(result.message)
          window.api.log('WARN', 'Melodia de referência não utilizada', {
            songId,
            message: result.message
          })
        }
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [songId])

  const setTrack = useCallback(
    async (trackIndex: number): Promise<void> => {
      if (songId === null) return
      const result = await window.api.melody.setTrack(songId, trackIndex)
      if (result.ok) {
        setInfo(result.value)
        setError(null)
      } else {
        setError(result.message)
      }
    },
    [songId]
  )

  return { info, error, loading, setTrack }
}
