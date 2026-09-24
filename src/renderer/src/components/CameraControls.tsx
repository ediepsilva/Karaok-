import type { CameraController } from '../camera/useCamera'

interface Props {
  camera: CameraController
}

export function CameraControls({ camera }: Props): React.JSX.Element {
  const { state } = camera
  const on = state.status === 'on'
  const starting = state.status === 'starting'
  const activeId = state.activeDeviceId ?? state.prefs.deviceId
  const selected = state.devices.some((d) => d.id === activeId) ? activeId : ''

  return (
    <div className="camera-bar" aria-label="Câmera do cantor">
      <button
        className={`btn${on ? ' primary' : ''}`}
        onClick={camera.toggle}
        aria-pressed={on}
        data-testid="btn-camera"
      >
        {starting ? '📷 Ligando…' : on ? '📷 Desligar câmera' : '📷 Ligar câmera'}
      </button>
      <select
        className="select"
        aria-label="Escolher câmera"
        data-testid="camera-device"
        value={selected}
        disabled={state.devices.length === 0}
        onChange={(e) => camera.selectDevice(e.target.value)}
      >
        {state.devices.length === 0 && <option value="">Nenhuma câmera</option>}
        {state.devices.length > 0 && selected === '' && <option value="">Câmera padrão</option>}
        {state.devices.map((device) => (
          <option key={device.id} value={device.id}>
            {device.label}
          </option>
        ))}
      </select>
      <select
        className="select"
        aria-label="Posição da câmera"
        data-testid="camera-layout"
        value={state.prefs.layout}
        onChange={(e) => camera.setLayout(e.target.value === 'side' ? 'side' : 'pip')}
      >
        <option value="pip">Sobre o canto</option>
        <option value="side">Ao lado do CDG</option>
      </select>
      <label className="check">
        <input
          type="checkbox"
          data-testid="camera-mirror"
          checked={state.prefs.mirror}
          onChange={(e) => camera.setMirror(e.target.checked)}
        />
        Espelhar
      </label>
      <label className="check">
        <input
          type="checkbox"
          data-testid="camera-auto"
          checked={state.prefs.autoStart}
          onChange={(e) => camera.setAutoStart(e.target.checked)}
        />
        Ligar ao tocar
      </label>
      {state.error && (
        <div className="notice error camera-msg" role="alert" data-testid="camera-error">
          {state.error}
        </div>
      )}
      {state.notice && !state.error && (
        <div className="notice warn camera-msg" role="status" data-testid="camera-notice">
          {state.notice}
        </div>
      )}
    </div>
  )
}
