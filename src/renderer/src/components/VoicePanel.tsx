import { basicComponents } from '../voice/basic-score'
import { formatNote } from '../voice/mic-errors'
import type { VoiceController } from '../voice/useVoice'
import { MANUAL_LATENCY_MAX_MS, MANUAL_LATENCY_MIN_MS } from '../voice/voice-config'
import { MODE_LABELS } from '../voice/reference'

interface Props {
  voice: VoiceController
}

const STATE_LABEL = { silence: 'silêncio', noise: 'ruído', voice: 'voz', idle: '—' } as const

const COMPONENT_LABEL: Record<keyof ReturnType<typeof basicComponents>, string> = {
  activity: 'Atividade vocal',
  stability: 'Estabilidade do pitch',
  continuity: 'Continuidade das frases',
  silence: 'Ausência de silêncios longos',
  quality: 'Qualidade do sinal (ruído/saturação)'
}

const pct = (v: number): string => `${Math.round(v * 100)}%`
const levelWidth = (dbfs: number): string =>
  `${Math.max(0, Math.min(100, ((dbfs + 70) / 70) * 100))}%`

export function VoicePanel({ voice }: Props): React.JSX.Element {
  const { live, prefs, info } = voice
  const micOn = voice.micStatus === 'on'
  const selected = voice.devices.some((d) => d.id === (info?.deviceId ?? prefs.deviceId))
    ? (info?.deviceId ?? prefs.deviceId)
    : ''

  return (
    <div className="voice" data-testid="voice-panel">
      <details className="voice-details" data-testid="voice-details">
        <summary>
          🎤 Avaliação vocal
          <span
            className={`mic-badge ${micOn ? 'on' : 'off'}`}
            data-testid="mic-status"
            aria-live="polite"
          >
            {voice.micStatus === 'starting'
              ? 'ABRINDO MICROFONE…'
              : micOn
                ? 'MICROFONE ATIVO'
                : 'MICROFONE INATIVO'}
          </span>
        </summary>

        <div className="voice-body">
          <label className="check strong">
            <input
              type="checkbox"
              data-testid="voice-enabled"
              checked={prefs.enabled}
              onChange={(e) => voice.setEnabled(e.target.checked)}
            />
            Avaliar minha apresentação
          </label>
          <p className="hint" data-testid="voice-mode-label">
            <strong>{MODE_LABELS.basic}</strong> (modo recreativo). Mede atividade vocal,
            estabilidade e continuidade. <strong>Não mede afinação</strong>: sem uma melodia de
            referência não há como saber se você cantou as notas certas. O microfone só liga durante
            a apresentação e é liberado ao terminar.
          </p>
          <p className="hint" data-testid="headphones-tip">
            Para uma avaliação mais precisa, recomendamos o uso de fones de ouvido (evita que o
            microfone capte a música). Não é obrigatório.
          </p>

          <div className="voice-row">
            <label className="field inline">
              Microfone
              <select
                className="select"
                data-testid="mic-device"
                aria-label="Escolher microfone"
                value={selected}
                disabled={voice.devices.length === 0}
                onChange={(e) => voice.setDeviceId(e.target.value)}
              >
                {voice.devices.length === 0 && <option value="">Nenhum microfone</option>}
                {voice.devices.length > 0 && selected === '' && (
                  <option value="">Microfone padrão</option>
                )}
                {voice.devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={`btn small${voice.diagnosticsOn ? ' primary' : ''}`}
              data-testid="btn-mic-test"
              aria-pressed={voice.diagnosticsOn}
              onClick={voice.toggleDiagnostics}
            >
              {voice.diagnosticsOn ? 'Parar teste' : 'Testar microfone'}
            </button>
          </div>

          {voice.micError && (
            <div className="notice error" role="alert" data-testid="mic-error">
              {voice.micError}
            </div>
          )}
          {voice.micNotice && !voice.micError && (
            <div className="notice warn" role="status" data-testid="mic-notice">
              {voice.micNotice}
            </div>
          )}

          <div className="diag" data-testid="voice-diagnostics">
            <div className="diag-level">
              <div
                className={`bar${live.clipping ? ' clip' : ''}`}
                style={{ width: levelWidth(live.dbfs) }}
                data-testid="diag-level-bar"
              />
            </div>
            <dl>
              <dt>Dispositivo</dt>
              <dd data-testid="diag-device">{info?.label || '—'}</dd>
              <dt>Taxa / processamento</dt>
              <dd data-testid="diag-format">
                {info
                  ? `${info.sampleRate} Hz · eco ${info.echoCancellation === false ? 'off' : '?'} · ruído ${info.noiseSuppression === false ? 'off' : '?'} · AGC ${info.autoGainControl === false ? 'off' : '?'}`
                  : '—'}
              </dd>
              <dt>Nível de entrada</dt>
              <dd data-testid="diag-level">{micOn ? `${live.dbfs.toFixed(1)} dBFS` : '—'}</dd>
              <dt>Ruído ambiente</dt>
              <dd data-testid="diag-noise">
                {micOn ? `${live.noiseFloorDb.toFixed(1)} dBFS` : '—'}
                {micOn && live.roomNoisy && <span className="warn-text"> · ambiente ruidoso</span>}
              </dd>
              <dt>Estado</dt>
              <dd data-testid="diag-state">{STATE_LABEL[live.state]}</dd>
              <dt>Frequência</dt>
              <dd data-testid="diag-freq">
                {live.frequency !== null ? `${live.frequency.toFixed(1)} Hz` : '—'}
              </dd>
              <dt>Nota aproximada</dt>
              <dd data-testid="diag-note">{formatNote(live.note, live.cents)}</dd>
              <dt>Confiança</dt>
              <dd data-testid="diag-clarity">{micOn ? pct(live.clarity) : '—'}</dd>
              <dt>Voz detectada (5 s)</dt>
              <dd data-testid="diag-voiced">{micOn ? `${Math.round(live.voicedPct)}%` : '—'}</dd>
              <dt>Quadros/s</dt>
              <dd data-testid="diag-fps">{micOn ? live.framesPerSec.toFixed(0) : '—'}</dd>
              <dt>Quadros descartados</dt>
              <dd data-testid="diag-dropped">{micOn ? live.droppedFrames : '—'}</dd>
              <dt>Latência</dt>
              <dd data-testid="diag-latency">
                {voice.latency.measuredMs !== null
                  ? `medida ${voice.latency.measuredMs} ms`
                  : `sistema ${voice.latency.autoMs} ms`}
                {` · ajuste ${voice.latency.manualMs >= 0 ? '+' : ''}${voice.latency.manualMs} ms · total ${Math.round(voice.totalLatencyMs)} ms`}
              </dd>
            </dl>
          </div>

          <div className="voice-row">
            <label className="field inline grow">
              Ajuste de latência: {voice.prefs.manualLatencyMs} ms
              <input
                type="range"
                data-testid="latency-manual"
                min={MANUAL_LATENCY_MIN_MS}
                max={MANUAL_LATENCY_MAX_MS}
                step={5}
                value={voice.prefs.manualLatencyMs}
                onChange={(e) => voice.setManualLatency(Number(e.target.value))}
              />
            </label>
            <button
              className="btn small"
              data-testid="btn-measure-latency"
              disabled={voice.measuring || !micOn}
              onClick={() => void voice.measureLatency()}
              title="Toca cliques e mede quando o microfone os ouve (exige alto-falantes)"
            >
              {voice.measuring ? 'Medindo…' : 'Medir latência'}
            </button>
            {voice.prefs.measuredLatencyMs !== null && (
              <button className="btn small" onClick={voice.clearMeasuredLatency}>
                Remover medição
              </button>
            )}
          </div>
          {voice.latencyMessage && (
            <div className="notice info" role="status" data-testid="latency-message">
              {voice.latencyMessage}
            </div>
          )}

          {voice.performance && (
            <div className="hint" data-testid="perf-status">
              Apresentação em análise: {voice.performance.seconds.toFixed(0)} s · voz{' '}
              {Math.round(voice.performance.voicedPct)}%{' '}
              {voice.performance.running ? '' : '(em pausa)'}
            </div>
          )}
        </div>
      </details>

      {voice.result && (
        <div className="voice-result" data-testid="voice-result">
          <div className="voice-result-head">
            <div>
              <div className="mode-label" data-testid="voice-result-label">
                {voice.result.score.label}
              </div>
              <div className="hint">
                {voice.result.songTitle}
                {voice.result.singer ? ` · ${voice.result.singer}` : ''}
                {voice.result.completedFraction !== null &&
                  ` · ${Math.round(voice.result.completedFraction * 100)}% da música`}
              </div>
            </div>
            <div className="score" data-testid="voice-score">
              {voice.result.score.score ?? '—'}
              {voice.result.score.score !== null && <small>/100</small>}
            </div>
            <button className="link" onClick={voice.clearResult}>
              Fechar
            </button>
          </div>
          {voice.result.score.insufficientReason && (
            <div className="notice warn" data-testid="voice-insufficient">
              {voice.result.score.insufficientReason}
            </div>
          )}
          <ul className="components" data-testid="voice-components">
            {(Object.keys(voice.result.score.components) as (keyof typeof COMPONENT_LABEL)[]).map(
              (key) => (
                <li key={key}>
                  <span>{COMPONENT_LABEL[key]}</span>
                  <span className="meter">
                    <i style={{ width: pct(voice.result!.score.components[key]) }} />
                  </span>
                  <span className="num">{pct(voice.result!.score.components[key])}</span>
                </li>
              )
            )}
          </ul>
          <p className="hint" data-testid="voice-disclaimer">
            {voice.result.score.disclaimer}
          </p>
          <p className="hint small-print">
            Fórmula v{voice.result.score.formulaVersion} · voz em{' '}
            {Math.round(voice.result.summary.voicedFraction * 100)}% do tempo · maior pausa{' '}
            {voice.result.summary.longestGapSec.toFixed(1)} s
          </p>
        </div>
      )}
    </div>
  )
}
