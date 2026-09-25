import {
  DEFAULT_EVALUATION_LEVEL,
  EVALUATION_LEVELS,
  type EvaluationLevel
} from './evaluation-profile'

/** O cantor é só um nome digitado (sem conta/login); o nível fica guardado por esse nome. */
export type SingerLevels = Record<string, EvaluationLevel>

export function normalizeSingerName(name: string): string {
  return name.trim().toLowerCase()
}

function isEvaluationLevel(value: unknown): value is EvaluationLevel {
  return typeof value === 'string' && (EVALUATION_LEVELS as readonly string[]).includes(value)
}

export function parseSingerLevels(raw: string | null): SingerLevels {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return {}
    const out: SingerLevels = {}
    for (const [name, level] of Object.entries(value as Record<string, unknown>)) {
      if (name.length > 0 && name.length <= 200 && isEvaluationLevel(level)) out[name] = level
    }
    return out
  } catch {
    return {}
  }
}

/** Nível guardado para o cantor, ou o padrão (Amador) se é a primeira vez que ele canta. */
export function levelFor(levels: SingerLevels, singer: string): EvaluationLevel {
  const key = normalizeSingerName(singer)
  return key.length > 0 ? (levels[key] ?? DEFAULT_EVALUATION_LEVEL) : DEFAULT_EVALUATION_LEVEL
}

/** Devolve um novo mapa com o nível daquele cantor atualizado (nunca muta o original). */
export function withLevel(
  levels: SingerLevels,
  singer: string,
  level: EvaluationLevel
): SingerLevels {
  const key = normalizeSingerName(singer)
  if (key.length === 0) return levels
  return { ...levels, [key]: level }
}
