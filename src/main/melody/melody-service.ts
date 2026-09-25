import { readFile, stat } from 'node:fs/promises'
import type { MelodyInfo, MelodyTrackInfo } from '@shared/types'
import type { SongRepository } from '../db/song-repository'
import { listZip, readZipEntry } from '../library/zip-reader'
import type { Logger } from '../logger'
import { analyzeTracks, pickMelodyTrack, toMonophonic } from './melody-select'
import { MAX_MIDI_BYTES, MidiFormatError, parseMidi, type ParsedMidi } from './midi-parser'

/** Erro com mensagem própria para o usuário (o app cai para a avaliação básica). */
export class MelodyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MelodyError'
  }
}

interface CacheEntry {
  key: string
  parsed: ParsedMidi
}

/**
 * Lê e interpreta o MIDI/KAR ao lado da música (ou dentro do ZIP) e escolhe a trilha da
 * melodia. A escolha automática pode ser trocada pelo usuário e fica guardada no banco.
 */
export class MelodyService {
  private readonly cache: CacheEntry[] = []

  constructor(
    private readonly repo: SongRepository,
    private readonly logger: Logger
  ) {}

  async get(songId: number): Promise<MelodyInfo | null> {
    const location = this.repo.getMelodyLocation(songId)
    if (!location) return null
    const fileName = location.melodyEntry || location.melodyPath
    const label = fileName.split(/[\\/]/).pop() ?? fileName

    let parsed: ParsedMidi
    try {
      parsed = await this.load(location)
    } catch (error) {
      const reason = error instanceof MidiFormatError ? error.message : (error as Error).message
      this.logger.warn('Melodia de referência inválida ou ilegível', { songId, file: label, error })
      throw new MelodyError(`Não foi possível ler a melodia (${label}): ${reason}`)
    }

    const candidates = analyzeTracks(parsed)
    const suggested = pickMelodyTrack(candidates)
    const chosen = this.repo.getMelodyChoice(songId)
    const chosenValid = chosen !== undefined && candidates.some((c) => c.index === chosen)
    const selected = chosenValid ? chosen : suggested
    const track = selected === null ? undefined : parsed.tracks.find((t) => t.index === selected)
    const notes = track ? toMonophonic(track.notes) : []

    const tracks: MelodyTrackInfo[] = candidates.map((c) => ({
      index: c.index,
      name: c.name,
      noteCount: c.noteCount,
      channels: c.channels,
      isDrums: c.isDrums,
      suggested: c.index === suggested
    }))
    const lyricCount = Math.max(0, ...parsed.tracks.map((t) => t.lyrics.length))
    return {
      songId,
      format: /\.kar$/i.test(fileName) ? 'kar' : 'midi',
      fileName: label,
      tracks,
      selectedTrack: selected,
      selectionIsManual: chosenValid,
      notes,
      lyricCount,
      durationSec: parsed.durationSec
    }
  }

  async setTrack(songId: number, trackIndex: unknown): Promise<MelodyInfo | null> {
    if (typeof trackIndex !== 'number' || !Number.isInteger(trackIndex) || trackIndex < 0) {
      throw new MelodyError('Trilha inválida.')
    }
    const info = await this.get(songId)
    if (!info) throw new MelodyError('Esta música não tem melodia de referência.')
    if (!info.tracks.some((t) => t.index === trackIndex && !t.isDrums)) {
      throw new MelodyError('Essa trilha não pode ser usada como melodia.')
    }
    this.repo.setMelodyChoice(songId, trackIndex)
    this.logger.info('Trilha da melodia escolhida', { songId, trackIndex })
    return this.get(songId)
  }

  private async load(
    location: NonNullable<ReturnType<SongRepository['getMelodyLocation']>>
  ): Promise<ParsedMidi> {
    if (location.source === 'zip') {
      const entries = await listZip(location.zipPath)
      const entry = entries.find((e) => e.name === location.melodyEntry)
      if (!entry) throw new MelodyError('a entrada do MIDI/KAR não existe mais no ZIP.')
      const info = await stat(location.zipPath)
      const key = `${location.zipPath}|${info.mtimeMs}|${info.size}|${entry.name}`
      return this.cached(key, async () => parseMidi(await readZipEntry(location.zipPath, entry)))
    }
    const info = await stat(location.melodyPath)
    if (!info.isFile()) throw new MelodyError('o arquivo de melodia não existe mais.')
    if (info.size > MAX_MIDI_BYTES) throw new MelodyError('arquivo de melodia grande demais.')
    const key = `${location.melodyPath}|${info.mtimeMs}|${info.size}`
    return this.cached(key, async () =>
      parseMidi(new Uint8Array(await readFile(location.melodyPath)))
    )
  }

  private async cached(key: string, produce: () => Promise<ParsedMidi>): Promise<ParsedMidi> {
    const hit = this.cache.findIndex((c) => c.key === key)
    if (hit >= 0) {
      const [entry] = this.cache.splice(hit, 1)
      this.cache.push(entry!)
      return entry!.parsed
    }
    const parsed = await produce()
    this.cache.push({ key, parsed })
    if (this.cache.length > 8) this.cache.shift()
    return parsed
  }
}
