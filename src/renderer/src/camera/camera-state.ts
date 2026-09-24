export type CameraStatus = 'off' | 'starting' | 'on' | 'error'
/** `pip`: câmera pequena sobre o canto do CDG; `side`: câmera ao lado do CDG. */
export type CameraLayout = 'pip' | 'side'

export interface CameraDevice {
  id: string
  label: string
}

/** Preferências do usuário (guardadas entre sessões). */
export interface CameraPrefs {
  deviceId: string
  layout: CameraLayout
  mirror: boolean
  /** Liga a câmera sozinha quando uma música começa a tocar. */
  autoStart: boolean
}

export interface CameraState {
  status: CameraStatus
  devices: CameraDevice[]
  /** Câmera realmente em uso (pode diferir da preferida se esta sumiu). */
  activeDeviceId: string | null
  error: string | null
  notice: string | null
  prefs: CameraPrefs
}

export type CameraAction =
  | { type: 'devices'; devices: CameraDevice[] }
  | { type: 'starting' }
  | { type: 'started'; deviceId: string; notice?: string | null }
  | { type: 'stopped' }
  | { type: 'failed'; message: string }
  | { type: 'prefs'; prefs: Partial<CameraPrefs> }

export const DEFAULT_CAMERA_PREFS: CameraPrefs = {
  deviceId: '',
  layout: 'pip',
  mirror: true,
  autoStart: false
}

export function initialCameraState(prefs: CameraPrefs = DEFAULT_CAMERA_PREFS): CameraState {
  return { status: 'off', devices: [], activeDeviceId: null, error: null, notice: null, prefs }
}

export function cameraReducer(state: CameraState, action: CameraAction): CameraState {
  switch (action.type) {
    case 'devices':
      return { ...state, devices: action.devices }
    case 'starting':
      return { ...state, status: 'starting', error: null, notice: null }
    case 'started':
      return {
        ...state,
        status: 'on',
        activeDeviceId: action.deviceId,
        error: null,
        notice: action.notice ?? null,
        prefs: { ...state.prefs, deviceId: action.deviceId }
      }
    case 'stopped':
      return { ...state, status: 'off', activeDeviceId: null, error: null, notice: null }
    case 'failed':
      return {
        ...state,
        status: 'error',
        activeDeviceId: null,
        error: action.message,
        notice: null
      }
    case 'prefs':
      return { ...state, prefs: { ...state.prefs, ...action.prefs } }
  }
}

/** Traduz os erros de getUserMedia em mensagens que o usuário consegue agir. */
export function describeCameraError(error: unknown): string {
  const name =
    error instanceof Error || (error as { name?: unknown })?.name
      ? String((error as { name: unknown }).name)
      : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'Sem permissão para usar a câmera. Verifique em Configurações do Windows › Privacidade › Câmera se o acesso está liberado.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Nenhuma câmera encontrada. Conecte uma câmera e tente de novo.'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'Não foi possível abrir a câmera: ela pode estar em uso por outro programa.'
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'A câmera escolhida não está disponível.'
    default:
      return 'Não foi possível iniciar a câmera.'
  }
}

/** A câmera preferida só serve se ainda estiver conectada; senão usa-se a padrão. */
export function pickDevice(devices: CameraDevice[], preferredId: string): string | null {
  return preferredId && devices.some((d) => d.id === preferredId) ? preferredId : null
}

/** Erros em que vale tentar de novo com a câmera padrão. */
export function isDeviceUnavailableError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name
  return (
    name === 'OverconstrainedError' ||
    name === 'NotFoundError' ||
    name === 'ConstraintNotSatisfiedError'
  )
}

/** Lê as preferências guardadas, aceitando lixo/valores antigos sem quebrar. */
export function parseCameraPrefs(raw: string | null): CameraPrefs {
  if (!raw) return DEFAULT_CAMERA_PREFS
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return DEFAULT_CAMERA_PREFS
    const v = value as Record<string, unknown>
    return {
      deviceId: typeof v['deviceId'] === 'string' ? v['deviceId'].slice(0, 300) : '',
      layout: v['layout'] === 'side' ? 'side' : 'pip',
      mirror: typeof v['mirror'] === 'boolean' ? v['mirror'] : DEFAULT_CAMERA_PREFS.mirror,
      autoStart: v['autoStart'] === true
    }
  } catch {
    return DEFAULT_CAMERA_PREFS
  }
}

/** Nomes vazios (antes da permissão) viram "Câmera 1", "Câmera 2"… */
/** O que usamos de MediaDeviceInfo (tipo estrutural: evita depender de tipos de DOM). */
export interface DeviceInfoLike {
  kind: string
  deviceId: string
  label: string
}

export function toCameraDevices(list: readonly DeviceInfoLike[]): CameraDevice[] {
  return list
    .filter((d) => d.kind === 'videoinput')
    .map((d, index) => ({ id: d.deviceId, label: d.label || `Câmera ${index + 1}` }))
}
