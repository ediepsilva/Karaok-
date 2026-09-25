import { describe, expect, it } from 'vitest'
import {
  concat,
  frames,
  melody,
  mix,
  scaleDb,
  silence,
  voiceTone,
  whiteNoise
} from '../scripts/lib/voice-signals'
import { computeBasicScore } from '../src/renderer/src/voice/basic-score'
import {
  DEFAULT_LATENCY,
  aggregateLoopback,
  autoLatencyMs,
  clampManualMs,
  compensateSongTime,
  findClickDelay,
  totalLatencyMs
} from '../src/renderer/src/voice/latency'
import { shouldCountFrames, shouldMicBeActive } from '../src/renderer/src/voice/mic-policy'
import { PerformanceSession } from '../src/renderer/src/voice/performance-session'
import {
  detectPitch,
  frameLevel,
  frequencyToNote,
  midiToFrequency
} from '../src/renderer/src/voice/pitch'
import {
  MODE_LABELS,
  noReferenceProvider,
  selectEvaluationMode
} from '../src/renderer/src/voice/reference'
import { VoiceAnalyzer, type FrameAnalysis } from '../src/renderer/src/voice/voice-analyzer'
import {
  HOP_SAMPLES,
  MIN_PERFORMANCE_SEC,
  WINDOW_SAMPLES
} from '../src/renderer/src/voice/voice-config'
import { VoiceMetrics } from '../src/renderer/src/voice/voice-metrics'
import { DEFAULT_VOICE_PREFS, parseVoicePrefs } from '../src/renderer/src/voice/voice-prefs'

const SR = 48000
const FRAME_SEC = HOP_SAMPLES / SR

const cents = (measured: number, expected: number): number => 1200 * Math.log2(measured / expected)

/** Roda o analisador sobre um sinal como o microfone faria e devolve todos os quadros. */
function analyze(signal: Float32Array, analyzer = new VoiceAnalyzer(SR)): FrameAnalysis[] {
  const out: FrameAnalysis[] = []
  for (const { samples, endIndex } of frames(signal, WINDOW_SAMPLES, HOP_SAMPLES)) {
    out.push(analyzer.analyze(samples, endIndex / SR))
  }
  return out
}

function summarize(signal: Float32Array): ReturnType<VoiceMetrics['summary']> {
  const metrics = new VoiceMetrics(FRAME_SEC)
  for (const f of analyze(signal)) metrics.add(f)
  return metrics.summary()
}

