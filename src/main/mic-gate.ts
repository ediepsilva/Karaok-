/**
 * Trava do microfone. O Chromium só recebe permissão de áudio se o próprio app "armou" a trava
 * imediatamente antes (uma armação vale para UM pedido e expira em poucos segundos). Assim, nenhum
 * outro trecho de código consegue abrir o microfone sem passar pelo fluxo controlado (avaliação
 * habilitada ou teste explícito), e o main sabe e registra quando o microfone está em uso.
 */
export class MicGate {
  private armedUntil = 0
  private active = false

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly armTtlMs = 8000
  ) {}

  arm(): void {
    this.armedUntil = this.now() + this.armTtlMs
  }

  get armed(): boolean {
    return this.now() < this.armedUntil
  }

  /** Consome a armação: devolve true se havia uma válida (e a invalida). */
  consumeArm(): boolean {
    const valid = this.armed
    this.armedUntil = 0
    return valid
  }

  setActive(active: boolean): void {
    this.active = active
  }

  get isActive(): boolean {
    return this.active
  }

  /** Consultas de dispositivos de áudio (nomes) só enquanto armado ou capturando. */
  allowsAudioCheck(): boolean {
    return this.active || this.armed
  }
}
