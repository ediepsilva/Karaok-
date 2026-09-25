import { describe, expect, it } from 'vitest'
import { computeApplausePlan } from '../src/renderer/src/celebration/applause-plan'

describe('computeApplausePlan', () => {
  it('nota 0 ainda gera uma salva de palmas educada (nunca silêncio total)', () => {
    const plan = computeApplausePlan(0)
    expect(plan.claps).toBeGreaterThan(0)
    expect(plan.peakGain).toBeGreaterThan(0)
    expect(plan.durationSec).toBeGreaterThan(0)
    expect(plan.cheer).toBe(false)
  })

  it('nota 100 gera o máximo de palmas, volume, duração e assobio', () => {
    const plan = computeApplausePlan(100)
    const zero = computeApplausePlan(0)
    expect(plan.claps).toBeGreaterThan(zero.claps)
    expect(plan.peakGain).toBeGreaterThan(zero.peakGain)
    expect(plan.durationSec).toBeGreaterThan(zero.durationSec)
    expect(plan.cheer).toBe(true)
  })

  it('é monotônico: nota mais alta nunca gera aplauso mais fraco', () => {
    let previous = computeApplausePlan(0)
    for (let score = 10; score <= 100; score += 10) {
      const plan = computeApplausePlan(score)
      expect(plan.claps).toBeGreaterThanOrEqual(previous.claps)
      expect(plan.peakGain).toBeGreaterThanOrEqual(previous.peakGain)
      expect(plan.durationSec).toBeGreaterThanOrEqual(previous.durationSec)
      previous = plan
    }
  })

  it('assobio só aparece a partir da nota de corte (85)', () => {
    expect(computeApplausePlan(84).cheer).toBe(false)
    expect(computeApplausePlan(85).cheer).toBe(true)
  })

  it('tolera notas fora de 0–100 sem gerar valores negativos ou absurdos', () => {
    const negative = computeApplausePlan(-20)
    const over = computeApplausePlan(150)
    expect(negative.claps).toBeGreaterThan(0)
    expect(over.claps).toBe(computeApplausePlan(100).claps)
  })
})