describe('detecção de pitch', () => {
  it.each([82.4, 110, 196, 261.6, 440, 659.3, 880, 1000])(
    'acha %s Hz com erro de no máximo 10 centésimos (voz sintética com harmônicos)',
    (hz) => {
      const signal = voiceTone(hz, 0.5, SR)
      const { samples } = [...frames(signal, WINDOW_SAMPLES, HOP_SAMPLES)][10]!
      const result = detectPitch(samples, SR)
      expect(result.frequency).not.toBeNull()
      expect(Math.abs(cents(result.frequency!, hz))).toBeLessThan(10)
      expect(result.clarity).toBeGreaterThan(0.9)
    }
  )

  it('acha a frequência de uma senoide pura', () => {
    const signal = voiceTone(330, 0.4, SR, { harmonics: 1 })
    const { samples } = [...frames(signal, WINDOW_SAMPLES, HOP_SAMPLES)][8]!
    expect(Math.abs(cents(detectPitch(samples, SR).frequency!, 330))).toBeLessThan(10)
  })

  it('funciona em outras taxas de amostragem (44,1 kHz e 16 kHz)', () => {
    for (const rate of [44100, 16000]) {
      const signal = voiceTone(220, 0.5, rate)
      const window = rate === 16000 ? 1024 : 2048
      const { samples } = [...frames(signal, window, 256)][6]!
      expect(Math.abs(cents(detectPitch(samples, rate).frequency!, 220))).toBeLessThan(15)
    }
  })

  it('não confunde oitava: nota grave com muitos harmônicos continua no fundamental', () => {
    const signal = voiceTone(110, 0.5, SR, { harmonics: 12 })
    const { samples } = [...frames(signal, WINDOW_SAMPLES, HOP_SAMPLES)][10]!
    expect(Math.abs(cents(detectPitch(samples, SR).frequency!, 110))).toBeLessThan(15)
  })

  it('silêncio não tem pitch; ruído branco tem clareza baixa', () => {
    expect(detectPitch(silence(0.1, SR).subarray(0, WINDOW_SAMPLES), SR).frequency).toBeNull()
    const noise = whiteNoise(0.2, SR, -20, 7).subarray(0, WINDOW_SAMPLES)
    expect(detectPitch(noise, SR).clarity).toBeLessThan(0.8)
  })

  it('segue a mudança de frequência ao longo do tempo', () => {
    const signal = melody(
      [
        [220, 0.5],
        [330, 0.5],
        [440, 0.5]
      ],
      SR
    )
    const pitches = analyze(signal).map((f) => f.frequency)
    const at = (sec: number): number | null =>
      pitches[Math.round((sec * SR - WINDOW_SAMPLES) / HOP_SAMPLES)] ?? null
    expect(Math.abs(cents(at(0.4)!, 220))).toBeLessThan(15)
    expect(Math.abs(cents(at(0.9)!, 330))).toBeLessThan(15)
    expect(Math.abs(cents(at(1.4)!, 440))).toBeLessThan(15)
  })

  it('vibrato: a frequência média continua na nota', () => {
    const signal = voiceTone(330, 1.5, SR, { vibratoCents: 40 })
    const hz = analyze(signal)
      .filter((f) => f.frequency !== null)
      .map((f) => f.frequency!)
    const mean = hz.reduce((a, b) => a + b, 0) / hz.length
    expect(hz.length).toBeGreaterThan(50)
    expect(Math.abs(cents(mean, 330))).toBeLessThan(25)
  })

  it('converte frequência em nota e centésimos', () => {
    expect(frequencyToNote(440)).toMatchObject({ name: 'A4', cents: 0 })
    expect(frequencyToNote(261.63).name).toBe('C4')
    expect(frequencyToNote(midiToFrequency(60.3))).toMatchObject({ name: 'C4', cents: 30 })
    expect(frequencyToNote(midiToFrequency(61.6))).toMatchObject({ name: 'D4', cents: -40 })
    expect(frequencyToNote(110).name).toBe('A2')
  })

  it('mede nível em dBFS', () => {
    const { dbfs, peak } = frameLevel(voiceTone(440, 0.2, SR, { db: -20 }))
    expect(dbfs).toBeGreaterThan(-21.5)
    expect(dbfs).toBeLessThan(-18.5)
    expect(peak).toBeGreaterThan(0.1)
    expect(frameLevel(new Float32Array(100)).dbfs).toBe(-120)
  })
})

