import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { currentVersion, migrate, openDatabase } from '../src/main/db/database'
import { migrations } from '../src/main/db/migrations'
import { SongRepository, type NewSong } from '../src/main/db/song-repository'
import { makeTempDir, memoryLogger } from './helpers'

const song = (
  title: string,
  artist: string,
  path = `C:\\musicas\\${artist} - ${title}.mp3`
): NewSong => ({
  title,
  artist,
  mp3Path: path,
  cdgPath: path.replace(/\.mp3$/, '.cdg'),
  duration: 120
})

function openTemp(): { db: DatabaseSync; path: string; repo: SongRepository } {
  const path = join(makeTempDir(), 'karaoke.db')
  const db = openDatabase(path, memoryLogger())
  return { db, path, repo: new SongRepository(db) }
}

describe('criação do banco e migrações', () => {
  it('cria o arquivo SQLite automaticamente com as tabelas songs e settings', () => {
    const { db, path } = openTemp()
    expect(existsSync(path)).toBe(true)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).toEqual(expect.arrayContaining(['songs', 'settings']))
    const columns = db
      .prepare('PRAGMA table_info(songs)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'title',
        'artist',
        'genre',
        'language',
        'mp3_path',
        'cdg_path',
        'duration',
        'date_added',
        'last_played',
        'play_count'
      ])
    )
    db.close()
  })

  it('cria índices de título, artista e caminhos', () => {
    const { db } = openTemp()
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'songs'")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_songs_mp3_path',
        'idx_songs_cdg_path',
        'idx_songs_title',
        'idx_songs_artist'
      ])
    )
    db.close()
  })

  it('migrate é idempotente e respeita user_version', () => {
    const { db } = openTemp()
    const latest = Math.max(...migrations.map((m) => m.version))
    expect(currentVersion(db)).toBe(latest)
    expect(migrate(db)).toBe(latest)
    db.close()
  })

  it('reverte migração com erro sem alterar a versão', () => {
    const db = new DatabaseSync(':memory:')
    expect(() =>
      migrate(db, [
        { version: 1, name: 'quebrada', sql: 'CREATE TABLE a (x); CREATE TABLE a (x);' }
      ])
    ).toThrow(/migração 1/)
    expect(currentVersion(db)).toBe(0)
    db.close()
  })
})

describe('SongRepository', () => {
  it('cadastra músicas e evita duplicados (inclusive com caixa diferente no caminho)', () => {
    const { db, repo } = openTemp()
    expect(repo.addMany([song('A', 'X'), song('B', 'Y')])).toEqual({ added: 2, duplicates: 0 })
    expect(repo.addMany([song('A', 'X'), song('C', 'Z')])).toEqual({ added: 1, duplicates: 1 })
    const upper = song('A', 'X')
    upper.mp3Path = upper.mp3Path.toUpperCase()
    expect(repo.addMany([upper])).toEqual({ added: 0, duplicates: 1 })
    expect(repo.count()).toBe(3)
    db.close()
  })

  it('busca por título, por artista, ignorando acentos e caixa', () => {
    const { db, repo } = openTemp()
    repo.addMany([
      song('Primeiros Erros', 'Capital Inicial'),
      song('Tempo Perdido', 'Legião Urbana'),
      song('Coração de Estudante', 'Milton Nascimento')
    ])
    expect(repo.search('primeiros').map((s) => s.title)).toEqual(['Primeiros Erros'])
    expect(repo.search('LEGIAO').map((s) => s.artist)).toEqual(['Legião Urbana'])
    expect(repo.search('coracao estudante')).toHaveLength(1)
    expect(repo.search('capital erros')).toHaveLength(1) // palavras em campos diferentes
    expect(repo.search('inexistente')).toHaveLength(0)
    expect(repo.search('   ')).toHaveLength(3)
    db.close()
  })

  it('trata % e _ da busca como texto literal', () => {
    const { db, repo } = openTemp()
    repo.addMany([song('100% Amor', 'A'), song('Outra', 'B')])
    expect(repo.search('%')).toHaveLength(1)
    expect(repo.search('_')).toHaveLength(0)
    db.close()
  })

  it('markPlayed incrementa contador e registra data', () => {
    const { db, repo } = openTemp()
    repo.addMany([song('A', 'X')])
    const id = repo.list()[0]?.id as number
    repo.markPlayed(id)
    repo.markPlayed(id)
    const updated = repo.getById(id)
    expect(updated?.playCount).toBe(2)
    expect(updated?.lastPlayed).not.toBeNull()
    db.close()
  })

  it('reverte o lote inteiro se uma inserção falhar', () => {
    const { db, repo } = openTemp()
    const bad = { ...song('B', 'Y'), title: undefined as unknown as string }
    expect(() => repo.addMany([song('A', 'X'), bad])).toThrow()
    expect(repo.count()).toBe(0)
    db.close()
  })
})

describe('persistência e recuperação', () => {
  it('mantém a biblioteca ao fechar e reabrir o banco', () => {
    const { db, path, repo } = openTemp()
    repo.addMany([song('A', 'X'), song('B', 'Y')])
    db.close()
    const reopened = openDatabase(path, memoryLogger())
    expect(new SongRepository(reopened).list().map((s) => s.title)).toEqual(['A', 'B'])
    reopened.close()
  })

  it('arquivo corrompido é movido para backup e um banco novo é criado', () => {
    const dir = makeTempDir()
    const path = join(dir, 'karaoke.db')
    writeFileSync(path, 'isto não é um banco SQLite, é lixo '.repeat(50))
    const logger = memoryLogger()
    const db = openDatabase(path, logger)
    expect(new SongRepository(db).count()).toBe(0)
    expect(readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true)
    expect(logger.entries.some((e) => e.level === 'ERROR')).toBe(true)
    expect(logger.entries.some((e) => e.level === 'WARN')).toBe(true)
    db.close()
  })

  it('falha com DatabaseError amigável quando o caminho é impossível', () => {
    const dir = makeTempDir()
    const blocker = join(dir, 'arquivo')
    writeFileSync(blocker, 'x')
    const logger = memoryLogger()
    expect(() => openDatabase(join(blocker, 'sub', 'karaoke.db'), logger)).toThrow(/banco de dados/)
    expect(logger.entries.some((e) => e.level === 'ERROR')).toBe(true)
  })
})
