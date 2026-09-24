import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Logger } from '../logger'
import { migrations, type Migration } from './migrations'

export class DatabaseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DatabaseError'
  }
}

export function currentVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return row.user_version
}

/** Aplica migrações pendentes, cada uma em transação. Devolve a versão final. */
export function migrate(db: DatabaseSync, list: Migration[] = migrations): number {
  let version = currentVersion(db)
  for (const migration of [...list].sort((a, b) => a.version - b.version)) {
    if (migration.version <= version) continue
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.exec(`PRAGMA user_version = ${migration.version}`)
      db.exec('COMMIT')
      version = migration.version
    } catch (error) {
      db.exec('ROLLBACK')
      throw new DatabaseError(`Falha na migração ${migration.version} (${migration.name})`, {
        cause: error
      })
    }
  }
  return version
}

function openAndMigrate(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    // Força a leitura do cabeçalho: falha aqui se o arquivo não for um SQLite válido.
    const check = db.prepare('PRAGMA quick_check').get() as { quick_check: string }
    if (check.quick_check !== 'ok') throw new Error(`quick_check: ${check.quick_check}`)
    migrate(db)
    return db
  } catch (error) {
    try {
      db.close()
    } catch {
      /* já fechado */
    }
    throw error
  }
}

/**
 * Abre (ou cria) o banco. Se o arquivo estiver corrompido, ele é movido para
 * `*.corrupt-<data>` e um banco novo é criado — a biblioteca pode ser reimportada.
 */
export function openDatabase(path: string, logger: Logger): DatabaseSync {
  try {
    mkdirSync(dirname(path), { recursive: true })
  } catch (error) {
    logger.error('Falha ao criar pasta do banco', { path, error })
    throw new DatabaseError('Não foi possível criar a pasta do banco de dados.', { cause: error })
  }

  try {
    const db = openAndMigrate(path)
    logger.info('Banco de dados aberto', { path, version: currentVersion(db) })
    return db
  } catch (firstError) {
    logger.error('Banco de dados inacessível ou corrompido', { path, error: firstError })
    if (!existsSync(path)) {
      throw new DatabaseError('Não foi possível abrir o banco de dados.', { cause: firstError })
    }
    const backup = `${path}.corrupt-${Date.now()}`
    try {
      renameSync(path, backup)
      for (const suffix of ['-wal', '-shm']) {
        if (existsSync(path + suffix)) renameSync(path + suffix, backup + suffix)
      }
      logger.warn('Banco corrompido movido para backup; criando banco novo', { backup })
      const db = openAndMigrate(path)
      logger.info('Novo banco de dados criado', { path, version: currentVersion(db) })
      return db
    } catch (secondError) {
      logger.error('Falha ao recuperar o banco de dados', { path, error: secondError })
      throw new DatabaseError('Não foi possível abrir nem recriar o banco de dados.', {
        cause: secondError
      })
    }
  }
}
