import type { ApplausePlan } from './applause-plan'
import {
  BED_ATTACK_FRACTION,
  BED_RELEASE_FRACTION,
  CLAP_DURATION_SEC,
  DUCK_GAIN_WHILE_SPEAKING,
  DUCK_RAMP_DOWN_SEC,
  DUCK_RAMP_UP_SEC,
  FADE_OUT_SEC,
  HOLD_AFTER_SPEECH_SEC,
  MAX_TOTAL_SEC,
  SPEECH_DELAY_SEC,
  SPEECH_LANG_FALLBACK,
  SPEECH_LANG_PREFIX,
  SPEECH_PITCH,
  SPEECH_RATE
} from './celebration-config'
import type { AudioContextLike, CelebrationDeps, VoiceLike } from './celebration-types'

export interface CelebrationHandle {
  /** Encerra tudo imediatamente: cancela a fala, para o áudio e libera o AudioContext. */
  stop(): void
}

/** Voz em português (qualquer variante); se não houver nenhuma, usa a voz padrão do sistema. */
export function pickPortugueseVoice(voices: VoiceLike[]): VoiceLike | null {
  const exact = voices.find((v) => v.lang.toLowerCase() === SPEECH_LANG_FALLBACK.toLowerCase())
  if (exact) return exact
  const anyPt = voices.find((v) => v.lang.toLowerCase().startsWith(SPEECH_LANG_PREFIX))
  return anyPt ?? null
}

/** Ruído filtrado por um envelope de ataque/liberação: a "cama" de som da plateia aplaudindo. */
function fillNoiseEnvelope(data: Float32Array, sampleRate: number, durationSec: number): void {
  const attackEnd = Math.floor(data.length * BED_ATTACK_FRACTION)
  const releaseStart = Math.floor(data.length * (1 - BED_RELEASE_FRACTION))
  for (let i = 0; i < data.length; i++) {
    let envelope = 1
    if (i < attackEnd) envelope = i / Math.max(1, attackEnd)
    else if (i > releaseStart)
      envelope = 1 - (i - releaseStart) / Math.max(1, data.length - releaseStart)
    // ruído levemente rosa (soma de duas amostras aleatórias) soa menos "chiado" que branco puro
    const noise = (Math.random() * 2 - 1 + (Math.random() * 2 - 1)) / 2
    data[i] = noise * envelope
  }
  void sampleRate
  void durationSec
}

/** Um estalo curto de ruído: uma palma individual. */
function fillClapBurst(data: Float32Array): void {
  for (let i = 0; i < data.length; i++) {
    const envelope = Math.exp(-6 * (i / data.length)) // ataque instantâneo, decaimento rápido
    data[i] = (Math.random() * 2 - 1) * envelope
  }
}

/**
 * Toca aplausos sintéticos (proporcionais à nota) e, em seguida, uma frase falada (TTS) com os
 * aplausos abaixados durante a fala (ducking) e um fade-out no final. Tudo gerado por código:
 * sem nenhum áudio de terceiros. Ver docs/FASE5_APLAUSOS_VOZ.md.
 */
