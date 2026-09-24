import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { buildFixtureCdg } from '../scripts/lib/fixture-media'
import { buildZip } from '../scripts/lib/zip-builder'
import { currentVersion, migrate, openDatabase } from '../src/main/db/database'
import { FolderRepository } from '../src/main/db/folder-repository'
import { migrations } from '../src/main/db/migrations'
import { QueueRepository } from '../src/main/db/queue-repository'
import { SongRepository, type NewSong } from '../src/main/db/song-repository'
import { LibraryError, LibraryService } from '../src/main/library/library-service'
import { QueueService } from '../src/main/library/queue-service'
import { FAKE_MP3, makeTempDir, memoryLogger, writeSongPair } from './helpers'

function setup() {
  const logger = memoryLogger()
  const db = openDatabase(join(makeTempDir(), 'k.db'), logger)
  const songs = new SongRepository(db)
  return {
    db,
    logger,
    songs,
    library: new LibraryService(songs, new FolderRepository(db), logger),
    queue: new QueueService(new QueueRepository(db), songs, logger)
  }
}

const song = (title: string, artist = 'X'): NewSong => ({
  title,
  artist,
  mp3Path: `C:\\m\\${artist} - ${title}.mp3`,
  cdgPath: `C:\\m\\${artist} - ${title}.cdg`,
  duration: 100
})

describe('migração 1 → 2', () => {
  it('preserva as músicas existentes e cria as novas tabelas', () => {
    const db = new DatabaseSync(':memory:')
    migrate(
      db,
      migrations.filter((m) => m.version === 1)
    )
    db.exec(`INSERT INTO songs (title, artist, mp3_path, cdg_path, date_added, title_norm, artist_norm)
             VALUES ('Antiga', 'Artista', 'a.mp3', 'a.cdg', 'x', 'antiga', 'artista')`)
    expect(currentVersion(db)).toBe(1)
    expect(migrate(db)).toBe(2)
    const row = db.prepare('SELECT title, favorite, source, code FROM songs').get() as Record<
      string,
      unknown
    >
    expect(row).toMatchObject({ title: 'Antiga', favorite: 0, source: 'files', code: '' })
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).toEqual(expect.arrayContaining(['queue', 'history', 'library_folders']))
    db.close()
  })
})

describe('busca, favoritos e metadados', () => {
  it('busca também por gênero e código', () => {
    const { songs, library } = setup()
    songs.addMany([song('Alfa'), song('Beta')])
    const id = songs.list()[0]!.id
    library.updateMetadata(id, {
      title: 'Alfa',
      artist: 'X',
      genre: 'Sertanejo',
      language: 'pt',
      code: 'SC-0042'
    })
    expect(library.list({ query: 'sertanejo' }).map((s) => s.title)).toEqual(['Alfa'])
    expect(library.list({ query: 'sc-0042' }).map((s) => s.title)).toEqual(['Alfa'])
    expect(library.list({ query: 'sertanejo beta' })).toHaveLength(0)
  })

  it('favoritar, filtrar e desfavoritar', () => {
    const { songs, library } = setup()
    songs.addMany([song('A'), song('B')])
    const [a] = songs.list()
    expect(library.setFavorite(a!.id, true).favorite).toBe(true)
    expect(library.list({ favoritesOnly: true }).map((s) => s.title)).toEqual(['A'])
    expect(library.list({ favoritesOnly: true, query: 'b' })).toHaveLength(0)
    library.setFavorite(a!.id, false)
    expect(library.list({ favoritesOnly: true })).toHaveLength(0)
    expect(() => library.setFavorite(9999, true)).toThrow(LibraryError)
  })

  it('edita metadados, atualiza a busca e valida entradas', () => {
    const { songs, library } = setup()
    songs.addMany([song('Original', 'Antigo')])
    const id = songs.list()[0]!.id
    const updated = library.updateMetadata(id, {
      title: '  Novo   Título ',
      artist: 'Novo Artista',
      genre: 'Rock',
      language: 'Português',
      code: '123'
    })
    expect(updated).toMatchObject({ title: 'Novo Título', genre: 'Rock', code: '123' })
    expect(library.list({ query: 'novo titulo' })).toHaveLength(1)
    expect(library.list({ query: 'original' })).toHaveLength(0)
    expect(() =>
      library.updateMetadata(id, { title: '   ', artist: '', genre: '', language: '', code: '' })
    ).toThrow(/título/)
    expect(() =>
      library.updateMetadata(id, {
        title: 'x'.repeat(201),
        artist: '',
        genre: '',
        language: '',
        code: ''
      })
    ).toThrow(/longo/)
    expect(() => library.updateMetadata(id, null)).toThrow(LibraryError)
    expect(() => library.updateMetadata(id, { title: 5 })).toThrow(LibraryError)
    expect(() => library.updateMetadata(9999, { title: 'a' })).toThrow(/não encontrada/)
  })

  it('favorito e metadados editados sobrevivem a fechar e reabrir o banco', () => {
    const path = join(makeTempDir(), 'p.db')
    const logger = memoryLogger()
    let db = openDatabase(path, logger)
    const songs = new SongRepository(db)
    songs.addMany([song('Persistente')])
    const id = songs.list()[0]!.id
    songs.setFavorite(id, true)
    songs.updateMetadata(id, {
      title: 'Editada',
      artist: 'Z',
      genre: 'G',
      language: 'L',
      code: 'C1'
    })
    db.close()
    db = openDatabase(path, logger)
    expect(new SongRepository(db).getById(id)).toMatchObject({
      title: 'Editada',
      favorite: true,
      code: 'C1'
    })
    db.close()
  })
})

