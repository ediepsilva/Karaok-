import { describe, expect, it } from 'vitest'
import {
  levelFor,
  normalizeSingerName,
  parseSingerLevels,
  withLevel
} from '../src/renderer/src/voice/singer-level-prefs'

describe('normalizeSingerName', () => {
  it('ignora maiúsculas/minúsculas e espaços nas pontas', () => {
    expect(normalizeSingerName('  Raphael  ')).toBe('raphael')
    expect(normalizeSingerName('RAPHAEL')).toBe('raphael')
  })
})

describe('levelFor', () => {
  it('cantor novo (sem histórico) começa no Amador', () => {
    expect(levelFor({}, 'Alguém Novo')).toBe('amateur')
  })

  it('cantor sem nome (fila vazia) também cai no Amador, sem quebrar', () => {
    expect(levelFor({}, '   ')).toBe('amateur')
    expect(levelFor({}, '')).toBe('amateur')
  })

  it('devolve o nível guardado, ignorando maiúsculas/espaços no nome', () => {
    const levels = { raphael: 'semiPro' as const }
    expect(levelFor(levels, 'Raphael')).toBe('semiPro')
    expect(levelFor(levels, '  RAPHAEL  ')).toBe('semiPro')
  })
})

describe('withLevel', () => {
  it('guarda o nível sem alterar o mapa original (imutável)', () => {
    const before = { ana: 'amateur' as const }
    const after = withLevel(before, 'Ana', 'semiPro')
    expect(before.ana).toBe('amateur')
    expect(after.ana).toBe('semiPro')
  })

  it('não guarda nada para um nome vazio', () => {
    expect(withLevel({}, '   ', 'professional')).toEqual({})
  })

  it('cantores diferentes guardam níveis independentes', () => {
    let levels = withLevel({}, 'Ana', 'professional')
    levels = withLevel(levels, 'Bia', 'amateur')
    expect(levelFor(levels, 'Ana')).toBe('professional')
    expect(levelFor(levels, 'Bia')).toBe('amateur')
  })
})

describe('parseSingerLevels', () => {
  it('JSON vazio/ausente/inválido nunca quebra: devolve mapa vazio', () => {
    expect(parseSingerLevels(null)).toEqual({})
    expect(parseSingerLevels('')).toEqual({})
    expect(parseSingerLevels('{not json')).toEqual({})
    expect(parseSingerLevels('42')).toEqual({})
    expect(parseSingerLevels('null')).toEqual({})
  })

  it('descarta níveis inválidos mas mantém os válidos', () => {
    const parsed = parseSingerLevels(
      JSON.stringify({ ana: 'semiPro', bia: 'nivel-invalido', carla: 123 })
    )
    expect(parsed).toEqual({ ana: 'semiPro' })
  })

  it('ida e volta (guardar e ler) preserva o nível', () => {
    const levels = withLevel({}, 'Zeca', 'professional')
    const parsed = parseSingerLevels(JSON.stringify(levels))
    expect(levelFor(parsed, 'Zeca')).toBe('professional')
  })
})
