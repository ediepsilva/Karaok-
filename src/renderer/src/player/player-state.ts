export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'error'

export interface PlayerState {
  status: PlayerStatus
  songId: number | null
  /** Segundos; espelha o relógio do áudio (referência da sincronização). */
  currentTime: number
  duration: number
  volume: number
  error: string | null
  cdgError: string | null
}

export type PlayerAction =
  | { type: 'load'; songId: number; duration: number }
  | { type: 'playing' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'ended' }
  | { type: 'time'; time: number }
  | { type: 'duration'; duration: number }
  | { type: 'fail'; message: string }
  | { type: 'cdg-fail'; message: string }
  | { type: 'volume'; volume: number }

export const clampVolume = (v: number): number =>
  Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1

export function initialPlayerState(volume = 1): PlayerState {
  return {
    status: 'idle',
    songId: null,
    currentTime: 0,
    duration: 0,
    volume: clampVolume(volume),
    error: null,
    cdgError: null
  }
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'load':
      return {
        ...state,
        status: 'loading',
        songId: action.songId,
        currentTime: 0,
        duration: action.duration,
        error: null,
        cdgError: null
      }
    case 'playing':
      return state.songId === null || state.status === 'error'
        ? state
        : { ...state, status: 'playing' }
    case 'pause':
      return state.status === 'playing' ? { ...state, status: 'paused' } : state
    case 'stop':
      return state.songId === null || state.status === 'error'
        ? state
        : { ...state, status: 'stopped', currentTime: 0 }
    case 'ended':
      return state.songId === null ? state : { ...state, status: 'stopped', currentTime: 0 }
    case 'time':
      return state.status === 'playing' || state.status === 'paused'
        ? { ...state, currentTime: Math.max(0, action.time) }
        : state
    case 'duration':
      return Number.isFinite(action.duration) && action.duration > 0
        ? { ...state, duration: action.duration }
        : state
    case 'fail':
      return { ...state, status: 'error', error: action.message }
    case 'cdg-fail':
      return { ...state, cdgError: action.message }
    case 'volume':
      return { ...state, volume: clampVolume(action.volume) }
  }
}