export function playCelebration(
  deps: CelebrationDeps,
  plan: ApplausePlan,
  message: string,
  volume = 1
): CelebrationHandle {
  const ctx: AudioContextLike = deps.audioContext
  const setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number)
  const clearTimer =
    deps.clearTimeout ?? ((id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>))

  const masterGain = ctx.createGain()
  masterGain.gain.value = Math.max(0, Math.min(1, volume))
  masterGain.connect(ctx.destination)
  const duckGain = ctx.createGain()
  duckGain.gain.value = 1
  duckGain.connect(masterGain)

  const t0 = ctx.currentTime
  const timers: number[] = []
  let stopped = false
  const sources: { stop(when?: number): void }[] = []

  // ---- tapete de aplausos ----
  const bedSamples = Math.max(1, Math.round(plan.durationSec * ctx.sampleRate))
  const bedBuffer = ctx.createBuffer(1, bedSamples, ctx.sampleRate)
  fillNoiseEnvelope(bedBuffer.getChannelData(0), ctx.sampleRate, plan.durationSec)
  const bedFilter = ctx.createBiquadFilter()
  bedFilter.type = 'bandpass'
  bedFilter.frequency.value = 2200
  bedFilter.Q.value = 0.6
  const bedGain = ctx.createGain()
  bedGain.gain.value = plan.peakGain * 0.7
  const bedSource = ctx.createBufferSource()
  bedSource.buffer = bedBuffer
  bedSource.connect(bedFilter)
  bedFilter.connect(bedGain)
  bedGain.connect(duckGain)
  bedSource.start(t0)
  bedSource.stop(t0 + plan.durationSec)
  sources.push(bedSource)

  // ---- palmas individuais, espalhadas pela duração ----
  const clapBuffer = ctx.createBuffer(
    1,
    Math.max(1, Math.round(CLAP_DURATION_SEC * ctx.sampleRate)),
    ctx.sampleRate
  )
  fillClapBurst(clapBuffer.getChannelData(0))
  for (let i = 0; i < plan.claps; i++) {
    const when = t0 + Math.random() * plan.durationSec * 0.92
    const clapGain = ctx.createGain()
    clapGain.gain.value = plan.peakGain * (0.5 + Math.random() * 0.6)
    const clapFilter = ctx.createBiquadFilter()
    clapFilter.type = 'highpass'
    clapFilter.frequency.value = 1500 + Math.random() * 2500
    const clapSource = ctx.createBufferSource()
    clapSource.buffer = clapBuffer
    clapSource.connect(clapFilter)
    clapFilter.connect(clapGain)
    clapGain.connect(duckGain)
    clapSource.start(when)
    sources.push(clapSource)
  }

  // ---- assobio de torcida, só para notas altas ----
  if (plan.cheer) {
    const whistle = ctx.createOscillator()
    whistle.type = 'sine'
    const whistleGain = ctx.createGain()
    whistleGain.gain.value = plan.peakGain * 0.35
    whistle.connect(whistleGain)
    whistleGain.connect(duckGain)
    const start = t0 + 0.2
    whistle.frequency.setValueAtTime(1800, start)
    whistle.frequency.linearRampToValueAtTime(2600, start + 0.35)
    whistle.frequency.linearRampToValueAtTime(2000, start + 0.7)
    whistle.start(start)
    whistle.stop(start + 0.8)
    sources.push(whistle)
  }

  // ---- fala (TTS), com ducking dos aplausos ----
  const utterance = deps.createUtterance(message)
  utterance.lang = SPEECH_LANG_FALLBACK
  utterance.rate = SPEECH_RATE
  utterance.pitch = SPEECH_PITCH
  const voice = deps.pickVoice(deps.speechSynthesis.getVoices())
  if (voice) utterance.voice = voice

  const duckDown = (): void => {
    const now = ctx.currentTime
    duckGain.gain.cancelScheduledValues(now)
    duckGain.gain.setValueAtTime(duckGain.gain.value, now)
    duckGain.gain.linearRampToValueAtTime(DUCK_GAIN_WHILE_SPEAKING, now + DUCK_RAMP_DOWN_SEC)
  }
  const duckUp = (): void => {
    const now = ctx.currentTime
    duckGain.gain.cancelScheduledValues(now)
    duckGain.gain.setValueAtTime(duckGain.gain.value, now)
    duckGain.gain.linearRampToValueAtTime(1, now + DUCK_RAMP_UP_SEC)
  }
  const fadeOutAndClose = (): void => {
    if (stopped) return
    stopped = true
    const now = ctx.currentTime
    masterGain.gain.cancelScheduledValues(now)
    masterGain.gain.setValueAtTime(masterGain.gain.value, now)
    masterGain.gain.linearRampToValueAtTime(0, now + FADE_OUT_SEC)
    // só fecha o AudioContext depois que o fade terminou de tocar (fechar cedo cortaria o som na hora)
    setTimer(() => void ctx.close(), FADE_OUT_SEC * 1000)
  }
  const finishSpeech = (): void => {
    duckUp()
    const holdTimer = setTimer(fadeOutAndClose, HOLD_AFTER_SPEECH_SEC * 1000)
    timers.push(holdTimer)
  }
  utterance.onstart = duckDown
  utterance.onend = finishSpeech
  utterance.onerror = finishSpeech

  const speakTimer = setTimer(() => deps.speechSynthesis.speak(utterance), SPEECH_DELAY_SEC * 1000)
  timers.push(speakTimer)

  // rede de segurança: se a fala nunca chamar onend/onerror (voz indisponível em algumas máquinas),
  // encerra de qualquer jeito depois de MAX_TOTAL_SEC.
  const safetyTimer = setTimer(fadeOutAndClose, MAX_TOTAL_SEC * 1000)
  timers.push(safetyTimer)

  return {
    stop(): void {
      if (stopped) return
      stopped = true
      for (const timer of timers) clearTimer(timer)
      deps.speechSynthesis.cancel()
      for (const source of sources) {
        try {
          source.stop(0)
        } catch {
          /* já pode ter terminado sozinho */
        }
      }
      void ctx.close()
    }
  }
}
