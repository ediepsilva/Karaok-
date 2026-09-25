/**
 * Constantes da Fase 5 (aplausos + voz). Documentação da fórmula: docs/FASE5_APLAUSOS_VOZ.md.
 */

// ---------- Aplausos (proporcionais à nota) ----------
/** Nota mínima (0–100) para tocar aplausos. Abaixo disto, silêncio educado é mais realista. */
export const APPLAUSE_MIN_SCORE = 0
export const APPLAUSE_MIN_CLAPS = 6
export const APPLAUSE_MAX_CLAPS = 70
export const APPLAUSE_MIN_PEAK_GAIN = 0.18
export const APPLAUSE_MAX_PEAK_GAIN = 0.85
export const APPLAUSE_MIN_DURATION_SEC = 1.8
export const APPLAUSE_MAX_DURATION_SEC = 5.5
/** A partir desta nota, some assobios/gritos de torcida aos aplausos. */
export const APPLAUSE_CHEER_SCORE = 85
/** Duração de cada palma individual (s). */
export const CLAP_DURATION_SEC = 0.02
/** Ataque/liberação do "tapete" de aplausos (envelope), em fração da duração total. */
export const BED_ATTACK_FRACTION = 0.12
export const BED_RELEASE_FRACTION = 0.35

// ---------- Locução (Text-to-Speech) ----------
/** Espera após o início dos aplausos antes de falar (deixa a "plateia" reagir primeiro). */
export const SPEECH_DELAY_SEC = 0.7
export const SPEECH_RATE = 1.03
export const SPEECH_PITCH = 1.0
/** Prefixo de idioma aceito para escolher a voz (pt-BR, pt-PT, ou qualquer "pt-*"). */
export const SPEECH_LANG_PREFIX = 'pt'
export const SPEECH_LANG_FALLBACK = 'pt-BR'

// ---------- Ducking (aplausos abaixam durante a fala) ----------
export const DUCK_GAIN_WHILE_SPEAKING = 0.22
export const DUCK_RAMP_DOWN_SEC = 0.25
export const DUCK_RAMP_UP_SEC = 0.4

// ---------- Fade-out final ----------
/** Quanto os aplausos continuam depois da fala terminar, antes de começar a apagar. */
export const HOLD_AFTER_SPEECH_SEC = 0.8
export const FADE_OUT_SEC = 2.5
/** Se a fala nunca terminar (voz indisponível), aplausos são cortados no máximo depois disto. */
export const MAX_TOTAL_SEC = 20
