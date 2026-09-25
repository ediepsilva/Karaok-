import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImportResult, RescanResult, Song, SongMetadata } from '@shared/types'

export interface LibraryController {
  songs: Song[]
  query: string
  setQuery(query: string): void
  favoritesOnly: boolean
  setFavoritesOnly(value: boolean): void
  loading: boolean
  busy: boolean
  /** O seletor nativo de pasta está aberto (aguardando o usuário escolher ou cancelar). */
  picking: boolean
  error: string | null
  /** Mensagem de resultado da última operação (importar, reescanear, limpar). */
  notice: string | null
  lastImport: ImportResult | null
  addFolder(): Promise<void>
  rescan(): Promise<void>
  removeMissing(): Promise<void>
  toggleFavorite(song: Song): Promise<void>
  saveMetadata(id: number, metadata: SongMetadata): Promise<string | null>
  dismissNotice(): void
}

const describeRescan = (r: RescanResult): string => {
  const base = `${r.folders} pasta(s) reescaneada(s): ${r.added} música(s) nova(s), ${r.duplicates} já cadastrada(s).`
  return r.unavailableFolders.length > 0
    ? `${base} ${r.unavailableFolders.length} pasta(s) indisponível(is).`
    : base
}

export function useLibrary(): LibraryController {
  const [songs, setSongs] = useState<Song[]>([])
  const [query, setQuery] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [lastImport, setLastImport] = useState<ImportResult | null>(null)
  const requestId = useRef(0)
  const pickingRef = useRef(false)
  const [picking, setPicking] = useState(false)

  const refresh = useCallback(async (q: string, favorites: boolean): Promise<void> => {
    const id = ++requestId.current
    const result = await window.api.library.list({ query: q, favoritesOnly: favorites })
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
    const timer = window.setTimeout(() => void refresh(query, favoritesOnly), query ? 150 : 0)
    return () => window.clearTimeout(timer)
  }, [query, favoritesOnly, refresh])

  /** Executa uma operação demorada: bloqueia botões, mostra erro e recarrega a lista. */
  const run = useCallback(
    async (operation: () => Promise<string | null>): Promise<void> => {
      setBusy(true)
      setError(null)
      const message = await operation()
      setBusy(false)
      if (message !== null) setNotice(message)
      await refresh(query, favoritesOnly)
    },
    [query, favoritesOnly, refresh]
  )

  const addFolder = useCallback(async (): Promise<void> => {
    if (pickingRef.current) return // o seletor já está aberto: ignora clique repetido
    pickingRef.current = true
    setPicking(true)
    const picked = await window.api.library.pickFolder().finally(() => {
      pickingRef.current = false
      setPicking(false)
    })
    if (!picked.ok) return setError(picked.message)
    if (picked.value === null) return
    const folder = picked.value
    await run(async () => {
      const result = await window.api.library.importFolder(folder)
      if (!result.ok) {
        setError(result.message)
        return null
      }
      setLastImport(result.value)
      setNotice(null)
      return null
    })
  }, [run])

  const rescan = useCallback(
    () =>
      run(async () => {
        const result = await window.api.library.rescan()
        if (!result.ok) {
          setError(result.message)
          return null
        }
        setLastImport(null)
        return result.value.folders === 0 && result.value.unavailableFolders.length === 0
          ? 'Nenhuma pasta importada ainda. Use “Adicionar pasta de músicas”.'
          : describeRescan(result.value)
      }),
    [run]
  )

  const removeMissing = useCallback(
    () =>
      run(async () => {
        const result = await window.api.library.removeMissing()
        if (!result.ok) {
          setError(result.message)
          return null
        }
        setLastImport(null)
        return `${result.value} música(s) indisponível(is) removida(s) do catálogo.`
      }),
    [run]
  )

  const toggleFavorite = useCallback(
    async (song: Song): Promise<void> => {
      const result = await window.api.songs.setFavorite(song.id, !song.favorite)
      if (!result.ok) return setError(result.message)
      await refresh(query, favoritesOnly)
    },
    [query, favoritesOnly, refresh]
  )

  const saveMetadata = useCallback(
    async (id: number, metadata: SongMetadata): Promise<string | null> => {
      const result = await window.api.songs.updateMetadata(id, metadata)
      if (!result.ok) return result.message
      await refresh(query, favoritesOnly)
      return null
    },
    [query, favoritesOnly, refresh]
  )

  return {
    songs,
    query,
    setQuery,
    favoritesOnly,
    setFavoritesOnly,
    loading,
    busy,
    error,
    notice,
    lastImport,
    picking,
    addFolder,
    rescan,
    removeMissing,
    toggleFavorite,
    saveMetadata,
    dismissNotice: () => {
      setNotice(null)
      setLastImport(null)
    }
  }
}
