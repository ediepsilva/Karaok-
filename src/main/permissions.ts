import type { Session } from 'electron'
import type { Logger } from './logger'

/**
 * Política de permissões do Chromium para o app. Por padrão o Electron concede tudo; aqui só o
 * que o produto usa é liberado, e apenas para páginas do próprio app: captura de **vídeo** (câmera
 * do cantor) e **tela cheia** (no Electron, requestFullscreen() também passa por este handler). Áudio/microfone, geolocalização, notificações etc. seguem negados (o microfone só
 * será liberado quando a avaliação vocal existir).
 */

/** Permissões (além de mídia) que o app usa e que podem ser concedidas a páginas confiáveis. */
const ALLOWED_SIMPLE_PERMISSIONS: ReadonlySet<string> = new Set(['fullscreen'])

/** Uma requisição de mídia é aceitável se pede somente vídeo. */
export function allowMediaTypes(mediaTypes: readonly string[] | undefined): boolean {
  return !!mediaTypes && mediaTypes.length > 0 && mediaTypes.every((type) => type === 'video')
}

/** Páginas do próprio app: arquivos locais empacotados ou o servidor de desenvolvimento. */
export function createTrustedOrigin(devUrl: string | undefined): (url: string) => boolean {
  const devOrigin = devUrl ? new URL(devUrl).origin : null
  return (url) => {
    if (url.startsWith('file://')) return true
    if (!devOrigin) return false
    try {
      return new URL(url).origin === devOrigin
    } catch {
      return false
    }
  }
}

export function installPermissionPolicy(
  session: Session,
  isTrusted: (url: string) => boolean,
  logger: Logger
): void {
  session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes
    const trusted = isTrusted(details.requestingUrl)
    const granted =
      trusted &&
      (ALLOWED_SIMPLE_PERMISSIONS.has(permission) ||
        (permission === 'media' && allowMediaTypes(mediaTypes)))
    if (!granted) {
      logger.warn('Permissão negada', { permission, mediaTypes, url: details.requestingUrl })
    }
    callback(granted)
  })

  // Consultas (ex.: enumerateDevices só mostra nomes das câmeras se houver permissão de vídeo).
  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    if (!isTrusted(requestingOrigin)) return false
    if (ALLOWED_SIMPLE_PERMISSIONS.has(permission)) return true
    if (permission !== 'media') return false
    const mediaType = (details as { mediaType?: string }).mediaType
    return mediaType === 'video' || mediaType === 'unknown'
  })
}
