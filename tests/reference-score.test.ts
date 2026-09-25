import { describe, expect, it } from 'vitest'
import { melody as melodySignal, silence, concat } from '../scripts/lib/voice-signals'
import { computeBasicScore } from '../src/renderer/src/voice/basic-score'
import { midiToFrequency } from '../src/renderer/src/voice/pitch'
import { PerformanceSession } from '../src/renderer/src/voice/performance-session'
import { computeReferenceScore, wrapSemitones } from '../src/renderer/src/voice/reference-score'
import { EVALUATION_PROFILES } from '../src/renderer/src/voice/evaluation-profile'
import { MODE_LABELS, type ReferenceNote } from '../src/renderer/src/voice/reference'
import { VoiceAnalyzer } from '../src/renderer/src/voice/voice-analyzer'
import { DEFAULT_LATENCY } from '../src/renderer/src/voice/latency'
import { frames } from '../scripts/lib/voice-signals'
import { HOP_SAMPLES, WINDOW_SAMPLES } from '../src/renderer/src/voice/voice-config'
import type { PitchPoint } from '../src/renderer/src/voice/voice-metrics'

const STEP = 0.0107

/** Melodia de teste: notas de 0,8 s a cada 1 s (pausa de 0,2 s), 16 notas. */
const NOTES_MIDI = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 62]
const MELODY: ReferenceNote[] = NOTES_MIDI.map((midi, i) => ({ start: i, duration: 0.8, midi }))

interface Perf {
  shift?: number // semitons a mais/menos em todas as notas
  detuneCents?: number
  delaySec?: number // entra atrasado
  sungFrom?: number // só canta notas com start >= isto
  sungUntil?: number // só canta notas com start < isto
  wrong?: number[] // erro (semitons) por nota
  from?: number // início da apresentação (s)
  to?: number // fim da apresentação (s)
  wobbleCents?: number
}

/** Linha do tempo de pitch de um "cantor" sintético seguindo a melodia com os defeitos dados. */
function performance(p: Perf = {}, notes: ReferenceNote[] = MELODY): PitchPoint[] {
  const out: PitchPoint[] = []
  const from = p.from ?? 0
  const to = p.to ?? notes[notes.length - 1]!.start + notes[notes.length - 1]!.duration + 0.4
  for (let t = from; t < to; t += STEP) {
    const idx = notes.findIndex((n) => t >= n.start + (p.delaySec ?? 0) && t < n.start + n.duration)
    const note = idx >= 0 ? notes[idx]! : undefined
    const sung =
      note !== undefined && t >= (p.sungFrom ?? -Infinity) && note.start < (p.sungUntil ?? Infinity)
    if (!sung || !note) {
      out.push({ songTime: t, frequency: null, clarity: 0, dbfs: -80 })
      continue
    }
    const wobble = p.wobbleCents ? Math.sin(t * 40) * p.wobbleCents : 0
    const midi =
      note.midi + (p.shift ?? 0) + (p.wrong?.[idx] ?? 0) + ((p.detuneCents ?? 0) + wobble) / 100
    out.push({ songTime: t, frequency: midiToFrequency(midi), clarity: 0.97, dbfs: -20 })
  }
  return out
}

