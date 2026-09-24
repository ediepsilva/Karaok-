import { CdgDecoder, SCREEN_HEIGHT, SCREEN_WIDTH } from './cdg-decoder'

/** Desenha o estado de um CdgDecoder em um canvas 300x216. */
export class CdgCanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D
  private readonly image: ImageData
  private lastVersion = -1
  private lastDecoder: CdgDecoder | null = null

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.width = SCREEN_WIDTH
    canvas.height = SCREEN_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D indisponível')
    this.ctx = ctx
    this.image = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT)
  }

  clear(): void {
    this.lastVersion = -1
    this.lastDecoder = null
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  /** Redesenha apenas se o decodificador mudou desde o último quadro. */
  draw(decoder: CdgDecoder): void {
    if (decoder === this.lastDecoder && decoder.version === this.lastVersion) return
    decoder.writeRgba(this.image.data)
    this.ctx.putImageData(this.image, 0, 0)
    this.lastDecoder = decoder
    this.lastVersion = decoder.version
  }
}
