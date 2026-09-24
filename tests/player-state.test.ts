import { describe, expect, it } from 'vitest'
import {
  clampVolume,
  initialPlayerState,
  playerReducer,
  type PlayerAction,
  type PlayerState
} from '../src/renderer/src/player/player-state'

const apply = (actions: PlayerAction[], from: PlayerState = initialPlayerState()): PlayerState =>
  actions.reduce(playerReducer, from)

describe('playerReducer', () => {
  it('começa ocioso e ignora comandos sem música', () => {
    expect(initialPlayerState().status).toBe('idle')
    expect(apply([{ type: 'playing' }]).status).toBe('idle')
    expect(apply([{ type: 'stop' }]).status).toBe('idle')
    expect(apply([{ type: 'pause' }]).status).toBe('idle')
  })

  it('load → loading → playing → paused → playing → stopped', () => {
    let s = apply([{ type: 'load', songId: 1, duration: 100 }])
    expect(s).toMatchObject({ status: 'loading', songId: 1, duration: 100 })
    s = apply([{ type: 'playing' }], s)
    expect(s.status).toBe('playing')
    s = apply([{ type: 'time', time: 12.5 }, { type: 'pause' }], s)
    expect(s).toMatchObject({ status: 'paused', currentTime: 12.5 })
    s = apply([{ type: 'playing' }], s)
    expect(s.status).toBe('playing')
    s = apply([{ type: 'stop' }], s)
    expect(s).toMatchObject({ status: 'stopped', currentTime: 0 })
  })

  it('pause só vale enquanto toca', () => {
    const s = apply([{ type: 'load', songId: 1, duration: 10 }, { type: 'pause' }])
    expect(s.status).toBe('loading')
  })

  it('carregar outra música zera tempo e erros', () => {
    let s = apply([
      { type: 'load', songId: 1, duration: 10 },
      { type: 'cdg-fail', message: 'x' },
      { type: 'playing' },
      { type: 'time', time: 5 }
    ])
    s = apply([{ type: 'load', songId: 2, duration: 20 }], s)
    expect(s).toMatchObject({
      songId: 2,
      currentTime: 0,
      duration: 20,
      cdgError: null,
      error: null
    })
  })

  it('fim da música volta a stopped no tempo zero', () => {
    const s = apply([
      { type: 'load', songId: 1, duration: 10 },
      { type: 'playing' },
      { type: 'time', time: 9.9 },
      { type: 'ended' }
    ])
    expect(s).toMatchObject({ status: 'stopped', currentTime: 0 })
  })

  it('erro de reprodução coloca em error e bloqueia playing/stop', () => {
    let s = apply([
      { type: 'load', songId: 1, duration: 10 },
      { type: 'fail', message: 'falhou' }
    ])
    expect(s).toMatchObject({ status: 'error', error: 'falhou' })
    s = apply([{ type: 'playing' }, { type: 'stop' }], s)
    expect(s.status).toBe('error')
  })

  it('falha de CDG não interrompe o áudio', () => {
    const s = apply([
      { type: 'load', songId: 1, duration: 10 },
      { type: 'playing' },
      { type: 'cdg-fail', message: 'sem gráficos' }
    ])
    expect(s).toMatchObject({ status: 'playing', cdgError: 'sem gráficos' })
  })

  it('duração inválida é ignorada', () => {
    const s = apply([
      { type: 'load', songId: 1, duration: 60 },
      { type: 'duration', duration: Infinity },
      { type: 'duration', duration: NaN }
    ])
    expect(s.duration).toBe(60)
    expect(apply([{ type: 'duration', duration: 75 }], s).duration).toBe(75)
  })

  it('volume é limitado entre 0 e 1', () => {
    expect(apply([{ type: 'volume', volume: 2 }]).volume).toBe(1)
    expect(apply([{ type: 'volume', volume: -1 }]).volume).toBe(0)
    expect(clampVolume(NaN)).toBe(1)
    expect(apply([{ type: 'volume', volume: 0.4 }]).volume).toBe(0.4)
  })
})
