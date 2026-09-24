import { describe, expect, it } from 'vitest'
import { CdgBuilder, SOLID_TILE } from '../scripts/lib/cdg-builder'
import {
  CdgDecoder,
  CdgFormatError,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  validateCdg
} from '../src/renderer/src/cdg/cdg-decoder'

const at = (d: CdgDecoder, x: number, y: number): number => d.pixels[y * SCREEN_WIDTH + x] ?? 0
const run = (b: CdgBuilder): CdgDecoder => {
  const d = new CdgDecoder(b.toBuffer())
  d.seekTo(b.length / 300 + 1)
  return d
}

describe('validação', () => {
  it('rejeita arquivo vazio, truncado e sem pacotes CD+G', () => {
    expect(() => validateCdg(new Uint8Array(0))).toThrow(CdgFormatError)
    expect(() => validateCdg(new Uint8Array(23))).toThrow(CdgFormatError)
    expect(() => validateCdg(new Uint8Array(24 * 10))).toThrow(CdgFormatError)
    expect(() => new CdgDecoder(Buffer.from('isto é apenas texto, não é um arquivo cdg'))).toThrow(
      CdgFormatError
    )
  })

  it('rejeita texto cujo primeiro byte coincide com o comando CD+G', () => {
    // 'I' (0x49) & 0x3F === 9, mas a instrução seguinte não é conhecida
    const text = Buffer.from(
      'Isto nao e um arquivo CDG, apenas texto para testar o tratamento de erro.'
    )
    expect(() => validateCdg(text)).toThrow(CdgFormatError)
  })

  it('aceita arquivo com ao menos um pacote CD+G', () => {
    expect(validateCdg(new CdgBuilder().memoryPreset(1).toBuffer())).toBe(1)
  })
})

describe('comandos', () => {
  it('memory preset preenche a tela', () => {
    const d = run(new CdgBuilder().memoryPreset(5))
    expect(at(d, 0, 0)).toBe(5)
    expect(at(d, 150, 108)).toBe(5)
    expect(at(d, SCREEN_WIDTH - 1, SCREEN_HEIGHT - 1)).toBe(5)
  })

  it('border preset altera apenas a cor da borda', () => {
    const d = run(new CdgBuilder().memoryPreset(1).borderPreset(9))
    expect(d.borderColor).toBe(9)
    expect(at(d, 150, 108)).toBe(1)
  })

  it('tile block desenha 6x12 com cor0/cor1 conforme os bits', () => {
    const rows = [0b100001, ...Array<number>(11).fill(0)] // linha 0: pixels 0 e 5 em cor1
    const d = run(new CdgBuilder().memoryPreset(0).tileBlock(2, 3, 4, 7, rows))
    const x0 = 3 * 6
    const y0 = 2 * 12
    expect(at(d, x0, y0)).toBe(7)
    expect(at(d, x0 + 1, y0)).toBe(4)
    expect(at(d, x0 + 5, y0)).toBe(7)
    expect(at(d, x0, y0 + 1)).toBe(4)
    expect(at(d, x0 + 6, y0)).toBe(0) // fora do bloco
  })

  it('tile block XOR combina com o conteúdo existente e é reversível', () => {
    const b = new CdgBuilder().memoryPreset(3).tileBlock(1, 1, 0, 5, SOLID_TILE, true)
    expect(at(run(b), 6, 12)).toBe(3 ^ 5)
    b.tileBlock(1, 1, 0, 5, SOLID_TILE, true)
    expect(at(run(b), 6, 12)).toBe(3)
  })

  it('tile block fora da tela é ignorado sem falhar', () => {
    expect(() =>
      run(new CdgBuilder().memoryPreset(0).tileBlock(31, 63, 1, 2, SOLID_TILE))
    ).not.toThrow()
  })

  it('carrega tabela de cores baixa e alta (12 bits → 8 bits)', () => {
    const low = Array.from({ length: 8 }, (_, i) => [i, 0, 15 - i] as [number, number, number])
    const d = run(new CdgBuilder().loadColors(false, low).loadColors(true, [[15, 8, 0]]))
    expect(Array.from(d.palette.slice(4, 8))).toEqual([17, 0, 238, 255]) // cor 1 = (1, 0, 14)
    expect(Array.from(d.palette.slice(32, 36))).toEqual([255, 136, 0, 255]) // cor 8 = (15, 8, 0)
  })

  it('define cor transparente (alfa 0)', () => {
    const d = run(
      new CdgBuilder()
        .loadColors(false, [
          [0, 0, 0],
          [15, 0, 0]
        ])
        .defineTransparent(1)
    )
    expect(d.palette[1 * 4 + 3]).toBe(0)
    expect(d.palette[0 * 4 + 3]).toBe(255)
  })

  it('scroll preset desloca 12px para cima preenchendo com a cor', () => {
    const d = run(
      new CdgBuilder()
        .memoryPreset(0)
        .tileBlock(1, 5, 0, 9, SOLID_TILE)
        .scroll({ copy: false, color: 2, v: 'up' })
    )
    expect(at(d, 30, 0)).toBe(9) // bloco subiu da linha 12 para a linha 0
    expect(at(d, 30, 12)).toBe(0)
    expect(at(d, 30, SCREEN_HEIGHT - 1)).toBe(2) // preenchimento embaixo
  })

  it('scroll copy dá a volta na tela', () => {
    const d = run(
      new CdgBuilder()
        .memoryPreset(0)
        .tileBlock(0, 0, 0, 6, SOLID_TILE)
        .scroll({ copy: true, v: 'up' })
    )
    expect(at(d, 0, 0)).toBe(0)
    expect(at(d, 0, SCREEN_HEIGHT - 12)).toBe(6) // bloco reapareceu embaixo
  })

  it('scroll horizontal move 6px para a direita e para a esquerda', () => {
    const right = run(
      new CdgBuilder()
        .memoryPreset(0)
        .tileBlock(3, 10, 0, 4, SOLID_TILE)
        .scroll({ copy: true, h: 'right' })
    )
    expect(at(right, 11 * 6, 3 * 12)).toBe(4)
    expect(at(right, 10 * 6, 3 * 12)).toBe(0)
    const left = run(
      new CdgBuilder()
        .memoryPreset(0)
        .tileBlock(3, 10, 0, 4, SOLID_TILE)
        .scroll({ copy: false, color: 1, h: 'left' })
    )
    expect(at(left, 9 * 6, 3 * 12)).toBe(4)
  })

  it('deslocamento fino (offset) é aplicado apenas na exibição', () => {
    const d = run(new CdgBuilder().memoryPreset(0).scroll({ copy: true, hOffset: 3, vOffset: 5 }))
    expect(d.hOffset).toBe(3)
    expect(d.vOffset).toBe(5)
  })
})

