export interface ParsedName {
  artist: string
  title: string
  /** Código de catálogo encontrado no início ou no fim do nome (ex.: "80026"). */
  code?: string
}

/** Códigos de catálogo comuns no início do nome: "SC1234-01", "SF 123", "12345", "01". */
const LEADING_CODE = /^(?:[A-Za-z]{1,5}[\s_-]?)?\d{1,6}(?:[-_.]\d{1,3})?$/
/** Código só numérico no FIM do nome: "Artista - Título - 80026". */
const TRAILING_CODE = /^\d{3,8}$/

function clean(value: string): string {
  return value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Interpreta "Artista - Título" a partir do nome do arquivo (sem extensão).
 * Tolerante: se não for possível identificar, o nome inteiro vira o título e o artista fica vazio.
 */
export function parseSongName(baseName: string): ParsedName {
  const fallback = clean(baseName)
  if (!fallback) return { artist: '', title: baseName }

  const parts = fallback
    .split(/\s+[-–—]\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  // "CÓDIGO - Artista - Título" e "Artista - Título - CÓDIGO": tira o código e o guarda à parte.
  let code: string | undefined
  if (parts.length >= 3 && LEADING_CODE.test(parts[0] ?? '')) code = parts.shift()
  else if (parts.length >= 3 && TRAILING_CODE.test(parts[parts.length - 1] ?? ''))
    code = parts.pop()

  if (parts.length < 2) {
    // "Artista-Título" sem espaços: só aceita se houver exatamente um hífen e ambos os lados.
    const tight = fallback.split('-')
    if (tight.length === 2 && (tight[0] ?? '').trim() && (tight[1] ?? '').trim()) {
      return { artist: (tight[0] ?? '').trim(), title: (tight[1] ?? '').trim() }
    }
    return { artist: '', title: fallback }
  }

  const artist = parts[0] ?? ''
  const title = parts.slice(1).join(' - ')
  if (LEADING_CODE.test(artist)) return { artist: '', title: fallback }
  return code ? { artist, title, code } : { artist, title }
}

/** Normaliza para busca: minúsculas, sem acentos, espaços colapsados. */
export function normalizeForSearch(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}
