import { describe, expect, it } from 'vitest'
import { pickCelebrationMessage, scoreTier } from '../src/renderer/src/celebration/tts-messages'

describe('scoreTier', () => {
  it('classifica as faixas de nota corretamente', () => {
    expect(scoreTier(95)).toBe('excelente')
    expect(scoreTier(90)).toBe('excelente')
    expect(scoreTier(89)).toBe('muito-bom')
    expect(scoreTier(70)).toBe('muito-bom')
    expect(scoreTier(69)).toBe('bom')
    expect(scoreTier(50)).toBe('bom')
    expect(scoreTier(49)).toBe('regular')
    expect(scoreTier(30)).toBe('regular')
    expect(scoreTier(29)).toBe('incentivo')
    expect(scoreTier(0)).toBe('incentivo')
  })
})

describe('pickCelebrationMessage', () => {
  it('inclui o nome do cantor e a nota arredondada', () => {
    const message = pickCelebrationMessage({ score: 87.6, singer: 'Maria', pick: () => 0 })
    expect(message).toContain('Maria')
    expect(message).toContain('88')
  })

  it('usa "cantor" quando não há nome informado', () => {
    const message = pickCelebrationMessage({ score: 60, singer: '  ', pick: () => 0 })
    expect(message).toContain('cantor')
  })

  it('respeita o índice sorteado (pick) dentro da faixa da nota', () => {
    const a = pickCelebrationMessage({ score: 95, singer: 'Ana', pick: () => 0 })
    const b = pickCelebrationMessage({ score: 95, singer: 'Ana', pick: () => 1 })
    expect(a).not.toBe(b)
  })

  it('nunca deixa marcadores {singer}/{score} sem substituir', () => {
    for (let score = 0; score <= 100; score += 5) {
      const message = pickCelebrationMessage({ score, singer: 'Joana', pick: () => 0 })
      expect(message).not.toMatch(/\{singer\}|\{score\}/)
    }
  })

  it('índice fora da faixa (pick mal comportado) não quebra: usa o mais próximo válido', () => {
    expect(() => pickCelebrationMessage({ score: 50, singer: 'X', pick: () => 999 })).not.toThrow()
    expect(() => pickCelebrationMessage({ score: 50, singer: 'X', pick: () => -5 })).not.toThrow()
  })
})