describe('classificação de quadros: silêncio, ruído e voz', () => {
  const states = (signal: Float32Array): string[] => analyze(signal).map((f) => f.state)

  it('silêncio total é silêncio', () => {
    expect(new Set(states(silence(1, SR)))).toEqual(new Set(['silence']))
  })

  it('voz estável é voz, com a nota certa', () => {
    const result = analyze(voiceTone(440, 1, SR))
    const voice = result.filter((f) => f.state === 'voice')
    expect(voice.length).toBeGreaterThan(result.length * 0.9)
    expect(voice[20]!.note).toBe('A4')
    expect(Math.abs(voice[20]!.cents!)).toBeLessThanOrEqual(10)
  })

  it('ruído branco alto é ruído (não voz)', () => {
    const result = analyze(whiteNoise(1, SR, -22, 3))
    expect(result.filter((f) => f.state === 'voice').length).toBeLessThan(result.length * 0.05)
    expect(result.slice(0, 20).every((f) => f.state === 'noise')).toBe(true)
  })

  it('ruído muito baixo (abaixo do piso) é silêncio', () => {
    expect(new Set(states(whiteNoise(1, SR, -70, 5)))).toEqual(new Set(['silence']))
  })

  it('entrada vocal curta é detectada e volta ao silêncio', () => {
    const signal = concat(silence(0.5, SR), voiceTone(330, 0.4, SR), silence(0.6, SR))
    const result = analyze(signal)
    const voiced = result.filter((f) => f.state === 'voice')
    expect(voiced.length).toBeGreaterThan(15)
    expect(voiced.length).toBeLessThan(45)
    expect(result[0]!.state).toBe('silence')
    expect(result[result.length - 1]!.state).toBe('silence')
  })

  it('entrada vocal contínua fica em "voz" do começo ao fim', () => {
    const voiced = analyze(voiceTone(261.6, 3, SR)).filter((f) => f.state === 'voice')
    expect(voiced.length).toBeGreaterThan(250)
  })

  it('o ruído ambiente estimado sobe em ambiente ruidoso e não muda com voz', () => {
    const analyzer = new VoiceAnalyzer(SR)
    const quiet = analyze(silence(2, SR), analyzer)
    const floorQuiet = quiet[quiet.length - 1]!.noiseFloorDb
    analyze(whiteNoise(20, SR, -32, 9), analyzer)
    expect(analyzer.noiseFloorDb).toBeGreaterThan(floorQuiet + 8)
    expect(analyzer.roomIsNoisy || analyzer.noiseFloorDb > -45).toBe(true)

    const analyzer2 = new VoiceAnalyzer(SR)
    analyze(silence(1, SR), analyzer2)
    const before = analyzer2.noiseFloorDb
    analyze(voiceTone(330, 5, SR, { db: -15 }), analyzer2)
    expect(Math.abs(analyzer2.noiseFloorDb - before)).toBeLessThan(1)
  })

  it('detecta saturação (clipping)', () => {
    const loud = voiceTone(330, 0.3, SR, { db: -1 }).map((v) => Math.max(-1, Math.min(1, v * 6)))
    expect(analyze(loud).some((f) => f.clipping)).toBe(true)
    expect(analyze(voiceTone(330, 0.3, SR)).some((f) => f.clipping)).toBe(false)
  })

  it('voz baixinha com ruído de fundo ainda é voz, se estiver acima do ruído', () => {
    const noisy = mix(voiceTone(220, 2, SR, { db: -20 }), whiteNoise(2, SR, -48, 11))
    const voice = analyze(noisy).filter((f) => f.state === 'voice')
    expect(voice.length).toBeGreaterThan(150)
  })
})

