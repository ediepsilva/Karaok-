import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { ImportResult, Song, SongFileStatus } from '@shared/types'
import type { SongRepository } from '../db/song-repository'
import type { Logger } from '../logger'
import { parseSongName } from './filename'
import { scanFolder } from './scanner'

export class LibraryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LibraryError'
  }
}

export class LibraryService {
  constructor(
    private readonly repo: SongRepository,
    private readonly logger: Logger
  ) {}

  list(): Song[] {
    return this.repo.list()
  }

  search(query: string): Song[] {
    return this.repo.search(query)
  }

  async importFolder(folder: string): Promise<ImportResult> {
    if (typeof folder !== 'string' || !isAbsolute(folder)) {
      throw new LibraryError('Caminho de pasta inválido.')
    }
    const root = resolve(folder)
    try {
      if (!(await stat(root)).isDirectory()) throw new Error('não é uma pasta')
    } catch {
      this.logger.error('Pasta de importação indisponível', { folder: root })
      throw new LibraryError('A pasta selecionada não está disponível.')
    }

    this.logger.info('Importação iniciada', { folder: root })
    const scan = await scanFolder(root)
    const parsed = scan.pairs.map((pair) => {
      const { artist, title } = parseSongName(pair.baseName)
      return {
        title,
        artist,
        mp3Path: pair.mp3Path,
        cdgPath: pair.cdgPath,
        duration: pair.duration
      }
    })
    const { added, duplicates } = this.repo.addMany(parsed)

    for (const issue of scan.issues) {
      this.logger.warn('Problema durante importação', { path: issue.path, reason: issue.reason })
    }
    for (const path of scan.mp3WithoutCdg) this.logger.info('MP3 sem CDG ignorado', { path })
    for (const path of scan.cdgWithoutMp3) this.logger.info('CDG sem MP3 ignorado', { path })
    this.logger.info('Importação concluída', {
      folder: root,
      found: scan.pairs.length,
      added,
      duplicates,
      mp3WithoutCdg: scan.mp3WithoutCdg.length,
      cdgWithoutMp3: scan.cdgWithoutMp3.length,
      issues: scan.issues.length
    })

    return {
      folder: root,
      found: scan.pairs.length,
      added,
      duplicates,
      mp3WithoutCdg: scan.mp3WithoutCdg.length,
      cdgWithoutMp3: scan.cdgWithoutMp3.length,
      issues: scan.issues
    }
  }

  /** Confirma se os arquivos da música ainda existem (pasta removida, disco desconectado…). */
  async checkFiles(id: number): Promise<SongFileStatus> {
    const song = this.repo.getById(id)
    if (!song) return { ok: false, message: 'Música não encontrada na biblioteca.' }
    for (const path of [song.mp3Path, song.cdgPath]) {
      try {
        if (!(await stat(path)).isFile()) throw new Error('não é arquivo')
      } catch {
        this.logger.warn('Arquivo da música não está mais disponível', { id, path })
        return { ok: false, message: 'Os arquivos desta música não estão mais disponíveis.' }
      }
    }
    return { ok: true }
  }

  markPlayed(id: number): void {
    this.repo.markPlayed(id)
  }
}
