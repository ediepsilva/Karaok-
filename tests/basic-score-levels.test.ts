import { describe, expect, it } from 'vitest'
import { concat, frames, silence, voiceTone } from '../scripts/lib/voice-signals'
import { computeBasicScore } from '../src/renderer/src/voice/basic-score'
import { EVALUATION_PROFILES } from '../src/renderer/src/voice/evaluation-profile'
import { HOP_SAMPLES, WINDOW_SAMPLES } from '../src/renderer/src/voice/voice-config'
import { VoiceAnalyzer, type FrameAnalysis } from '../src/renderer/src/voice/voice-analyzer'
import { VoiceMetrics } from '../src/renderer/src/voice/voice-metrics'

const SR = 48000
const FRAME_SEC = HOP_SAMPLES / SR

function analyze(signal: Float32Array): FrameAnalysis[] {
  const analyzer = new VoiceAnalyzer(SR)
  const out: FrameAnalysis[] = []
  for (const { samples, endIndex } of frames(signal, WINDOW_SAMPLES, HOP_SAMPLES)) {
    out.push(analyzer.analyze(samples, endIndex / SR))
  }
  return out
}

function summarize(signal: Float32Array): ReturnType<VoiceMetrics['summary']> {
  const metrics = new VoiceMetrics(FRAME_SEC)
  for (const f of analyze(signal)) metrics.add(f)
  return metrics.summary()
}

/**
 * Apresentação com defeitos típicos de quem está aprendendo: vibrato exagerado (pitch instável)
 * e frases curtas com pausas frequentes (continuidade baixa) — nem perfeita, nem silêncio total,
 * para as diferenças de tolerância entre níveis realmente aparecerem.
 */
const IMPERFECT = concat(
  ...Array.from({ length: 8 }, () =>
    concat(voiceTone(220, 0.6, SR, { vibratoCents: 70, vibratoHz: 6.5 }), silence(0.35, SR))
  )
)

describe('Níveis de dificuldade (Amador / Semiprofissional / Profissional) — avaliação básica', () => {
  it('a mesma apresentação rende nota progressivamente menor em níveis mais altos', () => {
    const summary = summarize(IMPERFECT)
    const amateur = computeBasicScore(summary, EVALUATION_PROFILES.amateur).score!
    const semiPro = computeBasicScore(summary, EVALUATION_PROFILES.semiPro).score!
    const professional = computeBasicScore(summary, EVALUATION_PROFILES.professional).score!
    expect(amateur).toBeGreaterThan(semiPro)
    expect(semiPro).toBeGreaterThan(professional)
  })

  it('sem perfil (padrão), o resultado é idêntico ao perfil Semiprofissional', () => {
    const summary = summarize(IMPERFECT)
    const withDefault = computeBasicScore(summary)
    const withSemiPro = computeBasicScore(summary, EVALUATION_PROFILES.semiPro)
    expect(withDefault.score).toBe(withSemiPro.score)
    expect(withDefault.components).toEqual(withSemiPro.components)
  })

  it('nunca passa de 100, mesmo com os pesos do nível Profissional multiplicados', () => {
    const steady = summarize(voiceTone(220, 8, SR))
    for (const profile of Object.values(EVALUATION_PROFILES)) {
      expect(computeBasicScore(steady, profile).score).toBeLessThanOrEqual(100)
    }
  })
})
