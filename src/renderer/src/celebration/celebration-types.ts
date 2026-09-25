/**
 * Só a fatia da Web Audio API / Web Speech API que o controlador de comemoração usa, para dar
 * para testar com objetos falsos (sem precisar de um navegador de verdade). O adaptador real
 * (useCelebration.ts) implementa isto com `AudioContext`/`speechSynthesis` de verdade.
 */

export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, time: number): void
  linearRampToValueAtTime(value: number, time: number): void
  cancelScheduledValues(time: number): void
}

export interface GainNodeLike {
  gain: AudioParamLike
  connect(target: AudioNodeLike): void
  disconnect(): void
}

export interface AudioNodeLike {
  connect(target: AudioNodeLike): void
}

export interface AudioBufferLike {
  getChannelData(channel: number): Float32Array
}

export interface BufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  start(when?: number): void
  stop(when?: number): void
  onended: (() => void) | null
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: string
  frequency: { value: number }
  Q: { value: number }
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
  start(when?: number): void
  stop(when?: number): void
}

export interface AudioContextLike {
  readonly currentTime: number
  readonly sampleRate: number
  readonly destination: AudioNodeLike
  createGain(): GainNodeLike
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike
  createBufferSource(): BufferSourceNodeLike
  createBiquadFilter(): BiquadFilterNodeLike
  createOscillator(): OscillatorNodeLike
  close(): Promise<void>
}

export interface UtteranceLike {
  lang: string
  rate: number
  pitch: number
  voice: unknown
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

export interface VoiceLike {
  lang: string
}

export interface SpeechSynthesisLike {
  getVoices(): VoiceLike[]
  speak(utterance: UtteranceLike): void
  cancel(): void
}

export interface CelebrationDeps {
  audioContext: AudioContextLike
  speechSynthesis: SpeechSynthesisLike
  createUtterance: (text: string) => UtteranceLike
  pickVoice: (voices: VoiceLike[]) => VoiceLike | null
  /** Relógio independente do AudioContext, para agendar o timeout de segurança. `Date.now` por padrão. */
  now?: () => number
  setTimeout?: (fn: () => void, ms: number) => number
  clearTimeout?: (id: number) => void
}
