/**
 * Decodificador CD+G (implementação própria, sem dependências).
 *
 * Formato: sequência de pacotes de 24 bytes, 300 pacotes por segundo (7200 bytes/s).
 *   byte 0      comando (&0x3F == 9 → pacote CD+G)
 *   byte 1      instrução (&0x3F)
 *   bytes 2-3   paridade Q
 *   bytes 4-19  dados (16 bytes)
 *   bytes 20-23 paridade P
 *
 * A tela é 300x216 (área visível 288x192 + borda de 6px lateral e 12px vertical) com 16 cores
 * de 12 bits. Este módulo não depende do DOM: produz um buffer de índices de cor e a paleta.
 */

export const PACKET_SIZE = 24
export const PACKETS_PER_SECOND = 300
export const SCREEN_WIDTH = 300
export const SCREEN_HEIGHT = 216
export const BORDER_X = 6
export const BORDER_Y = 12
export const TILE_WIDTH = 6
export const TILE_HEIGHT = 12

const CDG_COMMAND = 9

enum Instruction {
  MemoryPreset = 1,
  BorderPreset = 2,
  TileBlock = 6,
  ScrollPreset = 20,
  ScrollCopy = 24,
  DefineTransparent = 28,
  LoadColorsLow = 30,
  LoadColorsHigh = 31,
  TileBlockXor = 38
}

export class CdgFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CdgFormatError'
  }
}

const KNOWN_INSTRUCTIONS: ReadonlySet<number> = new Set([
  Instruction.MemoryPreset,
  Instruction.BorderPreset,
  Instruction.TileBlock,
  Instruction.ScrollPreset,
  Instruction.ScrollCopy,
  Instruction.DefineTransparent,
  Instruction.LoadColorsLow,
  Instruction.LoadColorsHigh,
  Instruction.TileBlockXor
])

/**
 * Valida o conteúdo de um arquivo CDG e devolve a quantidade de pacotes completos. Exige ao menos
 * um pacote CD+G com instrução conhecida e que estes superem os de instrução desconhecida
 * (um texto qualquer pode acertar o byte de comando por acaso, mas não as instruções).
 */
export function validateCdg(data: Uint8Array): number {
  const total = Math.floor(data.length / PACKET_SIZE)
  if (total === 0) throw new CdgFormatError('Arquivo CDG vazio ou truncado.')
  let known = 0
  let unknown = 0
  for (let i = 0; i < total; i++) {
    const offset = i * PACKET_SIZE
    if (((data[offset] ?? 0) & 0x3f) !== CDG_COMMAND) continue
    if (KNOWN_INSTRUCTIONS.has((data[offset + 1] ?? 0) & 0x3f)) known++
    else unknown++
  }
  if (known === 0 || unknown > known)
    throw new CdgFormatError('Arquivo não contém dados CD+G válidos.')
  return total
}