describe('AVALIAÇÃO COM MELODIA DE REFERÊNCIA', () => {
  it('rotula o modo e produz nota alta quando o cantor segue a melodia', () => {
    const r = computeReferenceScore(performance(), MELODY)
    expect(r.mode).toBe('reference')
    expect(r.label).toBe('AVALIAÇÃO COM MELODIA DE REFERÊNCIA')
    expect(r.label).toBe(MODE_LABELS.reference)
    expect(r.score).toBeGreaterThanOrEqual(95)
    expect(r.notesEvaluated).toBe(16)
    expect(r.notesHit).toBe(16)
    expect(r.transposeSemitones).toBe(0)
    expect(r.medianOnsetMs).not.toBeNull()
    expect(Math.abs(r.medianOnsetMs!)).toBeLessThan(80)
    for (const c of [
      r.components.pitch,
      r.components.notes,
      r.components.duration,
      r.components.presence,
      r.components.consistency
    ]) {
      expect(c).toBeGreaterThan(0.9)
    }
  })

  it('é determinística', () => {
    const p = performance({ detuneCents: 25 })
    const a = computeReferenceScore(p, MELODY)
    for (let i = 0; i < 3; i++) expect(computeReferenceScore(p, MELODY)).toEqual(a)
  })

  it('ignora a oitava: quem canta uma oitava abaixo ou acima recebe a mesma nota', () => {
    const base = computeReferenceScore(performance(), MELODY).score
    expect(computeReferenceScore(performance({ shift: -12 }), MELODY).score).toBe(base)
    expect(computeReferenceScore(performance({ shift: 12 }), MELODY).score).toBe(base)
    expect(computeReferenceScore(performance({ shift: -12 }), MELODY).transposeSemitones).toBe(0)
  })

  it('cantar em outro tom: detecta a transposição e mede a afinação relativa', () => {
    const r = computeReferenceScore(performance({ shift: 3 }), MELODY)
    expect(r.transposeSemitones).toBe(3)
    expect(r.score).toBeGreaterThanOrEqual(90)
    const r2 = computeReferenceScore(performance({ shift: -4 }), MELODY)
    expect(r2.transposeSemitones).toBe(-4)
    expect(r2.score).toBeGreaterThanOrEqual(90)
  })

  it('sem tolerância a transposição, cantar em outro tom é penalizado', () => {
    const r = computeReferenceScore(performance({ shift: 3 }), MELODY, {
      allowTransposition: false
    })
    expect(r.transposeSemitones).toBe(0)
    expect(r.score!).toBeLessThan(45)
  })

  it('desafinação: pequena rende nota boa; grande derruba a nota', () => {
    const perfect = computeReferenceScore(performance(), MELODY).score!
    const slightly = computeReferenceScore(performance({ detuneCents: 40 }), MELODY).score!
    const off = computeReferenceScore(performance({ detuneCents: 150 }), MELODY).score!
    expect(slightly).toBeGreaterThanOrEqual(80)
    expect(slightly).toBeLessThanOrEqual(perfect)
    expect(off).toBeLessThan(perfect - 25)
    expect(off).toBeLessThan(slightly)
  })

  it('notas erradas (intervalos errados) recebem nota baixa', () => {
    const wrong = MELODY.map((_, i) => [3, -5, 4, 6, -3, 5, -4, 2][i % 8]!)
    const r = computeReferenceScore(performance({ wrong }), MELODY)
    expect(r.score!).toBeLessThan(40)
    expect(r.notesHit).toBeLessThan(8)
  })

  it('a nota é monotônica: quanto mais desafinado, menor a nota', () => {
    // (100 centésimos exatos seriam uma transposição de 1 semitom, aceita de propósito)
    const scores = [0, 30, 60, 160].map(
      (cents) => computeReferenceScore(performance({ detuneCents: cents }), MELODY).score!
    )
    for (let i = 1; i < scores.length; i++) expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]!)
  })

  it('atraso na entrada reduz o ritmo e é medido em ms', () => {
    const onTime = computeReferenceScore(performance(), MELODY)
    const late = computeReferenceScore(performance({ delaySec: 0.3 }), MELODY)
    expect(late.medianOnsetMs!).toBeGreaterThan(250)
    expect(late.medianOnsetMs!).toBeLessThan(350)
    expect(late.components.rhythm!).toBeLessThan(onTime.components.rhythm! - 0.4)
    expect(late.score!).toBeLessThan(onTime.score!)
    // pequeno atraso (100 ms) ainda vale o máximo de ritmo
    expect(
      computeReferenceScore(performance({ delaySec: 0.08 }), MELODY).components.rhythm!
    ).toBeGreaterThan(0.9)
  })

  it('a entrada das frases usa só a primeira nota de cada frase', () => {
    // frases de 4 notas separadas por 1 s de pausa
    const notes: ReferenceNote[] = []
    for (let phrase = 0; phrase < 4; phrase++) {
      for (let k = 0; k < 4; k++)
        notes.push({ start: phrase * 6 + k * 0.6, duration: 0.5, midi: 60 + k })
    }
    const perf = performance({}, notes)
    const r = computeReferenceScore(perf, notes)
    expect(r.components.phrases).not.toBeNull()
    expect(r.components.phrases!).toBeGreaterThan(0.9)
  })

  it('silêncio recebe nota 0', () => {
    const r = computeReferenceScore(performance({ sungFrom: 9999 }), MELODY)
    expect(r.score).toBe(0)
    expect(r.notesHit).toBe(0)
  })

  it('cantar só metade da música dá cerca de metade da nota', () => {
    const half = computeReferenceScore(performance({ sungUntil: 8 }), MELODY)
    expect(half.components.presence).toBeCloseTo(0.5 / 0.85, 1) // presença é normalizada por 85%
    expect(half.score!).toBeGreaterThan(30)
    expect(half.score!).toBeLessThan(65)
  })

  it('parar antes do fim: só as notas do trecho coberto entram (não são "erros")', () => {
    const r = computeReferenceScore(performance({ to: 8.4 }), MELODY)
    expect(r.notesEvaluated).toBeLessThan(16)
    expect(r.notesEvaluated).toBeGreaterThanOrEqual(7)
    expect(r.score!).toBeGreaterThanOrEqual(90)
  })

  it('entrar no meio da música: notas anteriores ao início não contam contra o cantor', () => {
    const r = computeReferenceScore(performance({ from: 6.2 }), MELODY)
    expect(r.notesEvaluated).toBeLessThan(16)
    expect(r.score!).toBeGreaterThanOrEqual(90)
  })

  it('trechos curtos demais ou sem dados não recebem nota', () => {
    const few = computeReferenceScore(performance({ to: 2.4 }), MELODY.slice(0, 2))
    expect(few.score).toBeNull()
    expect(few.insufficientReason).toMatch(/Poucas notas/)
    const none = computeReferenceScore(
      [{ songTime: null, frequency: 440, clarity: 1, dbfs: -20 }],
      MELODY
    )
    expect(none.score).toBeNull()
    expect(none.insufficientReason).toMatch(/alinhados/)
  })

  it('melodia toda emendada no mesmo tom não quebra: ritmo só mede a primeira entrada', () => {
    const legato: ReferenceNote[] = Array.from({ length: 8 }, (_, i) => ({
      start: i * 0.8,
      duration: 0.8,
      midi: 69
    }))
    const r = computeReferenceScore(performance({}, legato), legato)
    expect(r.score!).toBeGreaterThanOrEqual(90)
  })

  it('componentes não mensuráveis saem da conta (pesos renormalizados)', () => {
    const perfect = computeReferenceScore(performance(), MELODY)
    const legatoBack = Array.from({ length: 8 }, (_, i) => ({
      start: i * 0.8,
      duration: 0.8,
      midi: 69
    }))
    const legato = computeReferenceScore(performance({}, legatoBack), legatoBack)
    expect(perfect.score!).toBeGreaterThanOrEqual(95)
    expect(legato.components.rhythm).not.toBeNull() // a primeira entrada existe
  })

  it('vibrato/oscilação moderada mantém nota alta; oscilação forte reduz a consistência', () => {
    const mild = computeReferenceScore(performance({ wobbleCents: 25 }), MELODY)
    const strong = computeReferenceScore(performance({ wobbleCents: 150 }), MELODY)
    expect(mild.score!).toBeGreaterThanOrEqual(85)
    expect(strong.components.consistency).toBeLessThan(mild.components.consistency)
    expect(strong.score!).toBeLessThan(mild.score!)
  })

  it('wrapSemitones ignora a oitava', () => {
    expect(wrapSemitones(0)).toBe(0)
    expect(wrapSemitones(12)).toBe(0)
    expect(wrapSemitones(-12)).toBe(0)
    expect(wrapSemitones(13)).toBe(1)
    expect(wrapSemitones(9)).toBe(-3)
    expect(wrapSemitones(6)).toBe(6)
    expect(wrapSemitones(-6)).toBe(6)
    expect(wrapSemitones(-7)).toBe(5)
  })
})

