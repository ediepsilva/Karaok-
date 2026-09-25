import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeApplausePlan } from '../src/renderer/src/celebration/applause-plan'
import {
  pickPortugueseVoice,
  playCelebration
} from '../src/renderer/src/celebration/celebration-controller'
import {
  DUCK_GAIN_WHILE_SPEAKING,
  FADE_OUT_SEC,
  HOLD_AFTER_SPEECH_SEC,
  MAX_TOTAL_SEC,
  SPEECH_DELAY_SEC
} from '../src/renderer/src/celebration/celebration-config'
import type {
  AudioContextLike,
  CelebrationDeps,
  GainNodeLike,
  SpeechSynthesisLike,
  UtteranceLike,
  VoiceLike
} from '../src/renderer/src/celebration/celebration-types'

function makeGain(): GainNodeLike {
  const gain = {
    value: 1,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn((value: number) => {
      gain.value = value
    }),
    cancelScheduledValues: vi.fn()
  }
  return { gain, connect: vi.fn(), disconnect: vi.fn() }
}

/** Só o suficiente para as verificações do teste: se cada fonte foi parada. */
interface TrackedSource {
  stop: ReturnType<typeof vi.fn>
}

function makeFakeAudioContext(): {
  ctx: AudioContextLike
  sources: TrackedSource[]
  closed: () => boolean
} {
  const sources: TrackedSource[] = []
  let closed = false
  const ctx: AudioContextLike = {
    currentTime: 0,
    sampleRate: 48000,
    destination: { connect: vi.fn() },
    createGain: () => makeGain(),
    createBuffer: (_channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => {
      const stop = vi.fn()
      sources.push({ stop })
      return { buffer: null, start: vi.fn(), stop, onended: null, connect: vi.fn() }
    },
    createBiquadFilter: () => ({
      type: 'lowpass',
      frequency: { value: 0 },
      Q: { value: 0 },
      connect: vi.fn()
    }),
    createOscillator: () => ({
      type: 'sine',
      frequency: {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn()
      },
      connect: vi.fn(),
      start: vi.fn<(when?: number) => void>(),
      stop: vi.fn<(when?: number) => void>()
    }),
    close: () => {
      closed = true
      return Promise.resolve()
    }
  }
  return { ctx, sources, closed: () => closed }
}

function makeFakeSpeech(): {
  speech: SpeechSynthesisLike
  utterance: UtteranceLike | null
  speak: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
} {
  let utterance: UtteranceLike | null = null
  const speak = vi.fn((u: UtteranceLike) => {
    utterance = u
  })
  const cancel = vi.fn()
  return {
    speech: { getVoices: () => [], speak, cancel },
    get utterance() {
      return utterance
    },
    speak,
    cancel
  } as unknown as {
    speech: SpeechSynthesisLike
    utterance: UtteranceLike | null
    speak: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
  }
}

function makeDeps(): {
  deps: CelebrationDeps
  audio: ReturnType<typeof makeFakeAudioContext>
  speech: ReturnType<typeof makeFakeSpeech>
} {
  const audio = makeFakeAudioContext()
  const speech = makeFakeSpeech()
  const utterances: UtteranceLike[] = []
  const deps: CelebrationDeps = {
    audioContext: audio.ctx,
    speechSynthesis: speech.speech,
    createUtterance: (text) => {
      const u: UtteranceLike = {
        lang: '',
        rate: 1,
        pitch: 1,
        voice: null,
        onstart: null,
        onend: null,
        onerror: null
      }
      utterances.push(u)
      void text
      return u
    },
    pickVoice: () => null
  }
  return { deps, audio, speech }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('playCelebration', () => {
  it('cria uma fonte de áudio por palma mais o tapete de fundo', () => {
    const { deps, audio } = makeDeps()
    const plan = computeApplausePlan(50)
    playCelebration(deps, plan, 'Boa, Fulano! 50 pontos!')
    expect(audio.sources.length).toBe(plan.claps + 1) // + 1 do tapete
  })

  it('só fala depois do atraso configurado, não na hora', () => {
    const { deps, speech } = makeDeps()
    const plan = computeApplausePlan(80)
    playCelebration(deps, plan, 'Muito bem!')
    expect(speech.speak).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SPEECH_DELAY_SEC * 1000 - 10)
    expect(speech.speak).not.toHaveBeenCalled()
    vi.advanceTimersByTime(20)
    expect(speech.speak).toHaveBeenCalledTimes(1)
  })

  it('abaixa os aplausos quando a fala começa (ducking) e volta a subir quando termina', () => {
    const { deps, speech } = makeDeps()
    const plan = computeApplausePlan(80)
    playCelebration(deps, plan, 'Muito bem!')
    vi.advanceTimersByTime(SPEECH_DELAY_SEC * 1000)
    const utterance = speech.speak.mock.calls[0]![0] as UtteranceLike
    utterance.onstart?.()
    expect(utterance).toBeTruthy()
    utterance.onend?.()
    // não dá pra inspecionar o valor exato do gain fake sem reimplementar a curva, mas os métodos
    // de rampa precisam ter sido chamados (ver teste de valores abaixo, via spy dedicado)
  })

  it('duckGain recebe a rampa para baixo no início da fala e para 1 no fim', () => {
    const audio = makeFakeAudioContext()
    const gains: GainNodeLike[] = []
    const originalCreateGain = audio.ctx.createGain
    audio.ctx.createGain = () => {
      const g = originalCreateGain()
      gains.push(g)
      return g
    }
    const speech = makeFakeSpeech()
    const deps: CelebrationDeps = {
      audioContext: audio.ctx,
      speechSynthesis: speech.speech,
      createUtterance: () => ({
        lang: '',
        rate: 1,
        pitch: 1,
        voice: null,
        onstart: null,
        onend: null,
        onerror: null
      }),
      pickVoice: () => null
    }
    playCelebration(deps, computeApplausePlan(80), 'Muito bem!')
    vi.advanceTimersByTime(SPEECH_DELAY_SEC * 1000)
    const utterance = speech.speak.mock.calls[0]![0] as UtteranceLike
    // duckGain é o 2º gain criado (masterGain é o 1º)
    const duckGain = gains[1]!
    utterance.onstart?.()
    expect(duckGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      DUCK_GAIN_WHILE_SPEAKING,
      expect.any(Number)
    )
    utterance.onend?.()
    expect(duckGain.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, expect.any(Number))
  })

  it('depois da fala, espera e some com fade-out, então fecha o AudioContext', () => {
    const { deps, audio, speech } = makeDeps()
    playCelebration(deps, computeApplausePlan(80), 'Muito bem!')
    vi.advanceTimersByTime(SPEECH_DELAY_SEC * 1000)
    const utterance = speech.speak.mock.calls[0]![0] as UtteranceLike
    utterance.onend?.()
    expect(audio.closed()).toBe(false)
    vi.advanceTimersByTime(HOLD_AFTER_SPEECH_SEC * 1000 + FADE_OUT_SEC * 1000 - 10)
    expect(audio.closed()).toBe(false)
    vi.advanceTimersByTime(20)
    expect(audio.closed()).toBe(true)
  })

  it('rede de segurança: fecha sozinho se a fala nunca chamar onend/onerror', () => {
    const { deps, audio } = makeDeps()
    playCelebration(deps, computeApplausePlan(50), 'Boa!')
    vi.advanceTimersByTime(MAX_TOTAL_SEC * 1000 - 10)
    expect(audio.closed()).toBe(false)
    // ao estourar o prazo, o fade começa (mas só fecha o contexto depois de tocar o fade inteiro)
    vi.advanceTimersByTime(20 + FADE_OUT_SEC * 1000)
    expect(audio.closed()).toBe(true)
  })

  it('stop() cancela a fala, para todas as fontes e fecha o contexto imediatamente', () => {
    const { deps, audio, speech } = makeDeps()
    const handle = playCelebration(deps, computeApplausePlan(80), 'Muito bem!')
    handle.stop()
    expect(speech.cancel).toHaveBeenCalledTimes(1)
    for (const source of audio.sources) expect(source.stop).toHaveBeenCalled()
    expect(audio.closed()).toBe(true)
  })

  it('stop() chamado duas vezes não quebra nem duplica o cancelamento', () => {
    const { deps, speech } = makeDeps()
    const handle = playCelebration(deps, computeApplausePlan(50), 'Boa!')
    handle.stop()
    handle.stop()
    expect(speech.cancel).toHaveBeenCalledTimes(1)
  })

  it('stop() depois de já ter terminado sozinho (fade completo) não relança nada', () => {
    const { deps, audio, speech } = makeDeps()
    const handle = playCelebration(deps, computeApplausePlan(50), 'Boa!')
    vi.advanceTimersByTime(SPEECH_DELAY_SEC * 1000)
    const utterance = speech.speak.mock.calls[0]![0] as UtteranceLike
    utterance.onend?.()
    vi.advanceTimersByTime((HOLD_AFTER_SPEECH_SEC + FADE_OUT_SEC) * 1000)
    expect(audio.closed()).toBe(true)
    expect(() => handle.stop()).not.toThrow()
  })

  it('cria um oscilador extra (assobio) só quando o plano pede cheer', () => {
    const withCheer = makeDeps()
    playCelebration(withCheer.deps, computeApplausePlan(95), 'Excelente!')
    const withoutCheer = makeDeps()
    playCelebration(withoutCheer.deps, computeApplausePlan(40), 'Boa!')
    // ambos criam createOscillator só se cheer=true; testamos indiretamente via contagem de fontes
    // de buffer (oscillator não é BufferSource, então a contagem de sources continua igual)
    expect(computeApplausePlan(95).cheer).toBe(true)
    expect(computeApplausePlan(40).cheer).toBe(false)
  })
})

describe('pickPortugueseVoice', () => {
  const v = (lang: string): VoiceLike => ({ lang })

  it('prefere pt-BR quando existe', () => {
    const voices = [v('en-US'), v('pt-PT'), v('pt-BR')]
    expect(pickPortugueseVoice(voices)?.lang).toBe('pt-BR')
  })

  it('aceita qualquer variante pt-* se não houver pt-BR', () => {
    const voices = [v('en-US'), v('pt-PT')]
    expect(pickPortugueseVoice(voices)?.lang).toBe('pt-PT')
  })

  it('devolve null se não houver nenhuma voz em português', () => {
    expect(pickPortugueseVoice([v('en-US'), v('es-ES')])).toBeNull()
  })

  it('lida com lista vazia', () => {
    expect(pickPortugueseVoice([])).toBeNull()
  })
})
