import { stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { MEDIA_SCHEME } from '@shared/types'
import type { SongRepository } from './db/song-repository'
import type { Logger } from './logger'

/** Deve ser chamado antes de `app.whenReady()`. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
    }
  ])
}

/**
 * Serve `karaoke-media://song/<id>/mp3|cdg`. O renderer nunca informa caminhos: só o id de uma
 * música cadastrada, o que impede a leitura de arquivos arbitrários do disco.
 */
export function handleMediaProtocol(repo: SongRepository, logger: Logger): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const match = /^\/(\d+)\/(mp3|cdg)$/.exec(url.pathname)
    if (url.hostname !== 'song' || !match)
      return new Response('Requisição inválida', { status: 400 })

    const song = repo.getById(Number(match[1]))
    if (!song) return new Response('Música não encontrada', { status: 404 })
    const path = match[2] === 'mp3' ? song.mp3Path : song.cdgPath

    try {
      if (!(await stat(path)).isFile()) throw new Error('não é arquivo')
    } catch {
      logger.warn('Arquivo de mídia indisponível', { id: song.id, path })
      return new Response('Arquivo indisponível', { status: 404 })
    }
    // net.fetch em file:// entende cabeçalhos Range (necessário para seek no <audio>).
    return net.fetch(pathToFileURL(path).toString(), {
      headers: request.headers,
      method: request.method
    })
  })
}
