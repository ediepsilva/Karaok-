import type { KaraokeApi } from '../shared/types'

declare global {
  interface Window {
    api: KaraokeApi
  }
}

export {}
