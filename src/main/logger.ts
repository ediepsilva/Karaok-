import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { LogLevel } from '@shared/types'

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void
  readonly dir: string
}

function serialize(context: Record<string, unknown> | undefined): string {
  if (!context) return ''
  try {
    return (
      ' ' +
      JSON.stringify(context, (_key, value: unknown) =>
        value instanceof Error
          ? { name: value.name, message: value.message, stack: value.stack }
          : value
      )
    )
  } catch {
    return ' {"context":"<não serializável>"}'
  }
}

/** Formata uma linha de log: `2026-01-01T12:00:00.000Z [INFO] mensagem {"contexto":1}`. */
export function formatLine(
  date: Date,
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): string {
  return `${date.toISOString()} [${level}] ${message.replace(/\r?\n/g, ' | ')}${serialize(context)}`
}

/** Logger em arquivo diário (um arquivo por dia). Nunca lança: falha de log não derruba o app. */
export function createFileLogger(dir: string, echoToConsole = true): Logger {
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* segue apenas com console */
  }

  const log = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
    const now = new Date()
    const line = formatLine(now, level, message, context)
    if (echoToConsole) {
      const out = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log
      out(line)
    }
    try {
      const day = now.toISOString().slice(0, 10)
      appendFileSync(join(dir, `karaoke-${day}.log`), line + '\n', 'utf8')
    } catch {
      /* ignora */
    }
  }

  return {
    dir,
    log,
    debug: (m, c) => log('DEBUG', m, c),
    info: (m, c) => log('INFO', m, c),
    warn: (m, c) => log('WARN', m, c),
    error: (m, c) => log('ERROR', m, c)
  }
}
