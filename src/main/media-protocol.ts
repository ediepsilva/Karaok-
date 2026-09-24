import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { MEDIA_SCHEME } from '@shared/types'
import type { SongRepository } from './db/song-repository'
import type { Logger } from './logger'
import { openMedia, ZipEntryCache, type MediaKind, type MediaSource } from './library/media-source'

/** Deve ser chamado antes de `app.whenReady()`. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true
      }
    }
  ])
}

export interface ByteRange {
  start: number
  end: number
}

/**
 * Interpreta `Range: bytes=a-b` (um único intervalo). Devolve `null` se não houver cabeçalho,
 * `'invalid'` se estiver fora do arquivo ou malformado.
 */
export function parseRange(header: string | null, size: number): ByteRange | null | 'invalid' {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) return 'invalid'
  let start: number
  let end: number
  if (match[1] === '') {
    const suffix = Number(match[2]) // "últimos N bytes"
    if (suffix === 0) return 'invalid'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  }
  if (start >= size || start > end) return 'invalid'
  return { start, end }
}

const CONTENT_TYPES = { mp3: 'audio/mpeg', cdg: 'application/octet-stream' } as const

/**
 * Serve `karaoke-media://song/<id>/mp3|cdg` com suporte a Range (necessário para seek no
 * `<audio>`). O renderer nunca informa caminhos: só o id de uma música cadastrada, o que impede a
 * leitura de arquivos arbitrários do disco. Músicas em ZIP são descompactadas em memória.
 */
export function handleMediaProtocol(repo: SongRepository, logger: Logger): void {
  const zipCache = new ZipEntryCache()

  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const match = /^\/(\d+)\/(mp3|cdg)$/.exec(url.pathname)
    if (url.hostname !== 'song' || !match) {
      return new Response('Requisição inválida', { status: 400 })
    }

    const id = Number(match[1])
    const location = repo.getLocation(id)
    if (!location) return new Response('Música não encontrada', { status: 404 })
    const kind = match[2] as MediaKind

    let media: MediaSource
    try {
      media = await openMedia(location, kind, zipCache)
    } catch (error) {
      logger.warn('Arquivo de mídia indisponível', { id, kind, error })
      return new Response('Arquivo indisponível', { status: 404 })
    }
    const size = media.size

    // O renderer roda em file://, origem distinta: o fetch do CDG exige cabeçalhos CORS.
    const headers: Record<string, string> = {
      'Content-Type': CONTENT_TYPES[kind],
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    }

    const range = parseRange(request.headers.get('range'), size)
    if (range === 'invalid') {
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${size}` }
      })
    }

    const { start, end } = range ?? { start: 0, end: size - 1 }
    const length = size === 0 ? 0 : end - start + 1
    headers['Content-Length'] = String(length)
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    const status = range ? 206 : 200

    if (request.method === 'HEAD' || length === 0) return new Response(null, { status, headers })

    const data = media.read(start, end)
    if (Buffer.isBuffer(data)) return new Response(new Uint8Array(data), { status, headers })
    data.on('error', (error) => logger.warn('Erro ao ler mídia', { id, kind, error }))
    return new Response(Readable.toWeb(data) as ReadableStream, { status, headers })
  })
}
