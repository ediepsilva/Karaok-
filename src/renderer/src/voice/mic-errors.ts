/** Traduz os erros de getUserMedia (áudio) em mensagens que o usuário consegue agir. */
export function describeMicError(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'Sem permissão para usar o microfone. Verifique em Configurações do Windows › Privacidade › Microfone se o acesso está liberado.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Nenhum microfone encontrado. Conecte um microfone e tente de novo.'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'Não foi possível abrir o microfone: ele pode estar em uso por outro programa.'
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'O microfone escolhido não está disponível.'
    default:
      return 'Não foi possível iniciar o microfone.'
  }
}

/** Erros em que vale tentar de novo com o microfone padrão. */
export function isMicDeviceUnavailable(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name
  return (
    name === 'OverconstrainedError' ||
    name === 'NotFoundError' ||
    name === 'ConstraintNotSatisfiedError'
  )
}

/** Nota musical aproximada para exibição: "A4 +12¢" / "C#3 −8¢" / "—". */
export function formatNote(note: string | null, cents: number | null): string {
  if (note === null || cents === null) return '—'
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : '±'
  return `${note} ${sign}${Math.abs(cents)}¢`
}
