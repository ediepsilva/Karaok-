import { useEffect, useState, type FormEvent } from 'react'
import type { Song, SongMetadata } from '@shared/types'

interface Props {
  song: Song
  /** Devolve uma mensagem de erro, ou null se salvou. */
  onSave(metadata: SongMetadata): Promise<string | null>
  onClose(): void
}

const FIELDS: { key: keyof SongMetadata; label: string }[] = [
  { key: 'title', label: 'Título' },
  { key: 'artist', label: 'Artista' },
  { key: 'genre', label: 'Gênero' },
  { key: 'language', label: 'Idioma' },
  { key: 'code', label: 'Código' }
]

export function EditSongDialog({ song, onSave, onClose }: Props): React.JSX.Element {
  const [values, setValues] = useState<SongMetadata>({
    title: song.title,
    artist: song.artist,
    genre: song.genre,
    language: song.language,
    code: song.code
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // No documento (e não no <form>): o botão desabilitado durante o salvamento tira o foco do form.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    const message = await onSave(values)
    setSaving(false)
    if (message) setError(message)
    else onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-label="Editar música"
        data-testid="edit-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <h2>Editar música</h2>
        {FIELDS.map(({ key, label }) => (
          <label key={key} className="field">
            {label}
            <input
              autoFocus={key === 'title'}
              maxLength={200}
              value={values[key]}
              data-testid={`edit-${key}`}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
          </label>
        ))}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={saving} data-testid="edit-save">
            Salvar
          </button>
        </div>
      </form>
    </div>
  )
}
