import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFileLogger, formatLine } from '../src/main/logger'
import { makeTempDir } from './helpers'

describe('logger', () => {
  it('formata data, hora, nível, mensagem e contexto', () => {
    const line = formatLine(new Date('2026-01-02T03:04:05.006Z'), 'WARN', 'olá', { a: 1 })
    expect(line).toBe('2026-01-02T03:04:05.006Z [WARN] olá {"a":1}')
  })

  it('serializa Error com nome, mensagem e stack', () => {
    const line = formatLine(new Date(0), 'ERROR', 'falha', { error: new Error('boom') })
    expect(line).toContain('"message":"boom"')
    expect(line).toContain('"name":"Error"')
  })

  it('não quebra com contexto circular', () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    expect(() => formatLine(new Date(0), 'INFO', 'x', circular)).not.toThrow()
  })

  it('cria arquivo de log diário na pasta e acrescenta linhas', () => {
    const dir = join(makeTempDir(), 'logs')
    const logger = createFileLogger(dir, false)
    logger.info('primeira')
    logger.error('segunda', { code: 7 })
    const files = readdirSync(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^karaoke-\d{4}-\d{2}-\d{2}\.log$/)
    const lines = readFileSync(join(dir, files[0] as string), 'utf8')
      .trim()
      .split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/\[INFO\] primeira$/)
    expect(lines[1]).toMatch(/\[ERROR\] segunda \{"code":7\}$/)
  })

  it('mensagens multilinha ficam em uma única linha', () => {
    expect(formatLine(new Date(0), 'INFO', 'a\nb')).not.toContain('\n')
  })
})
