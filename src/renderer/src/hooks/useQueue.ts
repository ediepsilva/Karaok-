import { useCallback, useEffect, useState } from 'react'
import type { HistoryEntry, MoveDirection, QueueItem, QueueStatus } from '@shared/types'

export interface QueueController {
  items: QueueItem[]
  history: HistoryEntry[]
  error: string | null
  refresh(): Promise<QueueItem[]>
  add(songId: number, singer: string): Promise<boolean>
  remove(id: number): Promise<void>
  move(id: number, direction: MoveDirection): Promise<void>
  setStatus(id: number, status: QueueStatus): Promise<void>
  clear(): Promise<void>
  refreshHistory(): Promise<void>
  clearHistory(): Promise<void>
}

/** Estado da fila e do histórico, sempre lido do banco (a fonte da verdade é o main). */
export function useQueue(): QueueController {
  const [items, setItems] = useState<QueueItem[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<QueueItem[]> => {
    const result = await window.api.queue.list()
    if (!result.ok) {
      setError(`Não foi possível carregar a fila: ${result.message}`)
      return []
    }
    setItems(result.value)
    setError(null)
    return result.value
  }, [])

  const refreshHistory = useCallback(async (): Promise<void> => {
    const result = await window.api.history.list(200)
    if (result.ok) setHistory(result.value)
    else setError(`Não foi possível carregar o histórico: ${result.message}`)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh()
      void refreshHistory()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh, refreshHistory])

  /** Roda uma operação da fila e recarrega; erros viram mensagem na tela. */
  const mutate = useCallback(
    async (operation: () => Promise<{ ok: boolean; message?: string }>): Promise<boolean> => {
      const result = await operation()
      if (!result.ok) setError(result.message ?? 'Operação falhou.')
      await refresh()
      return result.ok
    },
    [refresh]
  )

  return {
    items,
    history,
    error,
    refresh,
    refreshHistory,
    add: (songId, singer) => mutate(() => window.api.queue.add(songId, singer)),
    remove: async (id) => void (await mutate(() => window.api.queue.remove(id))),
    move: async (id, direction) => void (await mutate(() => window.api.queue.move(id, direction))),
    setStatus: async (id, status) =>
      void (await mutate(() => window.api.queue.setStatus(id, status))),
    clear: async () => void (await mutate(() => window.api.queue.clear())),
    clearHistory: async () => {
      await window.api.history.clear()
      await refreshHistory()
    }
  }
}
