/** Preferências de comemoração (aplausos + voz), guardadas entre sessões. */
export interface CelebrationPrefs {
  /** Ligado por padrão: aplausos e locução ao fim de cada apresentação avaliada. */
  enabled: boolean
  /** Volume geral (0–1) dos aplausos/voz, independente do volume da música. */
  volume: number
}

export const DEFAULT_CELEBRATION_PREFS: CelebrationPrefs = { enabled: true, volume: 0.8 }

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

export function parseCelebrationPrefs(raw: string | null): CelebrationPrefs {
  if (!raw) return DEFAULT_CELEBRATION_PREFS
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return DEFAULT_CELEBRATION_PREFS
    const v = value as Record<string, unknown>
    return {
      enabled: v['enabled'] !== false,
      volume:
        typeof v['volume'] === 'number' && Number.isFinite(v['volume']) ? clamp01(v['volume']) : 0.8
    }
  } catch {
    return DEFAULT_CELEBRATION_PREFS
  }
}
