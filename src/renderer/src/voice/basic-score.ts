import {
  EVALUATION_PROFILES,
  reshapeForTolerance,
  type EvaluationProfile
} from './evaluation-profile'
import type { VoiceSummary } from './voice-metrics'
import {
  ACTIVITY_FULL_FRACTION,
  AMBIENT_BAD_DB,
  AMBIENT_GOOD_DB,
  AMBIENT_MIN_QUALITY,
  BASIC_FORMULA_VERSION,
  BASIC_WEIGHTS,
  CONTINUITY_HIGH_SEC,
  CONTINUITY_LOW_SEC,
  GATE_MIN_VOICED_FRACTION,
  MIN_PERFORMANCE_SEC,
  NOISE_ZERO_FRACTION,
  SILENCE_FREE_SEC,
  SILENCE_ZERO_SEC,
  STABILITY_HIGH,
  STABILITY_LOW
} from './voice-config'
import { MODE_LABELS } from './reference'

export interface BasicComponents {
  /** 0–1: quanto do tempo houve voz (atividade vocal / cobertura). */
  activity: number
  /** 0–1: estabilidade do pitch dentro das notas (sem julgar QUAL nota). */
  stability: number
  /** 0–1: continuidade das frases (duração média das corridas de voz). */
  continuity: number
  /** 0–1: ausência de silêncios longos. */
  silence: number
  /** 0–1: pouco ruído/chiado e sem saturação. */
  quality: number
}

export interface BasicScore {
  mode: 'basic'
  label: string
  formulaVersion: number
  /** 0–100, ou null se a apresentação foi curta demais para avaliar. */
  score: number | null
  insufficientReason: string | null
  /** Componentes já ajustados pelo nível (o que realmente contou para a nota). */
  components: BasicComponents
  /** Aviso obrigatório: o que esta nota NÃO significa. */
  disclaimer: string
}

export const BASIC_DISCLAIMER =
  'Esta nota mede atividade vocal, estabilidade, continuidade e qualidade do sinal. ' +
  'NÃO mede se você cantou as notas certas: sem uma melodia de referência isso não é possível.'

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))
const ramp = (x: number, low: number, high: number): number => clamp01((x - low) / (high - low))

/** Ruído ambiente: 1 até AMBIENT_GOOD_DB, caindo linearmente até AMBIENT_MIN_QUALITY em BAD. */
function ambientQuality(ambientDb: number): number {
  const t = ramp(ambientDb, AMBIENT_GOOD_DB, AMBIENT_BAD_DB)
  return 1 - t * (1 - AMBIENT_MIN_QUALITY)
}

export function basicComponents(s: VoiceSummary): BasicComponents {
  return {
    activity: clamp01(s.voicedFraction / ACTIVITY_FULL_FRACTION),
    stability: s.voicedSec === 0 ? 0 : ramp(s.stableFraction, STABILITY_LOW, STABILITY_HIGH),
    continuity:
      s.voicedRunCount === 0 ? 0 : ramp(s.meanRunSec, CONTINUITY_LOW_SEC, CONTINUITY_HIGH_SEC),
    silence: 1 - ramp(s.longestGapSec, SILENCE_FREE_SEC, SILENCE_ZERO_SEC),
    quality: clamp01(
      (1 - clamp01(s.noiseFraction / NOISE_ZERO_FRACTION) - s.clippingFraction * 2) *
        ambientQuality(s.ambientNoiseDb)
    )
  }
}

/**
 * AVALIAÇÃO BÁSICA (modo recreativo):
 *
 *   evidência = atividade                    (0–1: o quanto a pessoa realmente cantou)
 *   nota = 100 × gate × ( 0,35·atividade
 *                       + evidência × (0,25·estabilidade + 0,20·continuidade
 *                                      + 0,10·silêncio + 0,10·qualidade) )
 *   gate = min(1, fração_com_voz / 0,10)     → sem voz, a nota é 0
 *
 * As parcelas de "qualidade do canto" valem em proporção à evidência: quem canta 1 s numa música
 * de 11 s não ganha pontos de estabilidade/continuidade "perfeitas" sobre quase nada.
 * Determinística: a mesma medição sempre dá a mesma nota. Ver docs/AVALIACAO_BASICA.md.
 */
/**
 * Aplica a tolerância e o peso do nível aos dois componentes "de técnica" (estabilidade e
 * continuidade); atividade, silêncio e qualidade não são sobre TÉCNICA de canto e ficam iguais
 * em qualquer nível. Ver docs/NIVEIS_AVALIACAO.md.
 */
function applyProfile(components: BasicComponents, profile: EvaluationProfile): BasicComponents {
  return {
    ...components,
    stability: reshapeForTolerance(components.stability, profile.toleranceExponent),
    continuity: reshapeForTolerance(components.continuity, profile.toleranceExponent)
  }
}

export function computeBasicScore(
  summary: VoiceSummary,
  profile: EvaluationProfile = EVALUATION_PROFILES.semiPro
): BasicScore {
  const components = applyProfile(basicComponents(summary), profile)
  const base = {
    mode: 'basic' as const,
    label: MODE_LABELS.basic,
    formulaVersion: BASIC_FORMULA_VERSION,
    components,
    disclaimer: BASIC_DISCLAIMER
  }
  if (summary.durationSec < MIN_PERFORMANCE_SEC) {
    return {
      ...base,
      score: null,
      insufficientReason: `Apresentação curta demais para avaliar (mínimo ${MIN_PERFORMANCE_SEC} s).`
    }
  }
  const gate = clamp01(summary.voicedFraction / GATE_MIN_VOICED_FRACTION)
  const evidence = components.activity

  // O "pacote" de qualidade do canto (estabilidade, continuidade, silêncio, qualidade) é
  // renormalizado pelo próprio peso: assim, o multiplicador do perfil só troca a IMPORTÂNCIA
  // relativa entre esses componentes (mais peso em estabilidade/continuidade tira peso relativo
  // de silêncio/qualidade), sem mudar a escala total — o mesmo truque que a AVALIAÇÃO COM
  // MELODIA já usa. Sem isso, aumentar peso E apertar a tolerância ao mesmo tempo podem se anular
  // (ou até inverter) para quem já canta razoavelmente estável.
  const bundleWeight =
    BASIC_WEIGHTS.stability * profile.weight.stability +
    BASIC_WEIGHTS.continuity * profile.weight.continuity +
    BASIC_WEIGHTS.silence +
    BASIC_WEIGHTS.quality
  const bundleValue =
    (BASIC_WEIGHTS.stability * profile.weight.stability * components.stability +
      BASIC_WEIGHTS.continuity * profile.weight.continuity * components.continuity +
      BASIC_WEIGHTS.silence * components.silence +
      BASIC_WEIGHTS.quality * components.quality) /
    bundleWeight
  const bundleShare =
    BASIC_WEIGHTS.stability +
    BASIC_WEIGHTS.continuity +
    BASIC_WEIGHTS.silence +
    BASIC_WEIGHTS.quality
  const weighted =
    BASIC_WEIGHTS.activity * components.activity + evidence * bundleShare * bundleValue
  return {
    ...base,
    score: Math.round(100 * gate * weighted),
    insufficientReason: null
  }
}