describe('métricas da apresentação', () => {
  it('voz contínua: quase tudo com voz, uma corrida longa, estável', () => {
    const s = summarize(voiceTone(261.6, 6, SR))
    expect(s.voicedFraction).toBeGreaterThan(0.9)
    expect(s.voicedRunCount).toBe(1)
    expect(s.longestRunSec).toBeGreaterThan(5)
    expect(s.stableFraction).toBeGreaterThan(0.95)
    expect(s.longestGapSec).toBeLessThan(0.3)
    expect(s.durationSec).toBeGreaterThan(5.5)
  })

  it('silêncio: nenhuma voz, o silêncio inteiro é o maior intervalo', () => {
    const s = summarize(silence(6, SR))
    expect(s.voicedFraction).toBe(0)
    expect(s.voicedRunCount).toBe(0)
    expect(s.longestGapSec).toBeGreaterThan(5.5)
    expect(s.silenceFraction).toBeGreaterThan(0.99)
  })

  it('ruído: fração de ruído alta e nenhuma voz', () => {
    const s = summarize(whiteNoise(4, SR, -22, 4))
    expect(s.voicedFraction).toBeLessThan(0.05)
    expect(s.noiseFraction).toBeGreaterThan(0.3)
  })

  it('lacunas curtas (respiração/consoante) não quebram a corrida; longas quebram', () => {
    const short = concat(voiceTone(330, 1, SR), silence(0.08, SR), voiceTone(330, 1, SR))
    expect(summarize(short).voicedRunCount).toBe(1)
    const long = concat(voiceTone(330, 1, SR), silence(0.6, SR), voiceTone(330, 1, SR))
    const s = summarize(long)
    expect(s.voicedRunCount).toBe(2)
    expect(s.longestGapSec).toBeGreaterThan(0.4)
  })

  it('ruídos curtíssimos de voz (< 0,1 s) não contam como corrida', () => {
    const blips = concat(
      silence(1, SR),
      voiceTone(330, 0.06, SR),
      silence(1, SR),
      voiceTone(330, 0.06, SR),
      silence(1, SR)
    )
    expect(summarize(blips).voicedRunCount).toBe(0)
  })

  it('pitch estável vs. pitch instável (saltos aleatórios de oitava/quinta)', () => {
    const steady = summarize(melody([[220, 3]], SR))
    const notes: [number, number][] = Array.from({ length: 30 }, (_, i) => [
      [110, 330, 220, 587, 147, 440][i % 6]!,
      0.1
    ])
    const jumpy = summarize(melody(notes, SR))
    expect(steady.stableFraction).toBeGreaterThan(0.95)
    expect(jumpy.stableFraction).toBeLessThan(steady.stableFraction - 0.2)
  })

  it('melodia com notas sustentadas continua "estável" (troca de nota não é instabilidade)', () => {
    const tune = melody(
      [
        [262, 1],
        [294, 1],
        [330, 1],
        [349, 1],
        [392, 1]
      ],
      SR
    )
    expect(summarize(tune).stableFraction).toBeGreaterThan(0.9)
  })

  it('a nova corrida não herda a mediana de pitch da anterior', () => {
    const signal = concat(voiceTone(150, 1, SR), silence(1, SR), voiceTone(600, 1, SR))
    expect(summarize(signal).stableFraction).toBeGreaterThan(0.9)
  })

  it('resumo pode ser pedido várias vezes sem mudar o estado', () => {
    const metrics = new VoiceMetrics(FRAME_SEC)
    for (const f of analyze(voiceTone(330, 2, SR))) metrics.add(f)
    expect(metrics.summary()).toEqual(metrics.summary())
  })

  it('guarda a linha do tempo de pitch com o tempo da música', () => {
    const metrics = new VoiceMetrics(FRAME_SEC)
    const list = analyze(voiceTone(330, 0.5, SR))
    list.forEach((f, i) => metrics.add(f, i * FRAME_SEC))
    expect(metrics.pitchTrack).toHaveLength(list.length)
    expect(metrics.pitchTrack[3]!.songTime).toBeCloseTo(3 * FRAME_SEC, 6)
  })
})

