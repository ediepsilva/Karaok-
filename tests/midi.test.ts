import { describe, expect, it } from 'vitest'
import { TICKS_PER_SECOND, TrackBuilder, buildMidi, melodyMidi } from '../scripts/lib/midi-builder'
import { analyzeTracks, pickMelodyTrack, toMonophonic } from '../src/main/melody/melody-select'
import { MidiFormatError, parseMidi } from '../src/main/melody/midi-parser'

const bytes = (b: Buffer): Uint8Array => new Uint8Array(b)

describe('leitor MIDI', () => {
  it('lê notas com início e duração em segundos (120 bpm)', () => {
    const midi = melodyMidi([
      [60, 0, 0.5],
      [64, 1, 1],
      [67, 2.5, 0.25]
    ])
    const parsed = parseMidi(bytes(midi))
    const notes = parsed.tracks.find((t) => t.name === 'Melody')!.notes
    expect(notes.map((n) => [n.midi, +n.start.toFixed(3), +n.duration.toFixed(3)])).toEqual([
      [60, 0, 0.5],
      [64, 1, 1],
      [67, 2.5, 0.25]
    ])
    expect(parsed.format).toBe(1)
    expect(parsed.ticksPerQuarter).toBe(480)
    expect(parsed.durationSec).toBeCloseTo(2.75, 3)
  })

  it('aceita "running status" e note-on com velocidade 0 como fim de nota', () => {
    const track = new TrackBuilder().name('Voz')
    track.noteSec(0, 0.5, 60, { offWithZeroVelocity: true })
    track.noteSec(0.5, 0.5, 62, { offWithZeroVelocity: true })
    track.noteSec(1, 0.5, 64, { offWithZeroVelocity: true })
    const parsed = parseMidi(
      bytes(buildMidi([new TrackBuilder().tempo(0, 500000), track], { runningStatus: true }))
    )
    const notes = parsed.tracks[1]!.notes
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 64])
    expect(notes.every((n) => Math.abs(n.duration - 0.5) < 1e-6)).toBe(true)
  })

  it('respeita mudanças de andamento (120 → 60 bpm no meio)', () => {
    const tempo = new TrackBuilder().tempo(0, 500000).tempo(TICKS_PER_SECOND * 2, 1000000)
    const melody = new TrackBuilder().name('Melody')
    melody.note(0, TICKS_PER_SECOND, 60) // 0–1 s
    melody.note(TICKS_PER_SECOND * 2, 480, 62) // começa em 2 s (fim do trecho a 120 bpm), dura 1 semínima = 1 s a 60 bpm
    melody.note(TICKS_PER_SECOND * 2 + 960, 480, 64) // 2 semínimas depois, a 60 bpm = +2 s
    const parsed = parseMidi(bytes(buildMidi([tempo, melody])))
    const notes = parsed.tracks[1]!.notes
    expect(notes[1]!.start).toBeCloseTo(2, 3)
    expect(notes[1]!.duration).toBeCloseTo(1, 3)
    expect(notes[2]!.start).toBeCloseTo(4, 3) // 960 ticks = 2 semínimas a 60 bpm = 2 s depois de 2 s
  })

  it('notas repetidas sobrepostas do mesmo tom terminam na ordem (FIFO)', () => {
    const t = new TrackBuilder().name('Melody')
    t.note(0, 1920, 60)
    t.note(960, 1920, 60) // mesmo tom começa antes da primeira terminar
    const notes = parseMidi(bytes(buildMidi([new TrackBuilder().tempo(0, 500000), t]))).tracks[1]!
      .notes
    expect(notes).toHaveLength(2)
    expect(notes[0]!.duration).toBeCloseTo(2, 3)
    expect(notes[1]!.duration).toBeCloseTo(2, 3)
  })

  it('nota sem note-off termina no fim da trilha (não é perdida)', () => {
    const raw = buildMidi([
      new TrackBuilder().tempo(0, 500000),
      new TrackBuilder().name('M').note(0, 960, 60)
    ])
    expect(parseMidi(bytes(raw)).tracks[1]!.notes).toHaveLength(1)
  })

  it('lê arquivos .rmi (envelope RIFF) e formato 0', () => {
    const melody = new TrackBuilder().tempo(0, 500000).name('Melody').note(0, 480, 60)
    const riff = buildMidi([melody], { format: 0, riff: true })
    expect(riff.subarray(0, 4).toString('latin1')).toBe('RIFF')
    const parsed = parseMidi(bytes(riff))
    expect(parsed.format).toBe(0)
    expect(parsed.tracks[0]!.notes[0]!.midi).toBe(60)
  })

  it('tempo SMPTE usa ticks por segundo fixos', () => {
    const track = new TrackBuilder().noteSec(0, 1, 60)
    const midi = buildMidi([track], { ticksPerQuarter: 0xe728 }) // -25 fps, 40 ticks/quadro = 1000 ticks/s
    const parsed = parseMidi(bytes(midi))
    expect(parsed.ticksPerQuarter).toBeNull()
    expect(parsed.tracks[0]!.notes[0]!.midi).toBe(60)
    expect(parsed.tracks[0]!.notes[0]!.start).toBe(0)
  })

  it('nome da trilha, canais e programas', () => {
    const t = new TrackBuilder()
      .name('Lead Vocal')
      .program(0, 2, 52)
      .note(0, 480, 60, { channel: 2 })
    const track = parseMidi(bytes(buildMidi([t]))).tracks[0]!
    expect(track.name).toBe('Lead Vocal')
    expect(track.channels).toEqual([2])
    expect(track.programs).toEqual([52])
  })
})

