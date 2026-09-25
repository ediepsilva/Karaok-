import { aggregateLoopback, autoLatencyMs, findClickDelay } from './latency'
import { VoiceAnalyzer, type FrameAnalysis } from './voice-analyzer'
import { HOP_SAMPLES, MAX_BACKLOG_SEC, WINDOW_SAMPLES } from './voice-config'

export interface MicDevice {
  id: string
  label: string
}

export interface MicInfo {
  deviceId: string
  label: string
  sampleRate: number
  /** Latência (saída + entrada) informada pelo navegador, em ms. */
  autoLatencyMs: number
  echoCancellation: boolean | null
  noiseSuppression: boolean | null
  autoGainControl: boolean | null
}

export interface MicHooks {
  /** Um quadro analisado; `ageSec` = há quanto tempo (s) ele foi capturado. */
  onFrame(frame: FrameAnalysis, ageSec: number): void
  /** A trilha do microfone terminou sozinha (dispositivo desconectado). */
  onEnded(): void
}

/** Alguns ajustes vêm como boolean ou como texto (ex.: "all"); só booleanos interessam. */
const asFlag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null)

/** Nomes vazios (antes da permissão) viram "Microfone 1", "Microfone 2"… */
export function toMicDevices(
  list: readonly { kind: string; deviceId: string; label: string }[]
): MicDevice[] {
  return list
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Microfone ${i + 1}` }))
}

export async function listMicrophones(): Promise<MicDevice[]> {
  return toMicDevices(await navigator.mediaDevices.enumerateDevices())
}

/**
 * Motor de captura: abre o microfone (SEM cancelamento de eco, supressão de ruído nem ganho
 * automático, que distorcem o pitch), processa em AudioWorklet e analisa cada quadro. `stop()`
 * fecha tudo: trilhas, nós e o AudioContext (a luz/uso do microfone termina).
 */
export class MicEngine {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private silent: GainNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private analyzer: VoiceAnalyzer | null = null
  private readonly ring = new Float32Array(WINDOW_SAMPLES)
  private filled = 0
  private dropped = 0
  /** startFrame = quadro do primeiro bloco gravado (-1 até chegar o primeiro). */
  private recording: { startFrame: number; chunks: Float32Array[] } | null = null

  constructor(private readonly hooks: MicHooks) {}

  get active(): boolean {
    return this.context !== null
  }

  get noiseFloorDb(): number {
    return this.analyzer?.noiseFloorDb ?? -120
  }

  get roomIsNoisy(): boolean {
    return this.analyzer?.roomIsNoisy ?? false
  }

  /** Quadros descartados por atraso no processamento (a análise não acompanhou o tempo real). */
  get droppedFrames(): number {
    return this.dropped
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? 0
  }

  async start(deviceId: string): Promise<MicInfo> {
    if (this.context) this.stop()
    const audio: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {})
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false })
    try {
      const context = new AudioContext({ latencyHint: 'interactive' })
      this.stream = stream
      this.context = context
      await context.audioWorklet.addModule(new URL('mic-worklet.js', document.baseURI).href)
      if (context.state === 'suspended') await context.resume()

      this.source = context.createMediaStreamSource(stream)
      this.node = new AudioWorkletNode(context, 'mic-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { hop: HOP_SAMPLES }
      })
      // Sem saída audível: o nó só precisa estar ligado ao destino para o Chromium processá-lo.
      this.silent = context.createGain()
      this.silent.gain.value = 0
      this.source.connect(this.node)
      this.node.connect(this.silent)
      this.silent.connect(context.destination)

      this.analyzer = new VoiceAnalyzer(context.sampleRate)
      this.filled = 0
      this.dropped = 0
      this.node.port.onmessage = (event: MessageEvent<{ frame: number; samples: Float32Array }>) =>
        this.handleBlock(event.data.frame, event.data.samples)

      const track = stream.getAudioTracks()[0]
      track?.addEventListener('ended', () => {
        if (this.stream === stream) this.hooks.onEnded()
      })
      const settings = track?.getSettings() as
        (MediaTrackSettings & { latency?: number }) | undefined
      return {
        deviceId: settings?.deviceId ?? deviceId,
        label: track?.label ?? '',
        sampleRate: context.sampleRate,
        autoLatencyMs: autoLatencyMs({
          baseLatency: context.baseLatency,
          outputLatency: (context as AudioContext & { outputLatency?: number }).outputLatency,
          inputLatency: settings?.latency
        }),
        echoCancellation: asFlag(settings?.echoCancellation),
        noiseSuppression: asFlag(settings?.noiseSuppression),
        autoGainControl: asFlag(settings?.autoGainControl)
      }
    } catch (error) {
      this.stop() // não deixa o microfone aberto se algo falhou na montagem
      throw error
    }
  }

  private handleBlock(frame: number, samples: Float32Array): void {
    const context = this.context
    const analyzer = this.analyzer
    if (!context || !analyzer) return
    if (this.recording) {
      if (this.recording.startFrame < 0) this.recording.startFrame = frame
      this.recording.chunks.push(samples)
    }
    this.ring.copyWithin(0, HOP_SAMPLES)
    this.ring.set(samples, WINDOW_SAMPLES - HOP_SAMPLES)
    this.filled = Math.min(WINDOW_SAMPLES, this.filled + HOP_SAMPLES)
    if (this.filled < WINDOW_SAMPLES) return
    const endTime = (frame + HOP_SAMPLES) / context.sampleRate
    const age = Math.max(0, context.currentTime - endTime)
    if (age > MAX_BACKLOG_SEC) {
      this.dropped++ // atrasado demais: descarta a análise deste quadro para recuperar o tempo real
      return
    }
    this.hooks.onFrame(analyzer.analyze(this.ring, endTime), age)
  }

  /** Encerra a captura e libera o dispositivo. Pode ser chamado várias vezes. */
  stop(): void {
    if (this.node) this.node.port.onmessage = null
    for (const n of [this.source, this.node, this.silent]) {
      try {
        n?.disconnect()
      } catch {
        /* já desconectado */
      }
    }
    this.stream?.getTracks().forEach((t) => t.stop())
    const context = this.context
    this.stream = null
    this.context = null
    this.node = null
    this.silent = null
    this.source = null
    this.analyzer = null
    this.recording = null
    this.filled = 0
    if (context && context.state !== 'closed') void context.close().catch(() => undefined)
  }

  /**
   * Mede a latência de ida e volta (saída do áudio → alto-falante → microfone): toca cliques
   * curtos e mede quando o microfone os ouve. Só funciona com alto-falantes (com fones o microfone
   * não ouve o clique) e em ambiente razoavelmente silencioso; devolve null se não for confiável.
   */
  async measureRoundTrip(clicks = 4): Promise<number | null> {
    const context = this.context
    if (!context) return null
    const rate = context.sampleRate
    const clickBuffer = context.createBuffer(1, Math.round(rate * 0.012), rate)
    const data = clickBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.sin((2 * Math.PI * 2000 * i) / rate) * 0.9

    const first = context.currentTime + 0.4
    const emitFrames: number[] = []
    this.recording = { startFrame: -1, chunks: [] }
    for (let k = 0; k < clicks; k++) {
      const when = first + k * 0.6
      emitFrames.push(Math.round(when * rate))
      const source = context.createBufferSource()
      source.buffer = clickBuffer
      source.connect(context.destination)
      source.start(when)
    }
    await new Promise((resolve) =>
      setTimeout(resolve, (first - context.currentTime + clicks * 0.6 + 0.5) * 1000)
    )

    const recording = this.recording
    this.recording = null
    if (!recording || recording.startFrame < 0 || !this.context) return null
    const total = recording.chunks.reduce((sum, c) => sum + c.length, 0)
    const recorded = new Float32Array(total)
    let offset = 0
    for (const chunk of recording.chunks) {
      recorded.set(chunk, offset)
      offset += chunk.length
    }
    // O relógio de saída (quadro de emissão) e o de entrada (quadro dos blocos) são o mesmo
    // relógio do AudioContext: o atraso é a diferença entre o quadro em que o clique foi emitido e
    // o quadro em que o microfone o ouviu.
    const delays = emitFrames.map((emit) =>
      findClickDelay(recorded, rate, emit - recording.startFrame)
    )
    return aggregateLoopback(delays)
  }
}