describe('AVALIAÇÃO BÁSICA (nota 0–100)', () => {
  const score = (signal: Float32Array): number | null => computeBasicScore(summarize(signal)).score

  it('rotula o modo como AVALIAÇÃO BÁSICA e traz o aviso de que não mede afinação', () => {
    const result = computeBasicScore(summarize(voiceTone(330, 6, SR)))
    expect(result.mode).toBe('basic')
    expect(result.label).toBe('AVALIAÇÃO BÁSICA')
    expect(result.label).not.toMatch(/REFERÊNCIA/)
    expect(result.disclaimer).toMatch(/NÃO mede se você cantou as notas certas/)
  })

  it('silêncio e só ruído recebem nota 0', () => {
    expect(score(silence(8, SR))).toBe(0)
    expect(score(whiteNoise(8, SR, -22, 2))).toBe(0)
  })

  it('canto contínuo e estável recebe nota alta; intermitente, média; pouco, baixa', () => {
    const continuous = score(voiceTone(261.6, 10, SR))!
    const phrases = score(
      concat(...Array.from({ length: 4 }, () => concat(voiceTone(261.6, 1.6, SR), silence(1, SR))))
    )!
    const little = score(concat(silence(8, SR), voiceTone(261.6, 1.2, SR), silence(2, SR)))!
    expect(continuous).toBeGreaterThanOrEqual(90)
    expect(phrases).toBeGreaterThan(little)
    expect(continuous).toBeGreaterThan(phrases - 1)
    expect(little).toBeLessThan(40)
  })

  it('ruído de fundo forte reduz a nota; o mesmo canto em ambiente limpo pontua mais', () => {
    // frases com pausas: é nas pausas que o ruído do ambiente aparece
    const phrases = concat(
      ...Array.from({ length: 5 }, () =>
        concat(voiceTone(261.6, 2, SR, { db: -14 }), silence(1.2, SR))
      )
    )
    const clean = score(phrases)!
    const noisy = score(mix(phrases, whiteNoise(phrases.length / SR, SR, -30, 8)))!
    expect(noisy).toBeLessThan(clean)
    expect(
      computeBasicScore(summarize(mix(phrases, whiteNoise(phrases.length / SR, SR, -30, 8))))
        .components.quality
    ).toBeLessThan(0.6)
  })

  it('limitação documentada: ruído mascarado por voz contínua não é medido', () => {
    const voice = voiceTone(261.6, 10, SR, { db: -14 })
    expect(score(mix(voice, whiteNoise(10, SR, -30, 8)))).toBe(score(voice))
  })

  it('cantar pouco não rende pontos de estabilidade/continuidade "de graça"', () => {
    const little = concat(silence(8, SR), voiceTone(261.6, 1.2, SR), silence(2, SR))
    const r = computeBasicScore(summarize(little))
    expect(r.components.stability).toBeGreaterThan(0.9) // o pouco que cantou foi estável...
    expect(r.score).toBeLessThan(25) // ...mas a nota reflete que cantou quase nada
  })

  it('é determinística: a mesma medição dá sempre a mesma nota', () => {
    const s = summarize(
      melody(
        [
          [262, 3],
          [330, 3],
          [392, 3]
        ],
        SR
      )
    )
    const a = computeBasicScore(s)
    for (let i = 0; i < 5; i++) expect(computeBasicScore(s)).toEqual(a)
    expect(a.score).toBeGreaterThanOrEqual(0)
    expect(a.score).toBeLessThanOrEqual(100)
  })

  it('apresentação curta demais não recebe nota', () => {
    const result = computeBasicScore(summarize(voiceTone(330, MIN_PERFORMANCE_SEC - 2, SR)))
    expect(result.score).toBeNull()
    expect(result.insufficientReason).toMatch(/curta demais/)
  })

  it('não usa aleatoriedade: componentes em 0–1 e nota = fórmula documentada', () => {
    const r = computeBasicScore(summarize(voiceTone(261.6, 8, SR)))
    for (const v of Object.values(r.components)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    const c = r.components
    const expected = Math.round(
      100 *
        (0.35 * c.activity +
          c.activity *
            (0.25 * c.stability + 0.2 * c.continuity + 0.1 * c.silence + 0.1 * c.quality))
    )
    expect(r.score).toBe(expected) // voz contínua: gate = 1
  })

  it('volume alto sem voz clara (assobio de chiado) não engana: saturação pesa', () => {
    const clipped = voiceTone(330, 8, SR, { db: -1 }).map((v) => Math.max(-1, Math.min(1, v * 8)))
    expect(computeBasicScore(summarize(clipped)).components.quality).toBeLessThan(0.7)
  })

  it('escala de volume não muda o resultado enquanto o sinal está acima do piso', () => {
    const loud = score(scaleDb(voiceTone(261.6, 8, SR, { db: -12 }), 0))!
    const soft = score(scaleDb(voiceTone(261.6, 8, SR, { db: -12 }), -12))!
    expect(Math.abs(loud - soft)).toBeLessThanOrEqual(3)
  })
})

describe('latência e compensação', () => {
  it('total = base (medida ou automática) + ajuste manual, nunca negativo', () => {
    expect(totalLatencyMs({ autoMs: 80, measuredMs: null, manualMs: 20 })).toBe(100)
    expect(totalLatencyMs({ autoMs: 80, measuredMs: 150, manualMs: -30 })).toBe(120)
    expect(totalLatencyMs({ autoMs: 10, measuredMs: null, manualMs: -200 })).toBe(0)
  })

  it('o tempo da música é adiantado pela latência (o cantor não é penalizado pelo atraso)', () => {
    const c = { autoMs: 250, measuredMs: null, manualMs: 0 }
    expect(compensateSongTime(10, c)).toBeCloseTo(9.75, 6)
    expect(compensateSongTime(0.1, c)).toBe(0)
    expect(compensateSongTime(10, DEFAULT_LATENCY)).toBe(10)
  })

  it('a latência não altera a nota da avaliação básica (só o tempo dos quadros)', () => {
    const list = analyze(voiceTone(261.6, 8, SR))
    const run = (latencyMs: number): number | null => {
      const session = new PerformanceSession(FRAME_SEC, {
        autoMs: latencyMs,
        measuredMs: null,
        manualMs: 0
      })
      session.start()
      list.forEach((f, i) => session.addFrame(f, i * FRAME_SEC))
      return session.finish().score.score
    }
    expect(run(0)).toBe(run(400))
  })

  it('estimativa automática soma as latências informadas e ignora valores ausentes/inválidos', () => {
    expect(autoLatencyMs({ baseLatency: 0.01, outputLatency: 0.04, inputLatency: 0.02 })).toBe(70)
    expect(autoLatencyMs({ baseLatency: 0.01 })).toBe(10)
    expect(autoLatencyMs({ outputLatency: NaN, inputLatency: -1 })).toBe(0)
  })

  it('ajuste manual é limitado à faixa permitida', () => {
    expect(clampManualMs(9999)).toBe(600)
    expect(clampManualMs(-9999)).toBe(-200)
    expect(clampManualMs(NaN)).toBe(0)
  })

  it('mede o atraso de um clique gravado (ida e volta)', () => {
    const rec = new Float32Array(SR)
    const noise = whiteNoise(1, SR, -60, 3)
    rec.set(noise)
    const emit = Math.round(0.4 * SR)
    const arrival = emit + Math.round(0.085 * SR)
    for (let i = 0; i < 200; i++)
      rec[arrival + i] = (rec[arrival + i] ?? 0) + Math.sin((i / 20) * Math.PI) * 0.5
    const delay = findClickDelay(rec, SR, emit)!
    expect(delay).toBeGreaterThan(83)
    expect(delay).toBeLessThan(88)
    expect(findClickDelay(noise, SR, emit)).toBeNull() // sem clique gravado
  })

  it('só aceita a medição se houver ao menos 2 cliques consistentes', () => {
    expect(aggregateLoopback([85, 86, 84])).toBe(85)
    expect(aggregateLoopback([85, null, 87])).toBe(86)
    expect(aggregateLoopback([85, null, null])).toBeNull()
    expect(aggregateLoopback([85, 140, 86])).toBeNull()
    expect(aggregateLoopback([])).toBeNull()
  })
})

describe('apresentação: início e fim da captura', () => {
  const list = analyze(voiceTone(261.6, 8, SR))

  it('só contabiliza quadros enquanto está rodando (pausa e fora da apresentação ficam de fora)', () => {
    const session = new PerformanceSession(FRAME_SEC, DEFAULT_LATENCY, 7, 12)
    expect(session.addFrame(list[0]!, 0)).toBe(false) // ainda não começou
    session.start()
    for (let i = 0; i < 100; i++) session.addFrame(list[i]!, i * FRAME_SEC)
    session.pause()
    expect(session.addFrame(list[100]!, 1)).toBe(false)
    session.resume()
    for (let i = 100; i < 200; i++) session.addFrame(list[i]!, i * FRAME_SEC)
    const result = session.finish()
    expect(session.isRunning).toBe(false)
    expect(session.addFrame(list[0]!, 0)).toBe(false) // depois de terminar
    expect(result.summary.durationSec).toBeCloseTo(200 * FRAME_SEC, 6)
    expect(result.songId).toBe(7)
    expect(result.completedFraction).toBeCloseTo((200 * FRAME_SEC) / 12, 4)
  })

  it('aplica a compensação ao tempo de cada quadro', () => {
    const session = new PerformanceSession(FRAME_SEC, {
      autoMs: 200,
      measuredMs: null,
      manualMs: 0
    })
    session.start()
    session.addFrame(list[0]!, 5)
    session.addFrame(list[1]!, null)
    const track = session.finish().track
    expect(track[0]!.songTime).toBeCloseTo(4.8, 6)
    expect(track[1]!.songTime).toBeNull()
  })

  it('setLatency vale para os quadros seguintes', () => {
    const session = new PerformanceSession(FRAME_SEC, DEFAULT_LATENCY)
    session.start()
    session.addFrame(list[0]!, 5)
    session.setLatency({ autoMs: 500, measuredMs: null, manualMs: 0 })
    session.addFrame(list[1]!, 5)
    const track = session.finish().track
    expect([track[0]!.songTime, track[1]!.songTime]).toEqual([5, 4.5])
  })

  it('sem duração conhecida da música, completedFraction é null', () => {
    const session = new PerformanceSession(FRAME_SEC, DEFAULT_LATENCY)
    session.start()
    session.addFrame(list[0]!, 0)
    expect(session.finish().completedFraction).toBeNull()
  })
})

describe('política do microfone (privacidade)', () => {
  const base = {
    evaluationEnabled: false,
    diagnosticsOn: false,
    phase: 'idle' as const,
    pausedForSec: 0
  }

  it('desligado por padrão: sem avaliação e sem teste, o microfone nunca abre', () => {
    for (const phase of ['idle', 'loading', 'playing', 'paused', 'stopped', 'error'] as const) {
      expect(shouldMicBeActive({ ...base, phase })).toBe(false)
    }
  })

  it('com avaliação habilitada, só abre durante a apresentação', () => {
    const on = { ...base, evaluationEnabled: true }
    expect(shouldMicBeActive({ ...on, phase: 'idle' })).toBe(false)
    expect(shouldMicBeActive({ ...on, phase: 'loading' })).toBe(true)
    expect(shouldMicBeActive({ ...on, phase: 'playing' })).toBe(true)
    expect(shouldMicBeActive({ ...on, phase: 'stopped' })).toBe(false)
    expect(shouldMicBeActive({ ...on, phase: 'error' })).toBe(false)
  })

  it('pausa curta mantém o microfone; pausa longa libera', () => {
    const paused = { ...base, evaluationEnabled: true, phase: 'paused' as const }
    expect(shouldMicBeActive({ ...paused, pausedForSec: 5 })).toBe(true)
    expect(shouldMicBeActive({ ...paused, pausedForSec: 25 })).toBe(false)
  })

  it('o teste de diagnóstico abre o microfone mesmo sem música; desligar libera', () => {
    expect(shouldMicBeActive({ ...base, diagnosticsOn: true })).toBe(true)
    expect(shouldMicBeActive({ ...base, diagnosticsOn: false })).toBe(false)
  })

  it('quadros só contam com a música tocando', () => {
    expect(shouldCountFrames('playing')).toBe(true)
    for (const p of ['idle', 'loading', 'paused', 'stopped', 'error'] as const) {
      expect(shouldCountFrames(p)).toBe(false)
    }
  })
})

describe('preferências e contratos da futura melodia', () => {
  it('avaliação vem desligada; lixo guardado volta ao padrão', () => {
    expect(DEFAULT_VOICE_PREFS.enabled).toBe(false)
    expect(parseVoicePrefs(null)).toEqual(DEFAULT_VOICE_PREFS)
    for (const bad of ['{', 'null', '5', '"x"'])
      expect(parseVoicePrefs(bad)).toEqual(DEFAULT_VOICE_PREFS)
  })

  it('lê valores válidos e limita os fora da faixa', () => {
    expect(
      parseVoicePrefs(
        JSON.stringify({
          enabled: true,
          deviceId: 'mic1',
          manualLatencyMs: 9999,
          measuredLatencyMs: 120.4
        })
      )
    ).toEqual({ enabled: true, deviceId: 'mic1', manualLatencyMs: 600, measuredLatencyMs: 120 })
    expect(parseVoicePrefs(JSON.stringify({ measuredLatencyMs: -5 })).measuredLatencyMs).toBeNull()
    expect(
      parseVoicePrefs(JSON.stringify({ measuredLatencyMs: 99999 })).measuredLatencyMs
    ).toBeNull()
    expect(parseVoicePrefs(JSON.stringify({ enabled: 'sim' })).enabled).toBe(false)
  })

  it('sem melodia, o modo é BÁSICO; o modo com referência só existe com notas (Fase 4B)', () => {
    expect(selectEvaluationMode(null)).toBe('basic')
    expect(selectEvaluationMode({ songId: 1, source: 'midi', notes: [] })).toBe('basic')
    expect(
      selectEvaluationMode({
        songId: 1,
        source: 'midi',
        notes: [{ start: 0, duration: 1, midi: 60 }]
      })
    ).toBe('reference')
    expect(MODE_LABELS.reference).toBe('AVALIAÇÃO COM MELODIA DE REFERÊNCIA')
    expect(MODE_LABELS.basic).toBe('AVALIAÇÃO BÁSICA')
  })

  it('na 4A ninguém fornece melodia de referência', async () => {
    await expect(noReferenceProvider.getMelody(1)).resolves.toBeNull()
  })
})

describe('processamento atrasado: quadros descartados não distorcem a apresentação', () => {
  const list = analyze(voiceTone(261.6, 8, SR))

  it('pular quadros (informando o intervalo real) mantém duração e frações', () => {
    const full = new VoiceMetrics(FRAME_SEC)
    for (const f of list) full.add(f)
    const halved = new VoiceMetrics(FRAME_SEC)
    list.forEach((f, i) => {
      if (i % 2 === 0) halved.add(f, null, 2 * FRAME_SEC)
    })
    const a = full.summary()
    const b = halved.summary()
    expect(b.durationSec).toBeCloseTo(a.durationSec, 1)
    expect(b.voicedFraction).toBeCloseTo(a.voicedFraction, 2)
    expect(b.stableFraction).toBeCloseTo(a.stableFraction, 2)
    expect(computeBasicScore(b).score).toBe(computeBasicScore(a).score)
  })

  it('a sessão mede o tempo pelo relógio do microfone, mesmo faltando quadros', () => {
    const session = new PerformanceSession(FRAME_SEC, DEFAULT_LATENCY)
    session.start()
    list.forEach((f, i) => {
      if (i % 3 === 0) session.addFrame(f, i * FRAME_SEC)
    })
    const seconds = session.finish().summary.durationSec
    expect(seconds).toBeGreaterThan(7.5)
    expect(seconds).toBeLessThan(8.5)
  })

  it('o tempo em pausa não conta como tempo de apresentação', () => {
    const session = new PerformanceSession(FRAME_SEC, DEFAULT_LATENCY)
    session.start()
    for (let i = 0; i < 100; i++) session.addFrame(list[i]!, i * FRAME_SEC)
    session.pause()
    session.resume()
    // depois da pausa o relógio do microfone saltou 10 s
    for (let i = 100; i < 200; i++) session.addFrame({ ...list[i]!, time: list[i]!.time + 10 }, 0)
    expect(session.finish().summary.durationSec).toBeCloseTo(200 * FRAME_SEC, 1)
  })

  it('um salto grande no relógio (> 0,5 s) vira lacuna, não tempo cantado', () => {
    const session = new PerformanceSession(FRAME_SEC, DEFAULT_LATENCY)
    session.start()
    session.addFrame(list[0]!, 0)
    session.addFrame({ ...list[1]!, time: list[1]!.time + 30 }, 0)
    expect(session.finish().summary.durationSec).toBeCloseTo(2 * FRAME_SEC, 3)
  })
})
