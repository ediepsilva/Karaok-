/**
 * Leitor de arquivos MIDI padrão (SMF formatos 0/1/2), incluindo arquivos KAR (letras em
 * meta-eventos). Implementação própria, sem dependências. Só lê: nada é executado.
 * Limites: tamanho do arquivo e número de eventos (arquivos malformados/maliciosos).
 */

export class MidiFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MidiFormatError'
  }
}

export const MAX_MIDI_BYTES = 5 * 1024 * 1024
const MAX_EVENTS = 1_500_000

export interface MidiNote {
  /** Início em segundos. */
  start: number
  duration: number
  midi: number
  channel: number
  velocity: number
}

export interface MidiLyric {
  time: number
  text: string
}

export interface MidiTrackData {
  index: number
  name: string
  notes: MidiNote[]
  lyrics: MidiLyric[]
  channels: number[]
  programs: number[]
}

export interface ParsedMidi {
  format: number
  /** Ticks por semínima, ou null se o arquivo usa tempo SMPTE. */
  ticksPerQuarter: number | null
  durationSec: number
  tracks: MidiTrackData[]
}

interface RawNote {
  startTick: number
  endTick: number
  midi: number
  channel: number
  velocity: number
}

interface RawTrack {
  name: string
  notes: RawNote[]
  lyrics: { tick: number; text: string }[]
  karText: { tick: number; text: string }[]
  channels: Set<number>
  programs: Set<number>
  endTick: number
}

class Reader {
  pos = 0
  constructor(
    private readonly data: Uint8Array,
    readonly end: number
  ) {}
  byte(): number {
    if (this.pos >= this.end) throw new MidiFormatError('Arquivo MIDI truncado.')
    return this.data[this.pos++]!
  }
  vlq(): number {
    let value = 0
    for (let i = 0; i < 4; i++) {
      const b = this.byte()
      value = (value << 7) | (b & 0x7f)
      if ((b & 0x80) === 0) return value
    }
    throw new MidiFormatError('Valor de tamanho variável inválido no MIDI.')
  }
  bytes(n: number): Uint8Array {
    if (n < 0 || this.pos + n > this.end) throw new MidiFormatError('Arquivo MIDI truncado.')
    const out = this.data.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }
  get done(): boolean {
    return this.pos >= this.end
  }
}

const u32 = (d: Uint8Array, o: number): number =>
  ((d[o]! << 24) | (d[o + 1]! << 16) | (d[o + 2]! << 8) | d[o + 3]!) >>> 0
const u16 = (d: Uint8Array, o: number): number => (d[o]! << 8) | d[o + 1]!
const tag = (d: Uint8Array, o: number): string =>
  String.fromCharCode(d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!)

/** Texto de meta-evento: UTF-8 se válido, senão Latin-1 (comum em KAR antigos). */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('latin1').decode(bytes)
  }
}

interface TempoPoint {
  tick: number
  microsPerQuarter: number
  sec: number
}

function buildTempoMap(changes: { tick: number; micros: number }[], tpq: number): TempoPoint[] {
  const sorted = [...changes].sort((a, b) => a.tick - b.tick)
  const map: TempoPoint[] = [{ tick: 0, microsPerQuarter: 500000, sec: 0 }]
  for (const c of sorted) {
    const prev = map[map.length - 1]!
    const sec = prev.sec + ((c.tick - prev.tick) * prev.microsPerQuarter) / 1_000_000 / tpq
    if (c.tick === prev.tick) prev.microsPerQuarter = c.micros
    else map.push({ tick: c.tick, microsPerQuarter: c.micros, sec })
  }
  return map
}

function tickToSec(map: TempoPoint[], tick: number, tpq: number): number {
  let lo = 0
  let hi = map.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (map[mid]!.tick <= tick) lo = mid
    else hi = mid - 1
  }
  const p = map[lo]!
  return p.sec + ((tick - p.tick) * p.microsPerQuarter) / 1_000_000 / tpq
}

