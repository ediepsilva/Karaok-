import { clampManualMs } from './latency'

/** Preferências de voz guardadas entre sessões. O microfone NUNCA liga sozinho ao abrir o app. */
export interface VoicePrefs {
  /** Avaliação vocal habilitada (o microfone só abre durante uma apresentação). */
  enabled: boolean
  deviceId: string
  manualLatencyMs: number
  /** Ida e volta medida pelo usuário (ms), ou null. */
  measuredLatencyMs: number | null
}

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  enabled: false,
  deviceId: '',
  manualLatencyMs: 0,
  measuredLatencyMs: null
}

export function parseVoicePrefs(raw: string | null): VoicePrefs {
  if (!raw) return DEFAULT_VOICE_PREFS
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return DEFAULT_VOICE_PREFS
    const v = value as Record<string, unknown>
    const measured = v['measuredLatencyMs']
    return {
      enabled: v['enabled'] === true,
      deviceId: typeof v['deviceId'] === 'string' ? v['deviceId'].slice(0, 300) : '',
      manualLatencyMs:
        typeof v['manualLatencyMs'] === 'number' ? clampManualMs(v['manualLatencyMs']) : 0,
      measuredLatencyMs:
        typeof measured === 'number' &&
        Number.isFinite(measured) &&
        measured >= 0 &&
        measured <= 2000
          ? Math.round(measured)
          : null
    }
  } catch {
    return DEFAULT_VOICE_PREFS
  }
}
