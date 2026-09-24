import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/database'
import { SongRepository } from '../src/main/db/song-repository'
import { LibraryError, LibraryService } from '../src/main/library/library-service'
import { FIXTURE_DIR, makeTempDir, memoryLogger, writeFile, writeSongPair } from './helpers'

function setup(): { service: LibraryService; logger: ReturnType<typeof memoryLogger> } {
  const logger = memoryLogger()
  const db = openDatabase(join(makeTempDir(), 'k.db'), logger)
  return { service: new LibraryService(new SongRepository(db), logger), logger }
}

describe('LibraryService', () => {
  it('importa o fixture, interpreta artista/título e registra em log', async () => {
    const { service, logger } = setup()
    const result = await service.importFolder(FIXTURE_DIR)
    expect(result).toMatchObject({
      found: 2,
      added: 2,
      duplicates: 0,
      mp3WithoutCdg: 1,
      cdgWithoutMp3: 1
    })
    const songs = service.list()
    expect(songs.map((s) => [s.artist, s.title])).toEqual([
      ['Artista Teste', 'Tom de Teste'],
      ['Outro Artista', 'Segunda Musica']
    ])
    expect(songs[0]?.duration).toBe(12)
    expect(logger.entries.some((e) => e.message === 'Importação concluída')).toBe(true)
    expect(logger.entries.filter((e) => e.message === 'MP3 sem CDG ignorado')).toHaveLength(1)
  })

  it('importar a mesma pasta duas vezes não duplica músicas', async () => {
    const { service } = setup()
    await service.importFolder(FIXTURE_DIR)
    const second = await service.importFolder(FIXTURE_DIR)
    expect(second).toMatchObject({ found: 2, added: 0, duplicates: 2 })
    expect(service.list()).toHaveLength(2)
  })

  it('mantém o nome do arquivo como título quando não há artista', async () => {
    const { service } = setup()
    const root = makeTempDir()
    writeSongPair(root, 'Musica Sem Artista')
    await service.importFolder(root)
    expect(service.list()[0]).toMatchObject({ title: 'Musica Sem Artista', artist: '' })
  })

  it('busca por título e por artista', async () => {
    const { service } = setup()
    await service.importFolder(FIXTURE_DIR)
    expect(service.search('tom de teste').map((s) => s.title)).toEqual(['Tom de Teste'])
    expect(service.search('outro artista').map((s) => s.title)).toEqual(['Segunda Musica'])
  })

  it('rejeita caminho relativo, inexistente ou que não é pasta', async () => {
    const { service } = setup()
    await expect(service.importFolder('relativo/pasta')).rejects.toBeInstanceOf(LibraryError)
    await expect(service.importFolder(join(makeTempDir(), 'nada'))).rejects.toThrow(
      /não está disponível/
    )
    const file = writeFile(join(makeTempDir(), 'arquivo.txt'))
    await expect(service.importFolder(file)).rejects.toBeInstanceOf(LibraryError)
  })

  it('checkFiles detecta arquivos removidos depois do cadastro', async () => {
    const { service, logger } = setup()
    const root = makeTempDir()
    writeSongPair(root, 'Artista - Sumiu')
    await service.importFolder(root)
    const id = service.list()[0]?.id as number
    expect(await service.checkFiles(id)).toEqual({ ok: true })
    rmSync(root, { recursive: true, force: true })
    const status = await service.checkFiles(id)
    expect(status).toEqual({
      ok: false,
      message: expect.stringContaining('não estão mais disponíveis')
    })
    expect(logger.entries.some((e) => e.level === 'WARN')).toBe(true)
    expect(await service.checkFiles(9999)).toMatchObject({ ok: false })
  })
})
