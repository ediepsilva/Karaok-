import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  failed: boolean
}

/** Evita tela em branco: registra o erro e oferece recarregar a interface. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    window.api.log('ERROR', 'Falha na interface', {
      message: error.message,
      componentStack: info.componentStack
    })
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="fatal" role="alert">
        <h2>Algo deu errado na interface.</h2>
        <p>O erro foi registrado no log.</p>
        <button className="btn primary" onClick={() => window.location.reload()}>
          Recarregar
        </button>
      </div>
    )
  }
}
