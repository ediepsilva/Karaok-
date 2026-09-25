/**
 * Construtor de arquivos MIDI (SMF) para fixtures e testes. Não faz parte do app.
 * Tempo: por padrão 480 ticks por semínima e 120 bpm (1 semínima = 0,5 s → 960 ticks/s).
 */

export const TICKS_PER_QUARTER = 480
export const TICKS_PER_SECOND = 960 // com 120 bpm

const encodeVlq = (value: number): number[] => {
  let v = value
  const out = [v & 0x7f]
  while ((v >>= 7) > 0) out.unshift((v & 0x7f) | 0x80)
  return out
}

const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const be16 = (n: number): number[] => [(n >>> 8) & 255, n & 255]
const ascii = (s: string): number[] => [...Buffer.from(s, 'latin1')]

interface Ev {
  tick: number
  order: number // no mesmo tick: note off (0) antes de tempo/meta (1) antes de note on (2)
  bytes: number[]
  isChannel: boolean
  status?: number
}

export class TrackBuilder {
  private events: Ev[] = []

  meta(tick: number, type: number, data: number[]): this {
    this.events.push({
      tick,
      order: 1,
      bytes: [0xff, type, ...encodeVlq(data.length), ...data],
      isChannel: false
    })
    return this
  }

  name(text: string): this {
    return this.meta(0, 0x03, ascii(text))
  }

  /** Meta-evento de letra (0x05) ou texto (0x01). */
  lyric(tick: number, text: string, type: 0x05 | 0x01 = 0x05): this {
    return this.meta(tick, type, ascii(text))
  }

  tempo(tick: number, microsecondsPerQuarter: number): this {
    return this.meta(tick, 0x51, [
      (microsecondsPerQuarter >>> 16) & 255,
      (microsecondsPerQuarter >>> 8) & 255,
      microsecondsPerQuarter & 255
    ])
  }

  program(tick: number, channel: number, program: number): this {
    this.events.push({
      tick,
      order: 1,
      bytes: [0xc0 | channel, program],
      isChannel: true,
      status: 0xc0 | channel
    })
    return this
  }

  /** `offWithZeroVelocity`: encerra a nota com note-on de velocidade 0 (comum em arquivos reais). */
  note(
    tick: number,
    durationTicks: number,
    pitch: number,
    options: { channel?: number; velocity?: number; offWithZeroVelocity?: boolean } = {}
  ): this {
    const { channel = 0, velocity = 90, offWithZeroVelocity = false } = options
    this.events.push({
      tick,
      order: 2,
      bytes: [0x90 | channel, pitch, velocity],
      isChannel: true,
      status: 0x90 | channel
    })
    this.events.push({
      tick: tick + durationTicks,
      order: 0,
      bytes: offWithZeroVelocity ? [0x90 | channel, pitch, 0] : [0x80 | channel, pitch, 64],
      isChannel: true,
      status: offWithZeroVelocity ? 0x90 | channel : 0x80 | channel
    })
    return this
  }

  /** Nota em segundos (assume 120 bpm, 480 ticks/semínima). */
  noteSec(
    startSec: number,
    durSec: number,
    pitch: number,
    options: Parameters<TrackBuilder['note']>[3] = {}
  ): this {
    return this.note(
      Math.round(startSec * TICKS_PER_SECOND),
      Math.round(durSec * TICKS_PER_SECOND),
      pitch,
      options
    )
  }

  build(runningStatus = false): number[] {
    const sorted = [...this.events].sort((a, b) => a.tick - b.tick || a.order - b.order)
    const body: number[] = []
    let tick = 0
    let lastStatus = -1
    for (const ev of sorted) {
      body.push(...encodeVlq(ev.tick - tick))
      tick = ev.tick
      if (ev.isChannel) {
        if (runningStatus && ev.status === lastStatus) body.push(...ev.bytes.slice(1))
        else body.push(...ev.bytes)
        lastStatus = ev.status ?? -1
      } else {
        body.push(...ev.bytes)
        lastStatus = -1 // meta-eventos cancelam o "running status"
      }
    }
    body.push(0x00, 0xff, 0x2f, 0x00) // fim da trilha
    return [...ascii('MTrk'), ...be32(body.length), ...body]
  }
}

export interface MidiOptions {
  format?: 0 | 1
  ticksPerQuarter?: number
  runningStatus?: boolean
  /** Prefixo RIFF/RMID (arquivos .rmi). */
  riff?: boolean
}

export function buildMidi(tracks: TrackBuilder[], options: MidiOptions = {}): Buffer {
  const {
    format = 1,
    ticksPerQuarter = TICKS_PER_QUARTER,
    runningStatus = false,
    riff = false
  } = options
  const header = [
    ...ascii('MThd'),
    ...be32(6),
    ...be16(format),
    ...be16(tracks.length),
    ...be16(ticksPerQuarter)
  ]
  const data = [...header, ...tracks.flatMap((t) => t.build(runningStatus))]
  if (!riff) return Buffer.from(data)
  const riffData = [
    ...ascii('RMID'),
    ...ascii('data'),
    ...[
      data.length & 255,
      (data.length >>> 8) & 255,
      (data.length >>> 16) & 255,
      (data.length >>> 24) & 255
    ],
    ...data
  ]
  return Buffer.from([
    ...ascii('RIFF'),
    riffData.length & 255,
    (riffData.length >>> 8) & 255,
    (riffData.length >>> 16) & 255,
    (riffData.length >>> 24) & 255,
    ...riffData
  ])
}

/** MIDI de uma melodia monofônica: [pitch, início(s), duração(s)]. Trilha 0 = tempo; trilha 1 = melodia. */
export function melodyMidi(
  notes: [pitch: number, startSec: number, durSec: number][],
  options: { lyrics?: [timeSec: number, text: string][]; name?: string; kar?: boolean } = {}
): Buffer {
  const tempo = new TrackBuilder().tempo(0, 500000)
  const melody = new TrackBuilder().name(options.name ?? 'Melody')
  for (const [pitch, start, dur] of notes) melody.noteSec(start, dur, pitch, { channel: 0 })
  const tracks = [tempo, melody]
  if (options.lyrics) {
    const words = new TrackBuilder().name('Words')
    if (options.kar) {
      words.lyric(0, '@KMIDI KARAOKE FILE', 0x01)
      words.lyric(0, '@LPT', 0x01)
      words.lyric(0, '@TFixture', 0x01)
    }
    for (const [sec, text] of options.lyrics) {
      words.lyric(Math.round(sec * TICKS_PER_SECOND), text, options.kar ? 0x01 : 0x05)
    }
    tracks.push(words)
  }
  return buildMidi(tracks)
}
