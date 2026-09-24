import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'

window.addEventListener('error', (e) =>
  window.api.log('ERROR', 'Erro não tratado (renderer)', { message: e.message, source: e.filename })
)
window.addEventListener('unhandledrejection', (e) =>
  window.api.log('ERROR', 'Promise rejeitada (renderer)', { reason: String(e.reason) })
)

const root = document.getElementById('root')
if (!root) throw new Error('Elemento #root não encontrado')
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
