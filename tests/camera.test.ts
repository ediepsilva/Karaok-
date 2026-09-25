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
import { MicGate } from '../src/main/mic-gate'
import { isAudioOnly } from '../src/main/permissions'
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
    installPermissionPolicy(
      fakeSession as never,
      createTrustedOrigin(undefined),
      logger,
      new MicGate()
    )

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

describe('trava do microfone (acesso restrito)', () => {
  function setup(now = { t: 0 }) {
    let request: (...a: unknown[]) => void = () => {}
    let check: (...a: unknown[]) => boolean = () => false
    const fakeSession = {
      setPermissionRequestHandler: (h: typeof request) => (request = h),
      setPermissionCheckHandler: (h: typeof check) => (check = h)
    }
    const gate = new MicGate(() => now.t, 8000)
    const logger = memoryLogger()
    installPermissionPolicy(fakeSession as never, createTrustedOrigin(undefined), logger, gate)
    const ask = (mediaTypes: string[], url = 'file:///app/index.html'): boolean => {
      let result = false
      request({}, 'media', (g: boolean) => (result = g), { requestingUrl: url, mediaTypes })
      return result
    }
    return { gate, logger, ask, check, now }
  }

  it('reconhece pedidos só de áudio (nunca áudio + vídeo)', () => {
    expect(isAudioOnly(['audio'])).toBe(true)
    expect(isAudioOnly(['audio', 'video'])).toBe(false)
    expect(isAudioOnly(['video'])).toBe(false)
    expect(isAudioOnly([])).toBe(false)
    expect(isAudioOnly(undefined)).toBe(false)
  })

  it('sem armar a trava, o microfone é negado (e a negação é registrada)', () => {
    const { ask, logger } = setup()
    expect(ask(['audio'])).toBe(false)
    expect(logger.entries.some((e) => e.level === 'WARN' && e.message === 'Permissão negada')).toBe(
      true
    )
  })

  it('armada, concede UM pedido de áudio; o seguinte exige nova armação', () => {
    const { ask, gate, logger } = setup()
    gate.arm()
    expect(ask(['audio'])).toBe(true)
    expect(ask(['audio'])).toBe(false)
    gate.arm()
    expect(ask(['audio'])).toBe(true)
    expect(
      logger.entries.filter((e) => e.message.startsWith('Permissão de microfone concedida'))
    ).toHaveLength(2)
  })

  it('a armação expira depois de alguns segundos', () => {
    const { ask, gate, now } = setup()
    gate.arm()
    now.t = 7999
    expect(gate.armed).toBe(true)
    now.t = 8001
    expect(gate.armed).toBe(false)
    expect(ask(['audio'])).toBe(false)
  })

  it('armada, ainda nega áudio+vídeo, origem externa e outras permissões', () => {
    const { ask, gate } = setup()
    gate.arm()
    expect(ask(['audio', 'video'])).toBe(false)
    expect(ask(['audio'], 'https://evil.example/')).toBe(false)
    expect(gate.armed).toBe(true) // negações não gastam a armação
    expect(ask(['audio'])).toBe(true)
  })

  it('a câmera continua liberada sem a trava e não consome a armação do microfone', () => {
    const { ask, gate } = setup()
    gate.arm()
    expect(ask(['video'])).toBe(true)
    expect(gate.armed).toBe(true)
  })

  it('consulta de dispositivos de áudio só enquanto armada ou capturando', () => {
    const { check, gate } = setup()
    const audioCheck = (): boolean => check({}, 'media', 'file:///', { mediaType: 'audio' })
    expect(audioCheck()).toBe(false)
    gate.arm()
    expect(audioCheck()).toBe(true)
    gate.consumeArm()
    expect(audioCheck()).toBe(false)
    gate.setActive(true)
    expect(audioCheck()).toBe(true)
    gate.setActive(false)
    expect(audioCheck()).toBe(false)
  })

  it('a trava lembra se o microfone está ativo', () => {
    const gate = new MicGate()
    expect(gate.isActive).toBe(false)
    gate.setActive(true)
    expect(gate.isActive).toBe(true)
  })
})
