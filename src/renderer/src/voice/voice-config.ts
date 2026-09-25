/**
 * TODOS os limiares e pesos da análise vocal ficam aqui, num só lugar, para serem ajustados depois
 * de testes com voz real. Documentação da fórmula: docs/AVALIACAO_BASICA.md.
 */

// ---------- Captura / janelas ----------
/** Amostras (na taxa do AudioContext) por passo de análise (~10,7 ms a 48 kHz). */
export const HOP_SAMPLES = 512
/** Amostras por janela de análise (~43 ms a 48 kHz): cabem ≥ 2 períodos de 65 Hz. */
export const WINDOW_SAMPLES = 2048

// ---------- Detecção de pitch ----------
export const MIN_FREQ_HZ = 65 // ~C2
export const MAX_FREQ_HZ = 1100 // ~C#6
/** Fração do maior pico de correlação aceita como "primeiro pico" (método MPM). */
export const MPM_PEAK_RATIO = 0.9

// ---------- Classificação de cada quadro ----------
/** Clareza mínima (0–1) do pitch para considerar o quadro "voz" e não "ruído". */
export const VOICE_CLARITY_MIN = 0.8
/** Piso absoluto: abaixo disto (dBFS) é sempre silêncio. */
export const ABSOLUTE_SILENCE_DB = -52
/** Menor ruído ambiente estimado (dBFS): microfones reais nunca chegam ao silêncio digital. */
export const NOISE_FLOOR_MIN_DB = ABSOLUTE_SILENCE_DB - 6
/** Quanto acima do ruído ambiente (dB) o sinal precisa estar para não ser silêncio. */
export const ABOVE_NOISE_FLOOR_DB = 9
/** Nível máximo aceito (dBFS) do ruído ambiente antes de avisar "ambiente ruidoso". */
export const NOISY_ROOM_DB = -38
/** Pico (0–1) a partir do qual o quadro conta como saturado (clipping). */
export const CLIPPING_PEAK = 0.99
/** Velocidade de subida do ruído ambiente estimado (por quadro), para acompanhar mudanças lentas. */
export const NOISE_FLOOR_RISE = 0.002

// ---------- Métricas ----------
/** Silêncios/quedas menores que isto (s) NÃO quebram uma "corrida" de voz (consoantes, respiração). */
export const GAP_TOLERANCE_SEC = 0.15
/** Corridas de voz menores que isto (s) são tratadas como ruído, não como canto. */
export const MIN_RUN_SEC = 0.1
/** Quadros anteriores usados na mediana local de pitch (estabilidade). */
export const STABILITY_WINDOW = 5
/** Desvio (centésimos de semitom) da mediana local tolerado como "estável" (cobre vibrato leve). */
export const STABILITY_TOLERANCE_CENTS = 70

// ---------- Nota da AVALIAÇÃO BÁSICA (modo recreativo) ----------
export const BASIC_FORMULA_VERSION = 1
/** Apresentações mais curtas que isto (s) não recebem nota. */
export const MIN_PERFORMANCE_SEC = 5
/** Fração do tempo com voz que já vale "atividade máxima" (músicas têm trechos instrumentais). */
export const ACTIVITY_FULL_FRACTION = 0.55
/** Fração estável: abaixo de LOW vale 0; a partir de HIGH vale 1. */
export const STABILITY_LOW = 0.4
export const STABILITY_HIGH = 0.85
/** Duração média (s) das corridas de voz: abaixo de LOW vale 0; a partir de HIGH vale 1. */
export const CONTINUITY_LOW_SEC = 0.25
export const CONTINUITY_HIGH_SEC = 1.5
/** Silêncio contínuo: até FREE_SEC não pesa; a partir de ZERO_SEC zera o componente. */
export const SILENCE_FREE_SEC = 8
export const SILENCE_ZERO_SEC = 30
/** Fração de ruído que zera a qualidade. */
export const NOISE_ZERO_FRACTION = 0.35
/** Ruído ambiente (dBFS): até GOOD não pesa; em BAD a qualidade cai ao mínimo AMBIENT_MIN_QUALITY. */
export const AMBIENT_GOOD_DB = -50
export const AMBIENT_BAD_DB = -30
export const AMBIENT_MIN_QUALITY = 0.3
/** Sem pelo menos esta fração com voz, a nota é 0 (evita nota por silêncio ou só ruído). */
export const GATE_MIN_VOICED_FRACTION = 0.1

export const BASIC_WEIGHTS = {
  activity: 0.35,
  stability: 0.25,
  continuity: 0.2,
  silence: 0.1,
  quality: 0.1
} as const

// ---------- Latência ----------
export const MANUAL_LATENCY_MIN_MS = -200
export const MANUAL_LATENCY_MAX_MS = 600
/** Atraso máximo (s) do processamento; acima disso os quadros são descartados até recuperar. */
export const MAX_BACKLOG_SEC = 0.25
/** Intervalo máximo (s) entre quadros aceito como contínuo (acima disso é lacuna, não tempo cantado). */
export const MAX_FRAME_GAP_SEC = 0.5
/** Tempo extra (s) após o fim da música para receber os últimos quadros do microfone. */
export const FINISH_GRACE_SEC = 0.3
/** Pausas mais longas que isto (s) liberam o microfone; ele reabre ao retomar. */
export const PAUSE_RELEASE_SEC = 20