describe('avaliação com melodia usando áudio sintético e o analisador real', () => {
  const SR = 48000
  const FRAME_SEC = HOP_SAMPLES / SR
  const notes: ReferenceNote[] = Array.from({ length: 6 }, (_, i) => ({
    start: i,
    duration: 0.85,
    midi: 60 + i * 2
  }))

  function track(hzFor: (n: ReferenceNote) => number): PitchPoint[] {
    const signal = concat(
      ...notes.map((n) => concat(melodySignal([[hzFor(n), n.duration]], SR), silence(0.15, SR)))
    )
    const analyzer = new VoiceAnalyzer(SR)
    const out: PitchPoint[] = []
    for (const { samples, endIndex } of frames(signal, WINDOW_SAMPLES, HOP_SAMPLES)) {
      const a = analyzer.analyze(samples, endIndex / SR)
      out.push({
        songTime: a.time - WINDOW_SAMPLES / SR / 2,
        frequency: a.frequency,
        clarity: a.clarity,
        dbfs: a.dbfs
      })
    }
    return out
  }

  it('cantar a melodia certa dá nota alta; cantar outras notas dá nota baixa', () => {
    const good = computeReferenceScore(
      track((n) => midiToFrequency(n.midi)),
      notes
    )
    expect(good.score!).toBeGreaterThanOrEqual(85)
    const bad = computeReferenceScore(
      track((n) => midiToFrequency(n.midi + [4, -3, 5, -5, 3, -4][Math.round(n.start)]!)),
      notes
    )
    expect(bad.score!).toBeLessThan(45)
  })

  it('a sessão de apresentação calcula a nota com melodia quando ela é informada', () => {
    const session = new PerformanceSession(FRAME_SEC, DEFAULT_LATENCY, 1, 6, notes)
    session.start()
    const pts = track((n) => midiToFrequency(n.midi))
    const analyzer = new VoiceAnalyzer(SR)
    const signal = concat(
      ...notes.map((n) =>
        concat(melodySignal([[midiToFrequency(n.midi), n.duration]], SR), silence(0.15, SR))
      )
    )
    for (const { samples, endIndex } of frames(signal, WINDOW_SAMPLES, HOP_SAMPLES)) {
      const a = analyzer.analyze(samples, endIndex / SR)
      session.addFrame(a, a.time - WINDOW_SAMPLES / SR / 2)
    }
    const result = session.finish()
    expect(pts.length).toBeGreaterThan(100)
    expect(result.reference).not.toBeNull()
    expect(result.reference!.label).toBe('AVALIAÇÃO COM MELODIA DE REFERÊNCIA')
    expect(result.reference!.score!).toBeGreaterThanOrEqual(80)
    // a avaliação básica continua disponível como complemento
    expect(computeBasicScore(result.summary).label).toBe('AVALIAÇÃO BÁSICA')
    expect(result.primary).toBe('reference')
  })

  it('sem melodia (ou melodia vazia) a sessão usa a avaliação básica', () => {
    for (const melody of [undefined, [] as ReferenceNote[]]) {
      const session = new PerformanceSession(FRAME_SEC, DEFAULT_LATENCY, 1, 6, melody)
      session.start()
      const signal = melodySignal([[440, 6]], SR)
      const analyzer = new VoiceAnalyzer(SR)
      for (const { samples, endIndex } of frames(signal, WINDOW_SAMPLES, HOP_SAMPLES)) {
        const a = analyzer.analyze(samples, endIndex / SR)
        session.addFrame(a, a.time)
      }
      const result = session.finish()
      expect(result.reference).toBeNull()
      expect(result.primary).toBe('basic')
      expect(result.score.mode).toBe('basic')
    }
  })
})