describe('letras (KAR)', () => {
  it('lê letra em meta-eventos 0x05 com o tempo de cada sílaba', () => {
    const midi = melodyMidi([[60, 0, 4]], {
      lyrics: [
        [0.5, 'Pa'],
        [1.5, 'ra'],
        [2.5, 'béns']
      ]
    })
    const words = parseMidi(bytes(midi)).tracks.find((t) => t.name === 'Words')!
    expect(words.lyrics.map((l) => [l.text, +l.time.toFixed(2)])).toEqual([
      ['Pa', 0.5],
      ['ra', 1.5],
      ['béns', 2.5]
    ])
  })

  it('arquivo KAR: texto (0x01) na trilha "Words", ignora "@" e converte "/" e "\\" em quebra', () => {
    const midi = melodyMidi([[60, 0, 4]], {
      kar: true,
      lyrics: [
        [0, '/Olá '],
        [1, 'mun'],
        [2, 'do'],
        [3, '\\Tchau']
      ]
    })
    const words = parseMidi(bytes(midi)).tracks.find((t) => t.name === 'Words')!
    expect(words.lyrics.map((l) => l.text)).toEqual(['\nOlá ', 'mun', 'do', '\nTchau'])
    expect(words.lyrics.some((l) => l.text.startsWith('@'))).toBe(false)
  })
})

describe('arquivos inválidos ou hostis', () => {
  it('não é MIDI', () => {
    expect(() =>
      parseMidi(new TextEncoder().encode('isto não é um arquivo midi, só texto'))
    ).toThrow(MidiFormatError)
    expect(() => parseMidi(new Uint8Array(0))).toThrow(MidiFormatError)
  })

  it('cabeçalho inválido, formato desconhecido e resolução zero', () => {
    const good = melodyMidi([[60, 0, 1]])
    const badFormat = Buffer.from(good)
    badFormat.writeUInt16BE(7, 8)
    expect(() => parseMidi(bytes(badFormat))).toThrow(/Formato MIDI 7/)
    const zeroDivision = Buffer.from(good)
    zeroDivision.writeUInt16BE(0, 12)
    expect(() => parseMidi(bytes(zeroDivision))).toThrow(/Resolução/)
  })

  it('sem nenhuma trilha', () => {
    const header = Buffer.from(melodyMidi([[60, 0, 1]]).subarray(0, 14))
    expect(() => parseMidi(bytes(header))).toThrow(/sem trilhas/)
  })

  it('trilha final cortada mantém as notas já lidas', () => {
    const full = melodyMidi(
      Array.from({ length: 20 }, (_, i): [number, number, number] => [60 + (i % 5), i * 0.5, 0.4])
    )
    const cut = full.subarray(0, full.length - 40)
    const notes = parseMidi(bytes(cut)).tracks.find((t) => t.name === 'Melody')!.notes
    expect(notes.length).toBeGreaterThanOrEqual(15)
    expect(notes.length).toBeLessThan(20)
  })

  it('dado sem status e tamanho variável inválido viram erro, não travam', () => {
    const noStatus = Buffer.from([
      ...Buffer.from('MThd'),
      0,
      0,
      0,
      6,
      0,
      0,
      0,
      1,
      1,
      224,
      ...Buffer.from('MTrk'),
      0,
      0,
      0,
      3,
      0,
      60,
      90
    ])
    expect(() => parseMidi(bytes(noStatus))).toThrow(MidiFormatError)
    const badVlq = Buffer.from([
      ...Buffer.from('MThd'),
      0,
      0,
      0,
      6,
      0,
      0,
      0,
      1,
      1,
      224,
      ...Buffer.from('MTrk'),
      0,
      0,
      0,
      5,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff
    ])
    expect(() => parseMidi(bytes(badVlq))).toThrow(MidiFormatError)
  })

  it('recusa arquivos gigantes', () => {
    expect(() => parseMidi(new Uint8Array(6 * 1024 * 1024))).toThrow(/grande demais/)
  })
})