export class CdgDecoder {
  /** Índices de cor (0-15) de cada pixel da tela completa 300x216. */
  readonly pixels = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT)
  /** Paleta RGBA de 16 entradas (4 bytes cada). O alfa é 0 na cor transparente. */
  readonly palette = new Uint8ClampedArray(16 * 4)
  borderColor = 0
  transparentColor = -1
  /** Deslocamento fino de rolagem (pixels), já aplicado na hora de desenhar. */
  hOffset = 0
  vOffset = 0
  /** Incrementa a cada alteração de estado; permite ao renderizador pular quadros idênticos. */
  version = 0

  private readonly packetCount: number
  private position = 0
  private readonly scratch = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT)

  constructor(private readonly data: Uint8Array) {
    this.packetCount = validateCdg(data)
    this.reset()
  }

  get totalPackets(): number {
    return this.packetCount
  }

  /** Duração coberta pelo arquivo, em segundos. */
  get duration(): number {
    return this.packetCount / PACKETS_PER_SECOND
  }

  /** Volta ao estado inicial (tela preta, paleta preta). */
  reset(): void {
    this.pixels.fill(0)
    for (let i = 0; i < 16; i++) this.setColor(i, 0, 0, 0)
    this.borderColor = 0
    this.transparentColor = -1
    this.hOffset = 0
    this.vOffset = 0
    this.position = 0
    this.version++
  }

  /**
   * Avança (ou recua, reiniciando e reprocessando) até o instante `seconds` do áudio.
   * O relógio do áudio é sempre a referência; aqui não há estado de tempo próprio.
   * @returns true se a imagem mudou.
   */
  seekTo(seconds: number): boolean {
    const target = Math.min(
      this.packetCount,
      Math.max(0, Math.floor((Number.isFinite(seconds) ? seconds : 0) * PACKETS_PER_SECOND))
    )
    const before = this.version
    if (target < this.position) this.reset()
    while (this.position < target) {
      this.applyPacket(this.position * PACKET_SIZE)
      this.position++
    }
    return this.version !== before
  }

  private applyPacket(offset: number): void {
    const d = this.data
    if (((d[offset] ?? 0) & 0x3f) !== CDG_COMMAND) return
    const instruction = (d[offset + 1] ?? 0) & 0x3f
    const p = offset + 4 // início dos 16 bytes de dados
    const b = (i: number): number => d[p + i] ?? 0

    switch (instruction) {
      case Instruction.MemoryPreset:
        this.pixels.fill(b(0) & 0x0f)
        this.version++
        break
      case Instruction.BorderPreset:
        this.borderColor = b(0) & 0x0f
        this.version++
        break
      case Instruction.TileBlock:
        this.tileBlock(p, false)
        break
      case Instruction.TileBlockXor:
        this.tileBlock(p, true)
        break
      case Instruction.ScrollPreset:
        this.scroll(b(0) & 0x0f, b(1), b(2), false)
        break
      case Instruction.ScrollCopy:
        this.scroll(b(0) & 0x0f, b(1), b(2), true)
        break
      case Instruction.DefineTransparent:
        this.transparentColor = b(0) & 0x0f
        this.applyTransparency()
        this.version++
        break
      case Instruction.LoadColorsLow:
        this.loadColors(p, 0)
        break
      case Instruction.LoadColorsHigh:
        this.loadColors(p, 8)
        break
      default:
        break // instruções desconhecidas são ignoradas
    }
  }

  private tileBlock(p: number, xor: boolean): void {
    const d = this.data
    const color0 = (d[p] ?? 0) & 0x0f
    const color1 = (d[p + 1] ?? 0) & 0x0f
    const row = ((d[p + 2] ?? 0) & 0x1f) * TILE_HEIGHT
    const col = ((d[p + 3] ?? 0) & 0x3f) * TILE_WIDTH
    if (row + TILE_HEIGHT > SCREEN_HEIGHT || col + TILE_WIDTH > SCREEN_WIDTH) return // fora da tela

    for (let y = 0; y < TILE_HEIGHT; y++) {
      const bits = (d[p + 4 + y] ?? 0) & 0x3f
      for (let x = 0; x < TILE_WIDTH; x++) {
        const color = (bits >> (5 - x)) & 1 ? color1 : color0
        const index = (row + y) * SCREEN_WIDTH + col + x
        this.pixels[index] = xor ? (this.pixels[index] ?? 0) ^ color : color
      }
    }
    this.version++
  }

  private scroll(fillColor: number, hByte: number, vByte: number, copy: boolean): void {
    const hCmd = (hByte & 0x30) >> 4
    const vCmd = (vByte & 0x30) >> 4
    this.hOffset = Math.min(hByte & 0x07, TILE_WIDTH - 1)
    this.vOffset = Math.min(vByte & 0x0f, TILE_HEIGHT - 1)

    const dx = hCmd === 1 ? TILE_WIDTH : hCmd === 2 ? -TILE_WIDTH : 0 // 1: direita, 2: esquerda
    const dy = vCmd === 1 ? TILE_HEIGHT : vCmd === 2 ? -TILE_HEIGHT : 0 // 1: baixo, 2: cima

    if (dx !== 0 || dy !== 0) {
      const src = this.pixels
      const dst = this.scratch
      for (let y = 0; y < SCREEN_HEIGHT; y++) {
        for (let x = 0; x < SCREEN_WIDTH; x++) {
          const sx = x - dx
          const sy = y - dy
          let value = fillColor
          if (copy) {
            value = src[mod(sy, SCREEN_HEIGHT) * SCREEN_WIDTH + mod(sx, SCREEN_WIDTH)] ?? 0
          } else if (sx >= 0 && sx < SCREEN_WIDTH && sy >= 0 && sy < SCREEN_HEIGHT) {
            value = src[sy * SCREEN_WIDTH + sx] ?? 0
          }
          dst[y * SCREEN_WIDTH + x] = value
        }
      }
      src.set(dst)
    }
    this.version++
  }

  private loadColors(p: number, first: number): void {
    for (let i = 0; i < 8; i++) {
      const hi = (this.data[p + i * 2] ?? 0) & 0x3f
      const lo = (this.data[p + i * 2 + 1] ?? 0) & 0x3f
      const value = (hi << 6) | lo // 0bRRRRGGGGBBBB
      const r = ((value >> 8) & 0x0f) * 17
      const g = ((value >> 4) & 0x0f) * 17
      const bl = (value & 0x0f) * 17
      this.setColor(first + i, r, g, bl)
    }
    this.applyTransparency()
    this.version++
  }

  private setColor(index: number, r: number, g: number, b: number): void {
    const o = index * 4
    this.palette[o] = r
    this.palette[o + 1] = g
    this.palette[o + 2] = b
    this.palette[o + 3] = 255
  }

  private applyTransparency(): void {
    if (this.transparentColor >= 0) this.palette[this.transparentColor * 4 + 3] = 0
  }

  /**
   * Escreve a imagem RGBA da tela completa 300x216 (borda incluída), aplicando o deslocamento
   * fino de rolagem. `out` deve ter SCREEN_WIDTH * SCREEN_HEIGHT * 4 bytes.
   */
  writeRgba(out: Uint8ClampedArray): void {
    const pal = this.palette
    const border = this.borderColor * 4
    for (let y = 0; y < SCREEN_HEIGHT; y++) {
      for (let x = 0; x < SCREEN_WIDTH; x++) {
        const o = (y * SCREEN_WIDTH + x) * 4
        const inside =
          x >= BORDER_X &&
          x < SCREEN_WIDTH - BORDER_X &&
          y >= BORDER_Y &&
          y < SCREEN_HEIGHT - BORDER_Y
        const c = inside
          ? (this.pixels[
              mod(y + this.vOffset, SCREEN_HEIGHT) * SCREEN_WIDTH +
                mod(x + this.hOffset, SCREEN_WIDTH)
            ] ?? 0) * 4
          : border
        out[o] = pal[c] ?? 0
        out[o + 1] = pal[c + 1] ?? 0
        out[o + 2] = pal[c + 2] ?? 0
        out[o + 3] = pal[c + 3] ?? 255
      }
    }
  }
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}
