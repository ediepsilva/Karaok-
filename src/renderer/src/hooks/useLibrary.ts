import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImportResult, Song } from '@shared/types'

export interface LibraryController {
  songs: Song[]
  query: string
  setQuery(query: string): void
  loading: boolean
  importing: boolean
  error: string | null
  lastImport: ImportResult | null
  addFolder(): Promise<void>
  dismissImport(): void
}

export function useLibrary(): LibraryController {
  const [songs, setSongs] = useState<Song[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastImport, setLastImport] = useState<ImportResult | null>(null)
  const requestId = useRef(0)

  const refresh = useCallback(async (q: string): Promise<void> => {
    const id = ++requestId.current
    const result = q.trim() ? await window.api.library.search(q) : await window.api.library.list()
    if (id !== requestId.current) return // resposta antiga: uma busca mais nova já foi pedida
    if (result.ok) {
      setSongs(result.value)
      setError(null)
    } else {
      setError(`Não foi possível carregar a biblioteca: ${result.message}`)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(query), query ? 150 : 0)
    return () => window.clearTimeout(timer)
  }, [query, refresh])

  const addFolder = useCallback(async (): Promise<void> => {
    const picked = await window.api.library.pickFolder()
    if (!picked.ok) return setError(picked.message)
    if (picked.value === null) return
    setImporting(true)
    setError(null)
    const result = await window.api.library.importFolder(picked.value)
    setImporting(false)
    if (!result.ok) return setError(result.message)
    setLastImport(result.value)
    await refresh(query)
  }, [query, refresh])

  return {
    songs,
    query,
    setQuery,
    loading,
    importing,
    error,
    lastImport,
    addFolder,
    dismissImport: () => setLastImport(null)
  }
}
