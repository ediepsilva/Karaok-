import type { Session } from 'electron'
import type { Logger } from './logger'
import type { MicGate } from './mic-gate'

/**
 * Política de permissões do Chromium para o app. Por padrão o Electron concede tudo; aqui só o
 * que o produto usa é liberado, e apenas para páginas do próprio app:
 *  - captura de **vídeo** (câmera do cantor);
 *  - **tela cheia** (no Electron, requestFullscreen() também passa por este handler);
 *  - captura de **áudio** (microfone da avaliação vocal), SOMENTE se o app armou a MicGate
 *    imediatamente antes (uma armação vale para um pedido) e o pedido for só de áudio.
 * Geolocalização, notificações etc. seguem negados.
 */

/** Permissões (além de mídia) que o app usa e que podem ser concedidas a páginas confiáveis. */
const ALLOWED_SIMPLE_PERMISSIONS: ReadonlySet<string> = new Set(['fullscreen'])

/** Uma requisição de mídia é de câmera se pede somente vídeo. */
export function allowMediaTypes(mediaTypes: readonly string[] | undefined): boolean {
  return !!mediaTypes && mediaTypes.length > 0 && mediaTypes.every((type) => type === 'video')
}

/** Uma requisição de mídia é de microfone se pede somente áudio (nunca áudio + vídeo juntos). */
export function isAudioOnly(mediaTypes: readonly string[] | undefined): boolean {
  return !!mediaTypes && mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio')
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
  logger: Logger,
  micGate: MicGate
): void {
  session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes
    const trusted = isTrusted(details.requestingUrl)
    let granted = false
    if (trusted) {
      if (ALLOWED_SIMPLE_PERMISSIONS.has(permission)) granted = true
      else if (permission === 'media' && allowMediaTypes(mediaTypes)) granted = true
      else if (permission === 'media' && isAudioOnly(mediaTypes)) {
        granted = micGate.consumeArm()
        if (granted) logger.info('Permissão de microfone concedida (trava armada)')
      }
    }
    if (!granted) {
      logger.warn('Permissão negada', { permission, mediaTypes, url: details.requestingUrl })
    }
    callback(granted)
  })

  // Consultas (ex.: enumerateDevices só mostra os nomes se houver permissão para o tipo).
  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    if (!isTrusted(requestingOrigin)) return false
    if (ALLOWED_SIMPLE_PERMISSIONS.has(permission)) return true
    if (permission !== 'media') return false
    const mediaType = (details as { mediaType?: string }).mediaType
    if (mediaType === 'audio') return micGate.allowsAudioCheck()
    return mediaType === 'video' || mediaType === 'unknown'
  })
}
