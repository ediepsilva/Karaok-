import { describe, expect, it } from 'vitest'
import {
  EVALUATION_PROFILES,
  nextLevel,
  PROMOTION_MIN_SCORE,
  profileFor,
  reshapeForTolerance,
  shouldOfferPromotion
} from '../src/renderer/src/voice/evaluation-profile'

describe('reshapeForTolerance', () => {
  it('nunca inventa nota (0 continua 0) nem tira quem foi perfeito (1 continua 1)', () => {
    for (const exponent of [0.4, 1, 1.6, 3]) {
      expect(reshapeForTolerance(0, exponent)).toBe(0)
      expect(reshapeForTolerance(1, exponent)).toBe(1)
    }
  })

  it('expoente 1 é neutro (não muda o valor)', () => {
    expect(reshapeForTolerance(0.42, 1)).toBeCloseTo(0.42, 10)
  })

  it('expoente menor que 1 sobe valores intermediários (mais tolerante)', () => {
    expect(reshapeForTolerance(0.5, 0.6)).toBeGreaterThan(0.5)
  })

  it('expoente maior que 1 desce valores intermediários (mais rígido)', () => {
    expect(reshapeForTolerance(0.5, 1.6)).toBeLessThan(0.5)
  })

  it('é monotônico em relação ao valor de entrada, para um mesmo expoente', () => {
    for (const exponent of [0.6, 1, 1.6]) {
      let previous = -1
      for (let v = 0; v <= 1; v += 0.05) {
        const reshaped = reshapeForTolerance(v, exponent)
        expect(reshaped).toBeGreaterThanOrEqual(previous)
        previous = reshaped
      }
    }
  })
})

describe('perfis de avaliação', () => {
  it('amador é mais tolerante que semiprofissional, que é mais tolerante que profissional', () => {
    const a = profileFor('amateur')
    const s = profileFor('semiPro')
    const p = profileFor('professional')
    expect(a.toleranceExponent).toBeLessThan(s.toleranceExponent)
    expect(s.toleranceExponent).toBeLessThan(p.toleranceExponent)
    // o peso só sobe para o Profissional (ver comentário em evaluation-profile.ts): reduzi-lo no
    // Amador brigaria com a tolerância mais generosa numa fórmula que soma pesos direto.
    expect(a.weight.pitch).toBe(s.weight.pitch)
    expect(s.weight.pitch).toBeLessThan(p.weight.pitch)
  })

  it('semiprofissional é o perfil neutro (expoente 1, pesos 1)', () => {
    const s = EVALUATION_PROFILES.semiPro
    expect(s.toleranceExponent).toBe(1)
    expect(Object.values(s.weight).every((w) => w === 1)).toBe(true)
  })
})

describe('nextLevel / shouldOfferPromotion', () => {
  it('a progressão é amador → semiprofissional → profissional → (nada)', () => {
    expect(nextLevel('amateur')).toBe('semiPro')
    expect(nextLevel('semiPro')).toBe('professional')
    expect(nextLevel('professional')).toBeNull()
  })

  it('amador com nota >= 90 oferece promoção para semiprofissional', () => {
    expect(shouldOfferPromotion('amateur', PROMOTION_MIN_SCORE)).toBe('semiPro')
    expect(shouldOfferPromotion('amateur', 100)).toBe('semiPro')
  })

  it('amador abaixo de 90 não oferece promoção', () => {
    expect(shouldOfferPromotion('amateur', PROMOTION_MIN_SCORE - 0.01)).toBeNull()
    expect(shouldOfferPromotion('amateur', 0)).toBeNull()
  })

  it('semiprofissional com nota >= 90 oferece promoção para profissional', () => {
    expect(shouldOfferPromotion('semiPro', 90)).toBe('professional')
  })

  it('profissional nunca oferece promoção, mesmo com nota máxima', () => {
    expect(shouldOfferPromotion('professional', 100)).toBeNull()
  })
})
