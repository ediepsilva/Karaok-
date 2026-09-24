import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAMERA_PREFS,
  cameraReducer,
  type DeviceInfoLike,
  describeCameraError,
  initialCameraState,
  isDeviceUnavailableError,
  parseCameraPrefs,
  pickDevice,
  toCameraDevices,
  type CameraAction,
  type CameraState
} from '../src/renderer/src/camera/camera-state'
import {
  allowMediaTypes,
  createTrustedOrigin,
  installPermissionPolicy
} from '../src/main/permissions'
import { memoryLogger } from './helpers'

const run = (actions: CameraAction[], from: CameraState = initialCameraState()): CameraState =>
  actions.reduce(cameraReducer, from)

describe('cameraReducer', () => {
  it('começa desligada e segue o ciclo ligar → desligar', () => {
    expect(initialCameraState().status).toBe('off')
    let s = run([{ type: 'starting' }])
    expect(s.status).toBe('starting')
    s = run([{ type: 'started', deviceId: 'cam-1' }], s)
    expect(s).toMatchObject({ status: 'on', activeDeviceId: 'cam-1', error: null })
    expect(s.prefs.deviceId).toBe('cam-1') // a câmera usada vira a preferida
    s = run([{ type: 'stopped' }], s)
    expect(s).toMatchObject({ status: 'off', activeDeviceId: null })
    expect(s.prefs.deviceId).toBe('cam-1') // e continua lembrada
  })

  it('falha guarda a mensagem e limpa a câmera ativa; nova tentativa limpa o erro', () => {
    let s = run([{ type: 'starting' }, { type: 'failed', message: 'sem câmera' }])
    expect(s).toMatchObject({ status: 'error', error: 'sem câmera', activeDeviceId: null })
    s = run([{ type: 'starting' }], s)
    expect(s).toMatchObject({ status: 'starting', error: null })
  })

  it('aviso de troca para a câmera padrão só existe enquanto ligada', () => {
    let s = run([{ type: 'starting' }, { type: 'started', deviceId: 'x', notice: 'usando padrão' }])
    expect(s.notice).toBe('usando padrão')
    s = run([{ type: 'stopped' }], s)
    expect(s.notice).toBeNull()
  })

  it('atualiza lista de câmeras e preferências sem tocar no resto', () => {
    const s = run([
      { type: 'devices', devices: [{ id: 'a', label: 'A' }] },
      { type: 'prefs', prefs: { layout: 'side', mirror: false } }
    ])
    expect(s.devices).toHaveLength(1)
    expect(s.prefs).toMatchObject({ layout: 'side', mirror: false, autoStart: false })
    expect(s.status).toBe('off')
  })
})

describe('describeCameraError', () => {
  it.each([
    ['NotAllowedError', /permissão/i],
    ['SecurityError', /permissão/i],
    ['NotFoundError', /Nenhuma câmera/],
    ['NotReadableError', /em uso/],
    ['OverconstrainedError', /não está disponível/]
  ])('%s vira uma mensagem acionável', (name, pattern) => {
    expect(describeCameraError({ name })).toMatch(pattern)
    expect(describeCameraError(Object.assign(new Error('x'), { name }))).toMatch(pattern)
  })

  it('erros desconhecidos e valores estranhos têm mensagem genérica', () => {
    expect(describeCameraError(new Error('boom'))).toBe('Não foi possível iniciar a câmera.')
    expect(describeCameraError(null)).toBe('Não foi possível iniciar a câmera.')
    expect(describeCameraError('texto')).toBe('Não foi possível iniciar a câmera.')
  })
})

describe('escolha de câmera', () => {
  const devices = [
    { id: 'a', label: 'Integrada' },
    { id: 'b', label: 'USB' }
  ]

  it('usa a preferida só se ainda estiver conectada', () => {
    expect(pickDevice(devices, 'b')).toBe('b')
    expect(pickDevice(devices, 'sumiu')).toBeNull()
    expect(pickDevice(devices, '')).toBeNull()
    expect(pickDevice([], 'a')).toBeNull()
  })

  it('reconhece erros em que vale cair para a câmera padrão', () => {
    expect(isDeviceUnavailableError({ name: 'OverconstrainedError' })).toBe(true)
    expect(isDeviceUnavailableError({ name: 'NotFoundError' })).toBe(true)
    expect(isDeviceUnavailableError({ name: 'NotAllowedError' })).toBe(false)
    expect(isDeviceUnavailableError(null)).toBe(false)
  })

  it('lista só câmeras e dá nome às que ainda não têm (antes da permissão)', () => {
    const list = [
      { kind: 'videoinput', deviceId: '1', label: 'HD Webcam' },
      { kind: 'audioinput', deviceId: '2', label: 'Mic' },
      { kind: 'videoinput', deviceId: '3', label: '' }
    ] as DeviceInfoLike[]
    expect(toCameraDevices(list)).toEqual([
      { id: '1', label: 'HD Webcam' },
      { id: '3', label: 'Câmera 2' }
    ])
  })
})

