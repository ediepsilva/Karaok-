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

// ---------- Nota da AVALIAÇÃO COM MELODIA DE REFERÊNCIA (Fase 4B) ----------
export const REFERENCE_FORMULA_VERSION = 1
/** Erro de pitch (centésimos de semitom) até o qual o quadro vale ponto cheio; zera em ZERO. */
export const PITCH_FULL_CENTS = 30
export const PITCH_ZERO_CENTS = 200
/** Uma nota conta como "acertada" se a mediana do erro ficar até aqui (e houve voz suficiente). */
export const NOTE_HIT_CENTS = 50
/** Tolerância (centésimos) para considerar o pitch "dentro da nota" na duração e na entrada. */
export const SUSTAIN_TOLERANCE_CENTS = 100
export const ONSET_TOLERANCE_CENTS = 150
/** Fração da nota que precisa soar dentro da tolerância para a duração valer o máximo. */
export const SUSTAIN_FULL_FRACTION = 0.8
/** Presença: fração do tempo das notas com voz que vale o máximo. */
export const PRESENCE_FULL_FRACTION = 0.85
/** Ignora o ataque da nota (s, no máximo 30% dela) ao medir a afinação. */
export const ATTACK_TRIM_SEC = 0.1
/** Entrada: até este atraso (s) vale o máximo; a partir de ZERO vale 0. */
export const ONSET_FULL_SEC = 0.1
export const ONSET_ZERO_SEC = 0.4
/** Janela (s) em torno do início da nota onde se procura a entrada do cantor. */
export const ONSET_SEARCH_BEFORE_SEC = 0.3
export const ONSET_SEARCH_AFTER_SEC = 0.5
/** Tempo mínimo (s) do canto dentro do pitch para reconhecer uma entrada. */
export const ONSET_HOLD_SEC = 0.06
/** Intervalo (s) entre notas a partir do qual começa uma nova frase. */
export const PHRASE_GAP_SEC = 0.6
/** Consistência: desvio-padrão do pitch na nota (centésimos); ≤ LOW vale 1, ≥ HIGH vale 0. */
export const CONSISTENCY_LOW_CENTS = 30
export const CONSISTENCY_HIGH_CENTS = 120
/** Sem transposição: acima disto (semitons) a mediana do erro vira "cantou em outro tom". */
export const TRANSPOSE_MIN_SEMITONES = 0.8
/** A transposição só é aceita se o desvio for quase um número exato de semitons (tolerância) e o
 *  deslocamento for consistente em ao menos esta fração (por duração) das notas. */
export const TRANSPOSE_MAX_RESIDUAL_SEMITONES = 0.3
export const TRANSPOSE_MIN_CONSISTENCY = 0.6
/** Quadros de voz mínimos numa nota para avaliá-la (senão conta como não cantada). */
export const MIN_NOTE_FRAMES = 3
/** Só entram na avaliação notas dentro do trecho que a apresentação cobriu (folga em s). */
export const RANGE_SLACK_SEC = 0.5
export const MIN_REFERENCE_NOTES = 3
export const MIN_REFERENCE_NOTE_SEC = 3
export const REFERENCE_GATE_MIN_PRESENCE = 0.1

export const REFERENCE_WEIGHTS = {
  pitch: 0.3,
  notes: 0.15,
  rhythm: 0.15,
  phrases: 0.1,
  duration: 0.1,
  presence: 0.1,
  consistency: 0.1
} as const
