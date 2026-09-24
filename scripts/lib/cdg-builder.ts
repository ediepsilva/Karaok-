/**
 * Construtor de arquivos CD+G sintéticos. Usado para gerar fixtures de teste e montar pacotes
 * nos testes unitários do decodificador. Não faz parte do aplicativo em produção.
 */

const PACKET_SIZE = 24
const PACKETS_PER_SECOND = 300

export type Rgb12 = [r: number, g: number, b: number] // cada componente 0-15

export class CdgBuilder {
  private readonly packets: Buffer[] = []

  get length(): number {
    return this.packets.length
  }

  private push(instruction: number, data: number[]): this {
    const packet = Buffer.alloc(PACKET_SIZE)
    packet[0] = 0x09
    packet[1] = instruction
    data.slice(0, 16).forEach((value, i) => {
      packet[4 + i] = value
    })
    this.packets.push(packet)
    return this
  }

  /** Pacotes vazios (comando != 9) até completar `index` pacotes. */
  padTo(index: number): this {
    while (this.packets.length < index) this.packets.push(Buffer.alloc(PACKET_SIZE))
    return this
  }

  padToSecond(seconds: number): this {
    return this.padTo(Math.round(seconds * PACKETS_PER_SECOND))
  }

  memoryPreset(color: number, repeat = 0): this {
    return this.push(1, [color, repeat])
  }

  borderPreset(color: number): this {
    return this.push(2, [color])
  }

  /** `rows` = 12 bytes; cada byte usa 6 bits (bit 5 = pixel mais à esquerda). */
  tileBlock(
    row: number,
    col: number,
    color0: number,
    color1: number,
    rows: number[],
    xor = false
  ): this {
    return this.push(xor ? 38 : 6, [color0, color1, row, col, ...rows])
  }

  scroll(opts: {
    copy: boolean
    color?: number
    h?: 'none' | 'right' | 'left'
    v?: 'none' | 'down' | 'up'
    hOffset?: number
    vOffset?: number
  }): this {
    const h = { none: 0, right: 1, left: 2 }[opts.h ?? 'none']
    const v = { none: 0, down: 1, up: 2 }[opts.v ?? 'none']
    return this.push(opts.copy ? 24 : 20, [
      opts.color ?? 0,
      (h << 4) | (opts.hOffset ?? 0),
      (v << 4) | (opts.vOffset ?? 0)
    ])
  }

  defineTransparent(color: number): this {
    return this.push(28, [color])
  }

  /** Carrega 8 cores da tabela: `high=false` → cores 0-7, `high=true` → cores 8-15. */
  loadColors(high: boolean, colors: Rgb12[]): this {
    const data: number[] = []
    for (const [r, g, b] of colors.slice(0, 8)) {
      const value = (r << 8) | (g << 4) | b
      data.push((value >> 6) & 0x3f, value & 0x3f)
    }
    return this.push(high ? 31 : 30, data)
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.packets)
  }
}

/** Linhas de 6 bits desenhando uma barra cheia (útil para testes visuais simples). */
export const SOLID_TILE = Array<number>(12).fill(0x3f)