describe('parseCameraPrefs', () => {
  it('sem valor guardado, usa os padrões (câmera nunca liga sozinha)', () => {
    expect(parseCameraPrefs(null)).toEqual(DEFAULT_CAMERA_PREFS)
    expect(DEFAULT_CAMERA_PREFS.autoStart).toBe(false)
  })

  it('lê valores válidos e ignora lixo/tipos errados', () => {
    expect(
      parseCameraPrefs(
        JSON.stringify({ deviceId: 'x', layout: 'side', mirror: false, autoStart: true })
      )
    ).toEqual({ deviceId: 'x', layout: 'side', mirror: false, autoStart: true })
    expect(
      parseCameraPrefs(
        JSON.stringify({ deviceId: 5, layout: 'voando', mirror: 'sim', autoStart: 1 })
      )
    ).toEqual(DEFAULT_CAMERA_PREFS)
    for (const bad of ['{', 'null', '42', '"texto"', '[]']) {
      expect(parseCameraPrefs(bad)).toEqual(DEFAULT_CAMERA_PREFS)
    }
  })

  it('limita o tamanho do id guardado', () => {
    expect(parseCameraPrefs(JSON.stringify({ deviceId: 'x'.repeat(5000) })).deviceId).toHaveLength(
      300
    )
  })
})

describe('política de permissões do main', () => {
  it('só aceita pedidos de mídia que sejam exclusivamente de vídeo', () => {
    expect(allowMediaTypes(['video'])).toBe(true)
    expect(allowMediaTypes(['audio'])).toBe(false)
    expect(allowMediaTypes(['video', 'audio'])).toBe(false)
    expect(allowMediaTypes([])).toBe(false)
    expect(allowMediaTypes(undefined)).toBe(false)
  })

  it('confia em file:// e no servidor de desenvolvimento, não em sites externos', () => {
    const prod = createTrustedOrigin(undefined)
    expect(prod('file:///C:/app/index.html')).toBe(true)
    expect(prod('https://evil.example/')).toBe(false)
    expect(prod('http://localhost:5173/')).toBe(false)
    const dev = createTrustedOrigin('http://localhost:5173/')
    expect(dev('http://localhost:5173/index.html')).toBe(true)
    expect(dev('http://localhost:9999/')).toBe(false)
    expect(dev('lixo')).toBe(false)
  })

  it('concede vídeo ao app, nega microfone e qualquer outra permissão, e registra a negação', () => {
    let request: (...a: unknown[]) => void = () => {}
    let check: (...a: unknown[]) => boolean = () => false
    const fakeSession = {
      setPermissionRequestHandler: (h: typeof request) => (request = h),
      setPermissionCheckHandler: (h: typeof check) => (check = h)
    }
    const logger = memoryLogger()
    installPermissionPolicy(fakeSession as never, createTrustedOrigin(undefined), logger)

    const ask = (
      permission: string,
      mediaTypes: string[],
      url = 'file:///app/index.html'
    ): boolean => {
      let result = false
      request({}, permission, (granted: boolean) => (result = granted), {
        requestingUrl: url,
        mediaTypes
      })
      return result
    }
    expect(ask('media', ['video'])).toBe(true)
    expect(ask('media', ['audio'])).toBe(false)
    expect(ask('media', ['video', 'audio'])).toBe(false)
    expect(ask('media', ['video'], 'https://evil.example/')).toBe(false)
    expect(ask('fullscreen', [])).toBe(true) // requestFullscreen() do player
    expect(ask('fullscreen', [], 'https://evil.example/')).toBe(false)
    expect(ask('geolocation', [])).toBe(false)
    expect(ask('notifications', [])).toBe(false)
    expect(logger.entries.filter((e) => e.level === 'WARN')).toHaveLength(6)

    expect(check({}, 'media', 'file:///', { mediaType: 'video' })).toBe(true)
    expect(check({}, 'media', 'file:///', { mediaType: 'unknown' })).toBe(true)
    expect(check({}, 'media', 'file:///', { mediaType: 'audio' })).toBe(false)
    expect(check({}, 'media', 'https://evil.example', { mediaType: 'video' })).toBe(false)
    expect(check({}, 'fullscreen', 'file:///', {})).toBe(true)
    expect(check({}, 'clipboard-read', 'file:///', {})).toBe(false)
  })
})