describe('importação de ZIP e manutenção', () => {
  it('importa ZIP como música, marca a origem e permite checar arquivos', async () => {
    const { library } = setup()
    const root = makeTempDir()
    writeFileSync(
      join(root, 'Cantor Zip - Canção Compactada.zip'),
      buildZip([
        { name: 'x.mp3', data: FAKE_MP3 },
        { name: 'x.cdg', data: buildFixtureCdg(5) }
      ])
    )
    const result = await library.importFolder(root)
    expect(result).toMatchObject({ found: 1, foundInZip: 1, added: 1 })
    const [zipped] = library.list()
    expect(zipped).toMatchObject({
      source: 'zip',
      title: 'Canção Compactada',
      artist: 'Cantor Zip',
      duration: 5
    })
    expect(await library.checkFiles(zipped!.id)).toEqual({ ok: true })
    expect((await library.importFolder(root)).duplicates).toBe(1)
  })

  it('reescaneia pastas importadas trazendo só as novas e reporta pastas sumidas', async () => {
    const { library } = setup()
    const a = makeTempDir()
    const b = makeTempDir()
    writeSongPair(a, 'A - Um')
    writeSongPair(b, 'B - Dois')
    await library.importFolder(a)
    await library.importFolder(b)
    writeSongPair(a, 'A - Novo')
    const { rmSync } = await import('node:fs')
    rmSync(b, { recursive: true, force: true })
    const result = await library.rescan()
    expect(result).toMatchObject({ folders: 1, added: 1, duplicates: 1, unavailableFolders: [b] })
    expect(library.listFolders()).toHaveLength(2)
    expect(library.list()).toHaveLength(3)
  })

  it('remove do catálogo só as músicas indisponíveis, preservando o histórico', async () => {
    const { library, queue } = setup()
    const keep = makeTempDir()
    const gone = makeTempDir()
    writeSongPair(keep, 'K - Fica')
    writeSongPair(gone, 'G - Some')
    await library.importFolder(keep)
    await library.importFolder(gone)
    const goneSong = library.list().find((s) => s.title === 'Some')!
    queue.markPlayed(goneSong.id, 'Ana')
    queue.add(goneSong.id, 'Ana')
    const { rmSync } = await import('node:fs')
    rmSync(gone, { recursive: true, force: true })
    expect(await library.removeMissing()).toBe(1)
    expect(library.list().map((s) => s.title)).toEqual(['Fica'])
    expect(queue.list()).toHaveLength(0) // fila cai em cascata
    expect(queue.history()).toMatchObject([{ title: 'Some', singer: 'Ana', songId: null }])
  })
})