describe('sincronização por tempo', () => {
  const build = (): CdgBuilder =>
    new CdgBuilder()
      .memoryPreset(1) // t=0
      .padToSecond(1)
      .memoryPreset(2) // t=1s
      .padToSecond(2)
      .memoryPreset(3) // t=2s
      .padToSecond(3)

  it('só aplica pacotes até o instante informado', () => {
    const d = new CdgDecoder(build().toBuffer())
    d.seekTo(0.5)
    expect(at(d, 10, 10)).toBe(1)
    d.seekTo(1.01)
    expect(at(d, 10, 10)).toBe(2)
    d.seekTo(2.5)
    expect(at(d, 10, 10)).toBe(3)
  })

  it('suporta seek para trás (reprocessa do início)', () => {
    const d = new CdgDecoder(build().toBuffer())
    d.seekTo(2.5)
    d.seekTo(0.5)
    expect(at(d, 10, 10)).toBe(1)
  })

  it('informa se a imagem mudou (pausa não altera nada)', () => {
    const d = new CdgDecoder(build().toBuffer())
    expect(d.seekTo(0.5)).toBe(true)
    expect(d.seekTo(0.5)).toBe(false)
    expect(d.seekTo(0.6)).toBe(false)
    expect(d.seekTo(1.1)).toBe(true)
  })

  it('tempos inválidos ou além do fim não quebram', () => {
    const d = new CdgDecoder(build().toBuffer())
    expect(() => {
      d.seekTo(NaN)
      d.seekTo(-5)
      d.seekTo(9999)
    }).not.toThrow()
    expect(at(d, 10, 10)).toBe(3)
  })

  it('reset volta à tela preta', () => {
    const d = new CdgDecoder(build().toBuffer())
    d.seekTo(2.5)
    d.reset()
    expect(at(d, 10, 10)).toBe(0)
  })
})

describe('writeRgba', () => {
  it('pinta borda e área interna com cores da paleta', () => {
    const d = run(
      new CdgBuilder()
        .loadColors(false, [
          [0, 0, 0],
          [15, 0, 0],
          [0, 15, 0]
        ])
        .memoryPreset(1)
        .borderPreset(2)
    )
    const out = new Uint8ClampedArray(SCREEN_WIDTH * SCREEN_HEIGHT * 4)
    d.writeRgba(out)
    const px = (x: number, y: number): number[] => {
      const o = (y * SCREEN_WIDTH + x) * 4
      return [out[o] ?? 0, out[o + 1] ?? 0, out[o + 2] ?? 0, out[o + 3] ?? 0]
    }
    expect(px(150, 108)).toEqual([255, 0, 0, 255])
    expect(px(0, 0)).toEqual([0, 255, 0, 255])
  })
})