function parseTrack(
  reader: Reader,
  tempoChanges: { tick: number; micros: number }[],
  budget: { events: number }
): RawTrack {
  const track: RawTrack = {
    name: '',
    notes: [],
    lyrics: [],
    karText: [],
    channels: new Set(),
    programs: new Set(),
    endTick: 0
  }
  const open = new Map<number, RawNote[]>() // canal*128+nota → notas abertas (FIFO)
  let tick = 0
  let running = -1

  try {
    while (!reader.done) {
      if (++budget.events > MAX_EVENTS) throw new MidiFormatError('MIDI com eventos demais.')
      tick += reader.vlq()
      let status = reader.byte()

      if (status < 0x80) {
        // "running status": o byte lido já é o primeiro dado do evento anterior
        if (running < 0) throw new MidiFormatError('MIDI inválido: dado sem status.')
        reader.pos--
        status = running
      } else if (status < 0xf0) {
        running = status
      }

      if (status === 0xff) {
        const type = reader.byte()
        const data = reader.bytes(reader.vlq())
        running = -1
        if (type === 0x2f) {
          track.endTick = tick
          break
        } else if (type === 0x51 && data.length === 3) {
          tempoChanges.push({ tick, micros: (data[0]! << 16) | (data[1]! << 8) | data[2]! })
        } else if (type === 0x03 && !track.name) {
          track.name = decodeText(data).trim()
        } else if (type === 0x05) {
          track.lyrics.push({ tick, text: decodeText(data) })
        } else if (type === 0x01) {
          track.karText.push({ tick, text: decodeText(data) })
        }
      } else if (status === 0xf0 || status === 0xf7) {
        reader.bytes(reader.vlq()) // sysex: ignorado
        running = -1
      } else if (status >= 0xf8) {
        // mensagens de tempo real não deveriam aparecer em arquivos: ignora
      } else {
        const kind = status & 0xf0
        const channel = status & 0x0f
        if (kind === 0xc0 || kind === 0xd0) {
          const value = reader.byte()
          if (kind === 0xc0) track.programs.add(value)
        } else {
          const a = reader.byte()
          const b = reader.byte()
          if (kind === 0x90 && b > 0) {
            const note: RawNote = { startTick: tick, endTick: -1, midi: a, channel, velocity: b }
            const key = channel * 128 + a
            const list = open.get(key)
            if (list) list.push(note)
            else open.set(key, [note])
            track.notes.push(note)
            track.channels.add(channel)
          } else if (kind === 0x80 || kind === 0x90) {
            const list = open.get(channel * 128 + a)
            const note = list?.shift()
            if (note) note.endTick = tick
          }
        }
      }
      track.endTick = Math.max(track.endTick, tick)
    }
  } catch (error) {
    // Trilha cortada no meio de um evento: mantém o que já foi lido (como fazem os players).
    if (!(error instanceof MidiFormatError) || !/truncado/.test(error.message)) throw error
  }
  // notas que ficaram abertas terminam no fim da trilha
  for (const n of track.notes) if (n.endTick < 0) n.endTick = Math.max(track.endTick, n.startTick)
  return track
}

/** Letra de KAR: ignora linhas "@..." e converte "/" e "\\" (quebras) em nova linha. */
function karLyrics(events: { tick: number; text: string }[]): { tick: number; text: string }[] {
  const out: { tick: number; text: string }[] = []
  for (const e of events) {
    if (e.text.startsWith('@')) continue
    let text = e.text
    if (text.startsWith('/') || text.startsWith('\\')) text = '\n' + text.slice(1)
    if (text.length > 0) out.push({ tick: e.tick, text })
  }
  return out
}