describe('transposição: só semitons exatos e consistentes', () => {
  it('um desvio que não é semitom inteiro é desafinação (não é absorvido)', () => {
    const r = computeReferenceScore(performance({ detuneCents: 150 }), MELODY)
    expect(r.transposeSemitones).toBe(0)
    expect(r.score!).toBeLessThan(computeReferenceScore(performance(), MELODY).score! - 25)
  })

  it('cantar todas as notas erradas com deslocamentos variados não vira "transposição"', () => {
    const wrong = MELODY.map((_, i) => [3, -5, 4, 6, -3, 5, -4, 2][i % 8]!)
    const r = computeReferenceScore(performance({ wrong }), MELODY)
    expect(r.transposeSemitones).toBe(0)
    expect(r.score!).toBeLessThan(30)
  })

  it('um semitom exato para cima é transposição (a faixa pode estar em outro tom)', () => {
    const r = computeReferenceScore(performance({ shift: 1 }), MELODY)
    expect(r.transposeSemitones).toBe(1)
    expect(r.score!).toBeGreaterThanOrEqual(90)
  })

  it('transposição de semitons mais leve em metade das notas não é consistente: não absorve', () => {
    const wrong = MELODY.map((_, i) => (i % 2 === 0 ? 2 : 7))
    expect(computeReferenceScore(performance({ wrong }), MELODY).transposeSemitones).toBe(0)
  })
})

describe('Níveis de dificuldade (Amador / Semiprofissional / Profissional)', () => {
  /** A mesma apresentação (com vibrato e ligeira desafinação) julgada nos 3 níveis. */
  const imperfect = performance({ wobbleCents: 35, detuneCents: 20 })

  it('a mesma apresentação rende nota progressivamente menor em níveis mais altos', () => {
    const amateur = computeReferenceScore(imperfect, MELODY, {
      profile: EVALUATION_PROFILES.amateur
    }).score!
    const semiPro = computeReferenceScore(imperfect, MELODY, {
      profile: EVALUATION_PROFILES.semiPro
    }).score!
    const professional = computeReferenceScore(imperfect, MELODY, {
      profile: EVALUATION_PROFILES.professional
    }).score!
    expect(amateur).toBeGreaterThan(semiPro)
    expect(semiPro).toBeGreaterThan(professional)
  })

  it('sem perfil (padrão), o resultado é idêntico ao perfil Semiprofissional', () => {
    const withDefault = computeReferenceScore(imperfect, MELODY)
    const withSemiPro = computeReferenceScore(imperfect, MELODY, {
      profile: EVALUATION_PROFILES.semiPro
    })
    expect(withDefault.score).toBe(withSemiPro.score)
    expect(withDefault.components).toEqual(withSemiPro.components)
  })

  it('uma apresentação perfeita continua com nota máxima em qualquer nível (a tolerância não inventa erro)', () => {
    const perfect = performance()
    for (const profile of Object.values(EVALUATION_PROFILES)) {
      const r = computeReferenceScore(perfect, MELODY, { profile })
      expect(r.score).toBeGreaterThanOrEqual(95)
    }
  })
})
