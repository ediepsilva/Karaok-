import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import type { SongLocation } from '../db/song-repository'
import { listZip, readZipEntry, ZipFormatError } from './zip-reader'

export type MediaKind = 'mp3' | 'cdg'

/** Uma mídia servível por intervalo de bytes (arquivo em disco ou entrada de ZIP em memória). */
export interface MediaSource {
  size: number
  read(start: number, end: number): Readable | Buffer
}

/** Cache LRU de entradas de ZIP já descompactadas (o <audio> pede vários intervalos). */
export class ZipEntryCache {
  private readonly entries = new Map<string, Buffer>()

  constructor(private readonly maxEntries = 4) {}

  async get(zipPath: string, entryName: string): Promise<Buffer> {
    const info = await stat(zipPath)
    const key = `${zipPath}|${info.mtimeMs}|${info.size}|${entryName}`
    const hit = this.entries.get(key)
    if (hit) {
      this.entries.delete(key)
      this.entries.set(key, hit) // marca como usado recentemente
      return hit
    }
    const zipEntry = (await listZip(zipPath)).find((e) => e.name === entryName)
    if (!zipEntry) throw new ZipFormatError('Entrada não encontrada no ZIP.')
    const data = await readZipEntry(zipPath, zipEntry)
    this.entries.set(key, data)
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string
      this.entries.delete(oldest)
    }
    return data
  }
}

export async function openMedia(
  location: SongLocation,
  kind: MediaKind,
  cache: ZipEntryCache
): Promise<MediaSource> {
  const path = kind === 'mp3' ? location.mp3Path : location.cdgPath
  if (location.source === 'zip') {
    const entry = kind === 'mp3' ? location.zipMp3Entry : location.zipCdgEntry
    const data = await cache.get(path, entry)
    return { size: data.length, read: (start, end) => data.subarray(start, end + 1) }
  }
  const info = await stat(path)
  if (!info.isFile()) throw new Error('não é arquivo')
  return { size: info.size, read: (start, end) => createReadStream(path, { start, end }) }
}

/** Confere se a música ainda pode ser aberta (arquivos existem; no ZIP, a entrada também). */
export async function isMediaAvailable(location: SongLocation): Promise<boolean> {
  try {
    if (location.source === 'zip') {
      if (!(await stat(location.mp3Path)).isFile()) return false
      const names = new Set((await listZip(location.mp3Path)).map((e) => e.name))
      return names.has(location.zipMp3Entry) && names.has(location.zipCdgEntry)
    }
    const [mp3, cdg] = await Promise.all([stat(location.mp3Path), stat(location.cdgPath)])
    return mp3.isFile() && cdg.isFile()
  } catch {
    return false
  }
}
