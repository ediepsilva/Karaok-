/**
 * Níveis de dificuldade da avaliação vocal. O MESMO motor de avaliação (basic-score.ts,
 * reference-score.ts) é usado nos três níveis; só a tolerância e o peso de certos componentes
 * mudam, por perfil. Nada disso troca a AVALIAÇÃO BÁSICA por AVALIAÇÃO COM MELODIA nem vice-versa
 * — isso continua decidido só pela existência de uma melodia (Fase 4B).
 */

export type EvaluationLevel = 'amateur' | 'semiPro' | 'professional'

export const EVALUATION_LEVELS: readonly EvaluationLevel[] = ['amateur', 'semiPro', 'professional']

/** Multiplicadores aplicados ao peso de cada componente "de técnica" (afinação, ritmo, etc.). */
export interface ProfileWeights {
  /** Afinação (reference: pitch). */
  pitch: number
  /** Ritmo / entradas (reference: rhythm e phrases; basic: não se aplica). */
  timing: number
  /** Estabilidade / consistência (reference: consistency; basic: stability). */
  stability: number
  /** Duração das notas / continuidade das frases (reference: duration; basic: continuity). */
  continuity: number
}

export interface EvaluationProfile {
  level: EvaluationLevel
  label: string
  shortDescription: string
  /**
   * Expoente da curva de tolerância (ver `reshapeForTolerance`): 1 = neutro (o valor medido vale
   * o que vale). Menor que 1 = mais tolerante (a mesma medição rende mais crédito). Maior que 1 =
   * mais rígido (a mesma medição rende menos crédito).
   */
  toleranceExponent: number
  weight: ProfileWeights
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

/**
 * Reformata um componente 0–1 pela tolerância do nível. 0 continua 0 e 1 continua 1 (nunca
 * inventa nota do nada, nem tira quem acertou perfeitamente); valores no meio sobem (tolerante)
 * ou descem (rígido) conforme o expoente. Ex.: 0,6 com expoente 0,6 vira ≈0,74; com expoente 1,6
 * vira ≈0,44.
 */
export function reshapeForTolerance(value: number, exponent: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return clamp01(Math.pow(value, exponent))
}

// O multiplicador de peso só sobe (nunca desce): numa fórmula que soma pesos direto (a AVALIAÇÃO
// BÁSICA não é uma média renormalizada), reduzir o peso de um componente reduz a nota mesmo que
// a curva de tolerância daquele componente fique mais generosa — as duas coisas remariam uma à
// outra. Por isso a tolerância (toleranceExponent) é quem torna o Amador mais generoso; o peso
// maior só entra para tornar o Profissional ainda mais exigente, reforçando (não contrariando) a
// tolerância mais apertada dele.
export const EVALUATION_PROFILES: Readonly<Record<EvaluationLevel, EvaluationProfile>> = {
  amateur: {
    level: 'amateur',
    label: 'Amador',
    shortDescription: 'Mais tolerante e voltado à diversão.',
    toleranceExponent: 0.6,
    weight: { pitch: 1, timing: 1, stability: 1, continuity: 1 }
  },
  semiPro: {
    level: 'semiPro',
    label: 'Semiprofissional',
    shortDescription: 'Avaliação intermediária.',
    toleranceExponent: 1,
    weight: { pitch: 1, timing: 1, stability: 1, continuity: 1 }
  },
  professional: {
    level: 'professional',
    label: 'Profissional',
    shortDescription: 'Avaliação mais rigorosa.',
    toleranceExponent: 1.6,
    weight: { pitch: 1.3, timing: 1.3, stability: 1.25, continuity: 1.25 }
  }
}

export const DEFAULT_EVALUATION_LEVEL: EvaluationLevel = 'amateur'

export function profileFor(level: EvaluationLevel): EvaluationProfile {
  return EVALUATION_PROFILES[level]
}

/** Próximo nível acima, ou null se já é o topo (Profissional). */
export function nextLevel(level: EvaluationLevel): EvaluationLevel | null {
  const i = EVALUATION_LEVELS.indexOf(level)
  return i >= 0 && i + 1 < EVALUATION_LEVELS.length ? EVALUATION_LEVELS[i + 1]! : null
}

/** Nota (0–100) a partir da qual o app oferece subir de nível. */
export const PROMOTION_MIN_SCORE = 90

/** Nível para o qual oferecer promoção, ou null se a nota não chegou lá ou já é o nível máximo. */
export function shouldOfferPromotion(
  level: EvaluationLevel,
  score: number
): EvaluationLevel | null {
  if (score < PROMOTION_MIN_SCORE) return null
  return nextLevel(level)
}