describe('fila e histórico', () => {
  function withSongs(n = 3) {
    const ctx = setup()
    ctx.songs.addMany(Array.from({ length: n }, (_, i) => song(`Musica ${i + 1}`)))
    return { ...ctx, ids: ctx.songs.list().map((s) => s.id) }
  }

  it('adiciona em ordem, exige nome do cantor e música existente', () => {
    const { queue, ids } = withSongs()
    queue.add(ids[0]!, ' Ana  Maria ')
    queue.add(ids[1]!, 'Bruno')
    expect(queue.list().map((i) => [i.singer, i.title, i.status])).toEqual([
      ['Ana Maria', 'Musica 1', 'waiting'],
      ['Bruno', 'Musica 2', 'waiting']
    ])
    expect(() => queue.add(ids[0]!, '   ')).toThrow(/nome do cantor/)
    expect(() => queue.add(ids[0]!, 42)).toThrow(LibraryError)
    expect(() => queue.add(ids[0]!, 'x'.repeat(61))).toThrow(/longo/)
    expect(() => queue.add(9999, 'Ana')).toThrow(/não encontrada/)
  })

  it('permite a mesma música para cantores diferentes', () => {
    const { queue, ids } = withSongs(1)
    queue.add(ids[0]!, 'Ana')
    queue.add(ids[0]!, 'Bia')
    expect(queue.list()).toHaveLength(2)
  })

  it('reordena com mover para cima/baixo e ignora extremos', () => {
    const { queue, ids } = withSongs()
    const [a, b, c] = ids.map((id, i) => queue.add(id, `C${i}`))
    queue.move(c!.id, 'up')
    expect(queue.list().map((i) => i.singer)).toEqual(['C0', 'C2', 'C1'])
    queue.move(a!.id, 'up') // já é o primeiro
    queue.move(b!.id, 'down') // já é o último
    expect(queue.list().map((i) => i.singer)).toEqual(['C0', 'C2', 'C1'])
    queue.move(a!.id, 'down')
    expect(queue.list().map((i) => i.singer)).toEqual(['C2', 'C0', 'C1'])
    expect(() => queue.move(a!.id, 'left')).toThrow(/Direção/)
  })

  it('status: só um item toca por vez; concluído sai da fila', () => {
    const { queue, ids } = withSongs()
    const [a, b] = ids.slice(0, 2).map((id) => queue.add(id, 'Ana'))
    queue.setStatus(a!.id, 'playing')
    queue.setStatus(b!.id, 'playing')
    expect(queue.list().map((i) => i.status)).toEqual(['waiting', 'playing'])
    queue.setStatus(b!.id, 'done')
    expect(queue.list().map((i) => i.id)).toEqual([a!.id])
    expect(() => queue.setStatus(a!.id, 'voando')).toThrow(/Status/)
    expect(() => queue.setStatus(9999, 'done')).toThrow(/não encontrado/)
  })

  it('remover e limpar; posições novas não reaproveitam as antigas', () => {
    const { queue, ids } = withSongs()
    const a = queue.add(ids[0]!, 'A')
    queue.add(ids[1]!, 'B')
    queue.remove(a.id)
    const c = queue.add(ids[2]!, 'C')
    expect(queue.list().map((i) => i.singer)).toEqual(['B', 'C'])
    expect(c.position).toBeGreaterThan(queue.list()[0]!.position)
    queue.clear()
    expect(queue.list()).toEqual([])
  })

  it('a fila persiste ao reabrir; item "tocando" volta a aguardar', () => {
    const path = join(makeTempDir(), 'q.db')
    const logger = memoryLogger()
    let db = openDatabase(path, logger)
    let songs = new SongRepository(db)
    songs.addMany([song('P1'), song('P2')])
    let queue = new QueueService(new QueueRepository(db), songs, logger)
    const [i1, i2] = songs.list().map((s) => queue.add(s.id, 'Ana'))
    queue.setStatus(i1!.id, 'playing')
    db.close()
    db = openDatabase(path, logger)
    songs = new SongRepository(db)
    queue = new QueueService(new QueueRepository(db), songs, logger)
    expect(queue.list().map((i) => [i.id, i.status])).toEqual([
      [i1!.id, 'waiting'],
      [i2!.id, 'waiting']
    ])
    db.close()
  })

  it('histórico registra cantor, atualiza contador e vem do mais recente ao mais antigo', () => {
    const { queue, songs, ids } = withSongs(2)
    queue.markPlayed(ids[0]!, 'Ana')
    queue.markPlayed(ids[1]!, '')
    queue.markPlayed(ids[0]!, 'Bia')
    expect(queue.history().map((h) => [h.title, h.singer])).toEqual([
      ['Musica 1', 'Bia'],
      ['Musica 2', ''],
      ['Musica 1', 'Ana']
    ])
    expect(songs.getById(ids[0]!)?.playCount).toBe(2)
    expect(queue.history(1)).toHaveLength(1)
    queue.clearHistory()
    expect(queue.history()).toEqual([])
  })
})
