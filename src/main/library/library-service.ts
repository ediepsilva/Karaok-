import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type {
  ImportResult,
  LibraryFilter,
  LibraryFolder,
  RescanResult,
  Song,
  SongFileStatus,
  SongMetadata
} from '@shared/types'
import type { FolderRepository } from '../db/folder-repository'
import type { SongRepository } from '../db/song-repository'
import type { Logger } from '../logger'
import { parseSongName } from './filename'
import { isMediaAvailable } from './media-source'
import { scanFolder, type ScanResult } from './scanner'

export class LibraryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LibraryError'
  }
}

const MAX_FIELD_LENGTH = 200

/** Valida e normaliza os campos editáveis de uma música. */
export function sanitizeMetadata(input: unknown): SongMetadata {
  if (!input || typeof input !== 'object') throw new LibraryError('Dados da música inválidos.')
  const raw = input as Record<string, unknown>
  const field = (name: keyof SongMetadata): string => {
    const value = raw[name]
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string') throw new LibraryError('Dados da música inválidos.')
    const clean = value.replace(/\s+/g, ' ').trim()
    if (clean.length > MAX_FIELD_LENGTH) {
      throw new LibraryError(`O campo "${name}" é longo demais (máximo ${MAX_FIELD_LENGTH}).`)
    }
    return clean
  }
  const metadata: SongMetadata = {
    title: field('title'),
    artist: field('artist'),
    genre: field('genre'),
    language: field('language'),
    code: field('code')
  }
  if (!metadata.title) throw new LibraryError('O título não pode ficar vazio.')
  return metadata
}

export class LibraryService {
  constructor(
    private readonly repo: SongRepository,
    private readonly folders: FolderRepository,
    private readonly logger: Logger
  ) {}

  list(filter?: LibraryFilter): Song[] {
    const query = typeof filter?.query === 'string' ? filter.query : ''
    return this.repo.list({ query, favoritesOnly: filter?.favoritesOnly === true })
  }

  get(id: number): Song | null {
    return this.repo.getById(id) ?? null
  }

  listFolders(): LibraryFolder[] {
    return this.folders.list()
  }

  async importFolder(folder: string): Promise<ImportResult> {
    const root = await this.validateFolder(folder)
    this.logger.info('Importação iniciada', { folder: root })
    const scan = await scanFolder(root)
    const { added, duplicates } = this.store(scan)
    this.folders.touch(root)

    for (const issue of scan.issues) {
      this.logger.warn('Problema durante importação', { path: issue.path, reason: issue.reason })
    }
    for (const path of scan.mp3WithoutCdg) this.logger.info('MP3 sem CDG ignorado', { path })
    for (const path of scan.cdgWithoutMp3) this.logger.info('CDG sem MP3 ignorado', { path })
    const foundInZip = scan.pairs.filter((p) => p.source === 'zip').length
    this.logger.info('Importação concluída', {
      folder: root,
      found: scan.pairs.length,
      foundInZip,
      added,
      duplicates,
      mp3WithoutCdg: scan.mp3WithoutCdg.length,
      cdgWithoutMp3: scan.cdgWithoutMp3.length,
      issues: scan.issues.length
    })

    return {
      folder: root,
      found: scan.pairs.length,
      foundInZip,
      added,
      duplicates,
      mp3WithoutCdg: scan.mp3WithoutCdg.length,
      cdgWithoutMp3: scan.cdgWithoutMp3.length,
      issues: scan.issues
    }
  }

  /** Reescaneia todas as pastas já importadas, trazendo músicas novas. */
  async rescan(): Promise<RescanResult> {
    const result: RescanResult = {
      folders: 0,
      found: 0,
      added: 0,
      duplicates: 0,
      unavailableFolders: []
    }
    for (const folder of this.folders.list()) {
      try {
        const scan = await scanFolder(await this.validateFolder(folder.path))
        const { added, duplicates } = this.store(scan)
        this.folders.touch(folder.path)
        result.folders++
        result.found += scan.pairs.length
        result.added += added
        result.duplicates += duplicates
      } catch (error) {
        this.logger.warn('Pasta da biblioteca indisponível no reescaneamento', {
          folder: folder.path,
          error
        })
        result.unavailableFolders.push(folder.path)
      }
    }
    this.logger.info('Reescaneamento concluído', { ...result })
    return result
  }

  /** Remove do catálogo as músicas cujos arquivos não existem mais. */
  async removeMissing(): Promise<number> {
    const missing: number[] = []
    for (const { id, location } of this.repo.listLocations()) {
      if (!(await isMediaAvailable(location))) missing.push(id)
    }
    const removed = this.repo.deleteMany(missing)
    this.logger.info('Músicas indisponíveis removidas do catálogo', { removed })
    return removed
  }

  updateMetadata(id: number, input: unknown): Song {
    const metadata = sanitizeMetadata(input)
    const song = this.repo.updateMetadata(id, metadata)
    if (!song) throw new LibraryError('Música não encontrada na biblioteca.')
    this.logger.info('Metadados editados', { id })
    return song
  }

  setFavorite(id: number, favorite: boolean): Song {
    const song = this.repo.setFavorite(id, favorite === true)
    if (!song) throw new LibraryError('Música não encontrada na biblioteca.')
    return song
  }

  /** Confirma se os arquivos da música ainda existem (pasta removida, disco desconectado…). */
  async checkFiles(id: number): Promise<SongFileStatus> {
    const location = this.repo.getLocation(id)
    if (!location) return { ok: false, message: 'Música não encontrada na biblioteca.' }
    if (!(await isMediaAvailable(location))) {
      this.logger.warn('Arquivo da música não está mais disponível', {
        id,
        path: location.mp3Path
      })
      return { ok: false, message: 'Os arquivos desta música não estão mais disponíveis.' }
    }
    return { ok: true }
  }

  private store(scan: ScanResult): { added: number; duplicates: number } {
    return this.repo.addMany(
      scan.pairs.map((pair) => {
        const { artist, title } = parseSongName(pair.baseName)
        return {
          title,
          artist,
          mp3Path: pair.mp3Path,
          cdgPath: pair.cdgPath,
          duration: pair.duration,
          source: pair.source,
          zipMp3Entry: pair.zipMp3Entry,
          zipCdgEntry: pair.zipCdgEntry
        }
      })
    )
  }

  private async validateFolder(folder: unknown): Promise<string> {
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
    return root
  }
}
