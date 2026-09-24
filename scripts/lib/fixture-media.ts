import { Mp3Encoder } from '@breezystack/lamejs'
import { CdgBuilder, SOLID_TILE, type Rgb12 } from './cdg-builder'

/** Paleta do fixture: índice 0 preto, 1-7 cores vivas distintas, 8-14 cinzas, 15 branco. */
export const FIXTURE_PALETTE: Rgb12[] = [
  [0, 0, 0],
  [15, 0, 0],
  [0, 15, 0],
  [0, 0, 15],
  [15, 15, 0],
  [15, 0, 15],
  [0, 15, 15],
  [15, 8, 0],
  [2, 2, 2],
  [4, 4, 4],
  [6, 6, 6],
  [8, 8, 8],
  [10, 10, 10],
  [12, 12, 12],
  [14, 14, 14],
  [15, 15, 15]
]

/** Cor de fundo (índice) exibida no segundo `k` do fixture. */
export const fixtureColorAtSecond = (k: number): number => (k % 7) + 1

/**
 * CDG sintético: a cada segundo `k` limpa a tela com a cor `fixtureColorAtSecond(k)` e desenha
 * `k+1` blocos brancos na primeira linha. Permite verificar sincronismo olhando um pixel.
 */
export function buildFixtureCdg(seconds: number): Buffer {
  const cdg = new CdgBuilder()
  cdg.loadColors(false, FIXTURE_PALETTE.slice(0, 8))
  cdg.loadColors(true, FIXTURE_PALETTE.slice(8, 16))
  cdg.borderPreset(8)
  for (let k = 0; k < seconds; k++) {
    cdg.padToSecond(k)
    cdg.memoryPreset(fixtureColorAtSecond(k))
    for (let b = 0; b <= k && b < 40; b++) cdg.tileBlock(1, 1 + b, 15, 15, SOLID_TILE)
  }
  cdg.padToSecond(seconds)
  return cdg.toBuffer()
}

/** MP3 mono 44,1 kHz com um tom diferente a cada segundo (audível no teste manual). */
export function buildFixtureMp3(seconds: number): Buffer {
  const sampleRate = 44100
  const encoder = new Mp3Encoder(1, sampleRate, 64)
  const notes = [262, 294, 330, 349, 392, 440, 494]
  const chunks: Buffer[] = []
  for (let k = 0; k < seconds; k++) {
    const freq = notes[k % notes.length] ?? 440
    const pcm = new Int16Array(sampleRate)
    for (let i = 0; i < sampleRate; i++) {
      const fade = Math.min(1, i / 400, (sampleRate - i) / 400)
      pcm[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 9000 * fade)
    }
    for (let i = 0; i < pcm.length; i += 1152) {
      const out = encoder.encodeBuffer(pcm.subarray(i, i + 1152))
      if (out.length > 0) chunks.push(Buffer.from(out))
    }
  }
  const tail = encoder.flush()
  if (tail.length > 0) chunks.push(Buffer.from(tail))
  return Buffer.concat(chunks)
}