export function parseMidi(input: Uint8Array): ParsedMidi {
  if (input.length > MAX_MIDI_BYTES) throw new MidiFormatError('Arquivo MIDI grande demais.')
  let data = input
  // Arquivos .rmi: envelope RIFF/RMID com o MIDI dentro
  if (data.length > 12 && tag(data, 0) === 'RIFF') {
    let found = -1
    for (let i = 12; i + 4 <= data.length; i++) {
      if (tag(data, i) === 'MThd') {
        found = i
        break
      }
    }
    if (found < 0) throw new MidiFormatError('Não é um arquivo MIDI.')
    data = data.subarray(found)
  }
  if (data.length < 14 || tag(data, 0) !== 'MThd')
    throw new MidiFormatError('Não é um arquivo MIDI.')
  const headerLength = u32(data, 4)
  if (headerLength < 6 || 8 + headerLength > data.length)
    throw new MidiFormatError('Cabeçalho MIDI inválido.')
  const format = u16(data, 8)
  const trackCount = u16(data, 10)
  const division = u16(data, 12)
  if (format > 2) throw new MidiFormatError(`Formato MIDI ${format} não suportado.`)

  const smpte = (division & 0x8000) !== 0
  const tpq = smpte ? 0 : division
  if (!smpte && tpq === 0) throw new MidiFormatError('Resolução MIDI inválida.')
  // SMPTE: ticks por segundo fixo, tratado como tempo constante
  const smpteTicksPerSecond = smpte ? (256 - (division >> 8)) * (division & 0xff) : 0
  if (smpte && smpteTicksPerSecond <= 0) throw new MidiFormatError('Resolução SMPTE inválida.')

  const tempoChanges: { tick: number; micros: number }[] = []
  const budget = { events: 0 }
  const raw: RawTrack[] = []
  let pos = 8 + headerLength
  while (pos + 8 <= data.length && raw.length < Math.max(trackCount, 1) + 256) {
    const id = tag(data, pos)
    const length = u32(data, pos + 4)
    const bodyStart = pos + 8
    const bodyEnd = Math.min(bodyStart + length, data.length) // tolera trilha final truncada
    if (id === 'MTrk')
      raw.push(parseTrack(readerAt(data, bodyStart, bodyEnd), tempoChanges, budget))
    pos = bodyStart + length
  }
  if (raw.length === 0) throw new MidiFormatError('MIDI sem trilhas.')

  const toSec = smpte
    ? (tick: number): number => tick / smpteTicksPerSecond
    : (() => {
        const map = buildTempoMap(tempoChanges, tpq)
        return (tick: number): number => tickToSec(map, tick, tpq)
      })()

  let duration = 0
  const tracks: MidiTrackData[] = raw.map((t, index) => {
    const notes = t.notes
      .map((n) => ({
        start: toSec(n.startTick),
        duration: Math.max(0, toSec(n.endTick) - toSec(n.startTick)),
        midi: n.midi,
        channel: n.channel,
        velocity: n.velocity
      }))
      .sort((a, b) => a.start - b.start || a.midi - b.midi)
    const isWords = /words|lyrics|letra/i.test(t.name)
    const lyricEvents = [
      ...t.lyrics,
      ...(isWords || t.lyrics.length === 0 ? karLyrics(t.karText) : [])
    ]
    const lyrics = lyricEvents
      .sort((a, b) => a.tick - b.tick)
      .map((l) => ({ time: toSec(l.tick), text: l.text }))
    for (const n of notes) duration = Math.max(duration, n.start + n.duration)
    for (const l of lyrics) duration = Math.max(duration, l.time)
    return {
      index,
      name: t.name,
      notes,
      lyrics,
      channels: [...t.channels].sort((a, b) => a - b),
      programs: [...t.programs].sort((a, b) => a - b)
    }
  })

  return { format, ticksPerQuarter: smpte ? null : tpq, durationSec: duration, tracks }
}

function readerAt(data: Uint8Array, start: number, end: number): Reader {
  const r = new Reader(data, end)
  r.pos = start
  return r
}
