/**
 * Sinais sintéticos determinísticos para testar a análise vocal e para gerar os WAVs usados como
 * "microfone falso" no teste ponta a ponta. Não faz parte do app.
 */

export type Signal = Float32Array

/** Gerador pseudoaleatório determinístico (mulberry32): mesmos números em toda execução. */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const dbToAmp = (db: number): number => Math.pow(10, db / 20)

export function silence(seconds: number, sampleRate: number): Signal {
  return new Float32Array(Math.round(seconds * sampleRate))
}

export interface ToneOptions {
  /** Nível RMS aproximado em dBFS (padrão -20). */
  db?: number
  /** Número de harmônicos (1 = senoide pura; ~6 lembra uma voz). */
  harmonics?: number
  /** Profundidade do vibrato em centésimos de semitom (0 = sem vibrato). */
  vibratoCents?: number
  vibratoHz?: number
  /** Fade-in/out em segundos, para evitar cliques. */
  fade?: number
}

/** Tom com harmônicos decrescentes (1/k), opcionalmente com vibrato. */
export function voiceTone(
  frequency: number,
  seconds: number,
  sampleRate: number,
  options: ToneOptions = {}
): Signal {
  const { db = -20, harmonics = 6, vibratoCents = 0, vibratoHz = 5.5, fade = 0.01 } = options
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  let weightSquares = 0
  for (let k = 1; k <= harmonics; k++) weightSquares += 1 / (k * k)
  const scale = (dbToAmp(db) * Math.SQRT2) / Math.sqrt(weightSquares)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const vib =
      vibratoCents > 0
        ? Math.pow(2, (vibratoCents / 1200) * Math.sin(2 * Math.PI * vibratoHz * t))
        : 1
    phase += (2 * Math.PI * frequency * vib) / sampleRate
    let v = 0
    for (let k = 1; k <= harmonics; k++) v += Math.sin(k * phase) / k
    const edge = Math.min(1, t / fade, (seconds - t) / fade)
    out[i] = v * scale * Math.max(0, edge)
  }
  return out
}

export function whiteNoise(seconds: number, sampleRate: number, db = -25, seed = 1): Signal {
  const rand = prng(seed)
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  const amp = dbToAmp(db) * Math.sqrt(3) // uniforme [-1,1] tem RMS 1/√3
  for (let i = 0; i < n; i++) out[i] = (rand() * 2 - 1) * amp
  return out
}

export function concat(...parts: Signal[]): Signal {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

export function mix(a: Signal, b: Signal): Signal {
  const out = new Float32Array(Math.max(a.length, b.length))
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0)
  return out
}

export function scaleDb(signal: Signal, db: number): Signal {
  const g = dbToAmp(db)
  return signal.map((v) => v * g)
}

/** Sequência de notas [Hz, segundos] emendadas. */
export function melody(
  notes: [frequency: number, seconds: number][],
  sampleRate: number,
  options: ToneOptions = {}
): Signal {
  return concat(...notes.map(([hz, sec]) => voiceTone(hz, sec, sampleRate, options)))
}

/** Janelas deslizantes (tamanho, passo) como o microfone entrega ao analisador. */
export function* frames(
  signal: Signal,
  windowSize: number,
  hop: number
): Generator<{ samples: Signal; endIndex: number }> {
  for (let end = windowSize; end <= signal.length; end += hop) {
    yield { samples: signal.subarray(end - windowSize, end), endIndex: end }
  }
}

/** Codifica PCM 16 bits mono em WAV (formato aceito pelo microfone falso do Chromium). */
export function toWav(signal: Signal, sampleRate: number): Buffer {
  const pcm = Buffer.alloc(signal.length * 2)
  for (let i = 0; i < signal.length; i++) {
    const v = Math.max(-1, Math.min(1, signal[i] ?? 0))
    pcm.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}
