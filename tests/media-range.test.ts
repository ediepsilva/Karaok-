import { describe, expect, it } from 'vitest'

// O módulo importa 'electron'; para testar só a função pura, mockamos o pacote.
import { vi } from 'vitest'
vi.mock('electron', () => ({ protocol: {} }))

const { parseRange } = await import('../src/main/media-protocol')

describe('parseRange', () => {
  it('sem cabeçalho devolve null (arquivo inteiro)', () => {
    expect(parseRange(null, 1000)).toBeNull()
  })

  it('intervalo fechado e aberto', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
  })

  it('limita o fim ao tamanho do arquivo', () => {
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('suffix range (últimos N bytes)', () => {
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 })
  })

  it('rejeita intervalos inválidos ou fora do arquivo', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('invalid')
    expect(parseRange('bytes=50-10', 1000)).toBe('invalid')
    expect(parseRange('bytes=-', 1000)).toBe('invalid')
    expect(parseRange('bytes=-0', 1000)).toBe('invalid')
    expect(parseRange('items=0-1', 1000)).toBe('invalid')
    expect(parseRange('bytes=0-1,5-9', 1000)).toBe('invalid')
  })
})
