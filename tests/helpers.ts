import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Logger } from '../src/main/logger'
import { buildFixtureCdg } from '../scripts/lib/fixture-media'

export const FIXTURE_DIR = join(process.cwd(), 'test-assets', 'mp3g')

export function makeTempDir(prefix = 'karaoke-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** Escreve um arquivo criando pastas intermediárias. */
export function writeFile(path: string, data: Buffer | string = 'x'): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
  return path
}

/** Cabeçalho mínimo de MP3 válido para o scanner (tag ID3 + preenchimento). */
export const FAKE_MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)])

export function writeSongPair(dir: string, baseName: string, seconds = 3): void {
  writeFile(join(dir, `${baseName}.mp3`), FAKE_MP3)
  writeFile(join(dir, `${baseName}.cdg`), buildFixtureCdg(seconds))
}

export interface MemoryLogger extends Logger {
  entries: { level: string; message: string; context?: Record<string, unknown> }[]
}

export function memoryLogger(): MemoryLogger {
  const entries: MemoryLogger['entries'] = []
  const log = (level: string, message: string, context?: Record<string, unknown>): void => {
    entries.push({ level, message, context })
  }
  return {
    dir: '',
    entries,
    log: (l, m, c) => log(l, m, c),
    debug: (m, c) => log('DEBUG', m, c),
    info: (m, c) => log('INFO', m, c),
    warn: (m, c) => log('WARN', m, c),
    error: (m, c) => log('ERROR', m, c)
  }
}