describe('escolha da trilha da melodia', () => {
  function song(): ReturnType<typeof parseMidi> {
    const tempo = new TrackBuilder().tempo(0, 500000)
    const bass = new TrackBuilder().name('Bass')
    const chords = new TrackBuilder().name('Piano')
    const melody = new TrackBuilder().name('Melody')
    const drums = new TrackBuilder().name('Drums')
    for (let i = 0; i < 40; i++) {
      bass.noteSec(i * 0.5, 0.4, 36 + (i % 3), { channel: 1 })
      for (const p of [60, 64, 67]) chords.noteSec(i * 0.5, 0.45, p, { channel: 2 })
      melody.noteSec(i * 0.5, 0.4, 62 + (i % 7), { channel: 0 })
      drums.noteSec(i * 0.25, 0.1, 36, { channel: 9 })
    }
    return parseMidi(bytes(buildMidi([tempo, bass, chords, melody, drums])))
  }

  it('escolhe a trilha monofônica na faixa vocal e ignora percussão, baixo e acordes', () => {
    const candidates = analyzeTracks(song())
    expect(pickMelodyTrack(candidates)).toBe(3)
    const drums = candidates.find((c) => c.name === 'Drums')!
    expect(drums.isDrums).toBe(true)
    expect(candidates.find((c) => c.name === 'Piano')!.monophony).toBeLessThan(0.1)
    expect(candidates.find((c) => c.name === 'Melody')!.monophony).toBeGreaterThan(0.95)
  })

  it('sem nomes, prefere a trilha monofônica na faixa vocal', () => {
    const tempo = new TrackBuilder().tempo(0, 500000)
    const a = new TrackBuilder() // acordes
    const b = new TrackBuilder() // linha vocal
    for (let i = 0; i < 30; i++) {
      for (const p of [48, 52, 55]) a.noteSec(i * 0.5, 0.45, p)
      b.noteSec(i * 0.5, 0.4, 64 + (i % 5))
    }
    const parsed = parseMidi(bytes(buildMidi([tempo, a, b])))
    expect(pickMelodyTrack(analyzeTracks(parsed))).toBe(2)
  })

  it('devolve null se não houver trilha utilizável (poucas notas ou só percussão)', () => {
    const t = new TrackBuilder().name('Melody').noteSec(0, 1, 60).noteSec(1, 1, 62)
    expect(pickMelodyTrack(analyzeTracks(parseMidi(bytes(buildMidi([t])))))).toBeNull()
    const d = new TrackBuilder().name('Drums')
    for (let i = 0; i < 30; i++) d.noteSec(i * 0.25, 0.1, 36, { channel: 9 })
    expect(pickMelodyTrack(analyzeTracks(parseMidi(bytes(buildMidi([d])))))).toBeNull()
  })

  it('trilha só de letras (sem notas) não vira candidata', () => {
    const w = new TrackBuilder().name('Words').lyric(0, 'oi', 0x01)
    const m = new TrackBuilder().name('Melody')
    for (let i = 0; i < 12; i++) m.noteSec(i, 0.8, 60 + i)
    const candidates = analyzeTracks(parseMidi(bytes(buildMidi([w, m]))))
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.name).toBe('Melody')
  })
})

describe('melodia monofônica', () => {
  const n = (start: number, duration: number, midi: number) => ({
    start,
    duration,
    midi,
    channel: 0,
    velocity: 90
  })

  it('notas sem sobreposição passam intactas', () => {
    expect(toMonophonic([n(0, 1, 60), n(1, 1, 62)])).toEqual([
      { start: 0, duration: 1, midi: 60 },
      { start: 1, duration: 1, midi: 62 }
    ])
  })

  it('sobreposição: a nota mais aguda prevalece e corta a anterior', () => {
    const out = toMonophonic([n(0, 2, 60), n(1, 2, 67)])
    expect(out).toEqual([
      { start: 0, duration: 1, midi: 60 },
      { start: 1, duration: 2, midi: 67 }
    ])
  })

  it('sobreposição com nota mais grave: ela só soa depois que a aguda termina', () => {
    const out = toMonophonic([n(0, 2, 72), n(1, 3, 60)])
    expect(out).toEqual([
      { start: 0, duration: 2, midi: 72 },
      { start: 2, duration: 2, midi: 60 }
    ])
  })

  it('descarta notas curtíssimas e fica ordenada por início', () => {
    const out = toMonophonic([n(2, 1, 64), n(0.5, 0.01, 60), n(0, 1, 62)])
    expect(out.map((x) => x.midi)).toEqual([62, 64])
  })
})
