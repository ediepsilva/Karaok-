/* global AudioWorkletProcessor, registerProcessor, currentFrame */

/**
 * Captura do microfone na thread de áudio. Junta as amostras em blocos de `hop` (padrão 512) e os
 * envia à interface com o índice do primeiro quadro (relógio do AudioContext), que serve de
 * timestamp. Nenhuma análise é feita aqui: fica em src/renderer/src/voice (testável).
 */
class MicCapture extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const hop = options && options.processorOptions && options.processorOptions.hop
    this.hop = hop > 0 ? hop : 512
    this.buffer = new Float32Array(this.hop)
    this.filled = 0
    this.startFrame = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true // microfone desconectado: continua vivo, sem dados
    for (let i = 0; i < channel.length; i++) {
      if (this.filled === 0) this.startFrame = currentFrame + i
      this.buffer[this.filled++] = channel[i]
      if (this.filled === this.hop) {
        const samples = this.buffer
        this.port.postMessage({ frame: this.startFrame, samples }, [samples.buffer])
        this.buffer = new Float32Array(this.hop)
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('mic-capture', MicCapture)
