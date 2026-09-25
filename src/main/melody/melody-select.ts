import type { ReferenceNote } from '../../shared/types'
import type { MidiNote, MidiTrackData, ParsedMidi } from './midi-parser'

/** Resumo de uma trilha para escolher (e mostrar) qual delas é a melodia cantada. */
export interface TrackCandidate {
  index: number
  name: string
  noteCount: number
  channels: number[]
  /** Nota MIDI média. */
  meanMidi: number
  /** Fração do tempo com som em que só uma nota soa (1 = monofônica, como uma voz). */
  monophony: number
  /** Fração das notas na faixa vocal (C3–C6). */
  vocalRange: number
  /** Notas por segundo. */
  density: number
  /** Só o canal 10 (percussão). */
  isDrums: boolean
  /** Pontuação usada na escolha automática (maior = mais provável melodia). */
  score: number
}

const MELODY_NAME = /melod|vocal|voice|lead|voz|canto|sing|solo|main|principal|cantor/i
const NOT_MELODY_NAME =
  /bass|baixo|drum|bateria|perc|chord|acord|acomp|pad|string|guitar|violao|rhythm|ritmo/i
const MIN_NOTES = 8
const MIN_NOTE_SEC = 0.04

/** Fração do tempo com som em que só uma nota soa. */
function monophony(notes: MidiNote[]): number {
  if (notes.length === 0) return 0
  const events: [number, number][] = []
  for (const n of notes) {
    events.push([n.start, 1], [n.start + Math.max(n.duration, 0.001), -1])
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let active = 0
  let last = 0
  let single = 0
  let any = 0
  for (const [t, delta] of events) {
    const span = t - last
    if (active >= 1) any += span
    if (active === 1) single += span
    active += delta
    last = t
  }
  return any === 0 ? 0 : single / any
}

function describe(track: MidiTrackData): TrackCandidate {
  const notes = track.notes
  const span =
    notes.length === 0
      ? 0
      : Math.max(...notes.map((n) => n.start + n.duration)) - Math.min(...notes.map((n) => n.start))
  const inRange = notes.filter((n) => n.midi >= 48 && n.midi <= 84).length
  const mono = monophony(notes)
  const density = span > 0 ? notes.length / span : 0
  const isDrums = track.channels.length > 0 && track.channels.every((c) => c === 9)
  const named = MELODY_NAME.test(track.name)
  const notMelody = NOT_MELODY_NAME.test(track.name)
  const range = notes.length === 0 ? 0 : inRange / notes.length
  const score =
    (named ? 2 : 0) +
    mono +
    range +
    Math.min(1, density / 2) * 0.5 -
    (notMelody ? 1.5 : 0) -
    (isDrums ? 5 : 0)
  return {
    index: track.index,
    name: track.name,
    noteCount: notes.length,
    channels: track.channels,
    meanMidi: notes.length === 0 ? 0 : notes.reduce((s, n) => s + n.midi, 0) / notes.length,
    monophony: mono,
    vocalRange: range,
    density,
    isDrums,
    score
  }
}

export function analyzeTracks(parsed: ParsedMidi): TrackCandidate[] {
  return parsed.tracks.filter((t) => t.notes.length > 0).map(describe)
}

/** Escolha automática da trilha da melodia (null se nenhuma serve). O usuário pode trocar. */
export function pickMelodyTrack(candidates: TrackCandidate[]): number | null {
  const usable = candidates.filter((c) => !c.isDrums && c.noteCount >= MIN_NOTES)
  if (usable.length === 0) return null
  return [...usable].sort((a, b) => b.score - a.score || a.index - b.index)[0]!.index
}

/**
 * Converte as notas da trilha em uma melodia monofônica (o que uma voz canta): quando há notas
 * sobrepostas, prevalece a mais aguda ("skyline"); notas muito curtas são descartadas.
 */
export function toMonophonic(notes: MidiNote[]): ReferenceNote[] {
  const sorted = [...notes]
    .filter((n) => n.duration >= MIN_NOTE_SEC)
    .sort((a, b) => a.start - b.start || b.midi - a.midi)
  const out: ReferenceNote[] = []
  for (const n of sorted) {
    let start = n.start
    let duration = n.duration
    const last = out[out.length - 1]
    if (last && last.start + last.duration > start + 1e-6) {
      if (n.midi >= last.midi) {
        last.duration = start - last.start // a mais aguda entra e corta a anterior
        if (last.duration < MIN_NOTE_SEC) out.pop()
      } else {
        const lastEnd = last.start + last.duration
        duration = start + duration - lastEnd // a mais grave só soa depois que a aguda termina
        start = lastEnd
        if (duration < MIN_NOTE_SEC) continue
      }
    }
    out.push({ start, duration, midi: n.midi })
  }
  return out
}
