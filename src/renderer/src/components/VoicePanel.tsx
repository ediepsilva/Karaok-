import { basicComponents } from '../voice/basic-score'
import { formatNote } from '../voice/mic-errors'
import type { ReferenceComponents } from '../voice/reference-score'
import type { CelebrationController } from '../celebration/useCelebration'
import type { MelodyController } from '../voice/useMelody'
import type { VoiceController, VoiceResult } from '../voice/useVoice'
import { MANUAL_LATENCY_MAX_MS, MANUAL_LATENCY_MIN_MS } from '../voice/voice-config'
import { MODE_LABELS } from '../voice/reference'

interface Props {
  voice: VoiceController
  melody: MelodyController
  celebration: CelebrationController
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

export function VoicePanel({ voice, melody, celebration }: Props): React.JSX.Element {
  const { live, prefs, info } = voice
  const micOn = voice.micStatus === 'on'
  const selected = voice.devices.some((d) => d.id === (info?.deviceId ?? prefs.deviceId))
    ? (info?.deviceId ?? prefs.deviceId)
    : ''

  return (
    <div className="voice" data-testid="voice-panel">
      <details className="voice-details" data-testid="voice-details" open>
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
          <div className="voice-row">
            <label className="check">
              <input
                type="checkbox"
                data-testid="celebration-enabled"
                checked={celebration.prefs.enabled}
                onChange={(e) => celebration.setEnabled(e.target.checked)}
              />
              Comemorar com aplausos e voz ao terminar
            </label>
            {celebration.prefs.enabled && (
              <label className="field inline">
                Volume da comemoração
                <input
                  type="range"
                  data-testid="celebration-volume"
                  aria-label="Volume da comemoração"
                  min={0}
                  max={1}
                  step={0.05}
                  value={celebration.prefs.volume}
                  onChange={(e) => celebration.setVolume(Number(e.target.value))}
                />
              </label>
            )}
          </div>
          {melody.info && melody.info.notes.length > 0 ? (
            <div className="hint" data-testid="voice-mode-label">
              <strong>{MODE_LABELS.reference}</strong>
              <div data-testid="melody-status">
                Melodia: {melody.info.fileName} ({melody.info.format.toUpperCase()}) ·{' '}
                {melody.info.notes.length} notas
                {melody.info.lyricCount > 0 && ` · ${melody.info.lyricCount} sílabas de letra`}.
                Compara a sua voz com a melodia (afinação, notas, ritmo, duração, entrada das
                frases, consistência e % cantado). A oitava é ignorada.
              </div>
              {melody.info.tracks.length > 1 && (
                <label className="field inline">
                  Trilha da melodia
                  <select
                    className="select"
                    data-testid="melody-track"
                    value={melody.info.selectedTrack ?? ''}
                    onChange={(e) => void melody.setTrack(Number(e.target.value))}
                  >
                    {melody.info.tracks
                      .filter((t) => !t.isDrums)
                      .map((t) => (
                        <option key={t.index} value={t.index}>
                          {t.name || `Trilha ${t.index}`} ({t.noteCount} notas)
                          {t.suggested ? ' — sugerida' : ''}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>
          ) : (
            <div className="hint" data-testid="voice-mode-label">
              <strong>{MODE_LABELS.basic}</strong> (modo recreativo). Mede atividade vocal,
              estabilidade e continuidade. <strong>Não mede afinação</strong>: sem uma melodia de
              referência (arquivo MIDI/KAR ao lado da música) não há como saber se você cantou as
              notas certas. O microfone só liga durante a apresentação e é liberado ao terminar.
              {melody.info !== null && melody.info.notes.length === 0 && (
                <div className="warn-text" data-testid="melody-unusable">
                  O arquivo {melody.info.fileName} não tem uma trilha utilizável como melodia.
                </div>
              )}
              {melody.error && (
                <div className="warn-text" data-testid="melody-error">
                  {melody.error} Usando a avaliação básica.
                </div>
              )}
            </div>
          )}
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
            <div className={`diag-live ${micOn ? live.state : 'off'}`} data-testid="diag-live">
              {!micOn
                ? 'Microfone inativo — aperte “Testar microfone”'
                : live.state === 'voice'
                  ? '● CAPTANDO VOZ'
                  : live.state === 'noise'
                    ? '● Captando RUÍDO (não é voz)'
                    : '○ Captando, mas em SILÊNCIO — fale ou cante'}
            </div>
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
              <dt>Registro (logs)</dt>
              <dd>
                <button
                  className="btn small"
                  data-testid="btn-open-logs"
                  onClick={() => void window.api.app.openLogs()}
                >
                  Abrir pasta de logs
                </button>
              </dd>
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

      {voice.result && <ResultCard result={voice.result} onClose={voice.clearResult} />}
    </div>
  )
}

const REFERENCE_LABEL: Record<keyof ReferenceComponents, string> = {
  pitch: 'Afinação',
  notes: 'Notas corretas',
  rhythm: 'Ritmo (entrada das notas)',
  phrases: 'Entrada das frases',
  duration: 'Duração das notas',
  presence: 'Percentual cantado',
  consistency: 'Consistência'
}

function ResultCard({
  result,
  onClose
}: {
  result: NonNullable<VoiceController['result']>
  onClose(): void
}): React.JSX.Element {
  const ref = result.primary === 'reference' ? result.reference : null
  const shown = ref ?? result.score
  const song = `${result.songTitle}${result.singer ? ` · ${result.singer}` : ''}${
    result.completedFraction !== null
      ? ` · ${Math.round(result.completedFraction * 100)}% da música`
      : ''
  }`
  return (
    <div className="voice-result" data-testid="voice-result" data-mode={result.primary}>
      <div className="voice-result-head">
        <div>
          <div className="mode-label" data-testid="voice-result-label">
            {shown.label}
          </div>
          <div className="hint">{song}</div>
        </div>
        <div className="score" data-testid="voice-score">
          {shown.score ?? '—'}
          {shown.score !== null && <small>/100</small>}
        </div>
        <button className="link" onClick={onClose}>
          Fechar
        </button>
      </div>

      {shown.insufficientReason && (
        <div className="notice warn" data-testid="voice-insufficient">
          {shown.insufficientReason}
        </div>
      )}
      {result.primary === 'basic' && result.reference?.insufficientReason && (
        <div className="notice warn" data-testid="ref-insufficient">
          Avaliação com melodia indisponível: {result.reference.insufficientReason} Mostrando a
          avaliação básica.
        </div>
      )}

      {ref ? (
        <>
          <ul className="components" data-testid="voice-components">
            {(Object.keys(ref.components) as (keyof ReferenceComponents)[]).map((key) => {
              const value = ref.components[key]
              return (
                <li key={key}>
                  <span>{REFERENCE_LABEL[key]}</span>
                  <span className="meter">
                    <i style={{ width: value === null ? '0%' : pct(value) }} />
                  </span>
                  <span className="num">{value === null ? '—' : pct(value)}</span>
                </li>
              )
            })}
          </ul>
          <p className="hint" data-testid="ref-details">
            <span data-testid="ref-notes">
              Notas acertadas: {ref.notesHit} de {ref.notesEvaluated}
            </span>{' '}
            ·{' '}
            <span data-testid="ref-transpose">
              {ref.transposeSemitones === 0
                ? 'no tom da melodia (oitava ignorada)'
                : `transposição detectada: ${ref.transposeSemitones > 0 ? '+' : ''}${ref.transposeSemitones} semitons (afinação medida em relação a ela)`}
            </span>
            {ref.medianOnsetMs !== null && (
              <>
                {' '}
                · <span data-testid="ref-onset">entrada mediana: {ref.medianOnsetMs} ms</span>
              </>
            )}
          </p>
          <p className="hint" data-testid="voice-disclaimer">
            Comparação com a melodia do arquivo MIDI/KAR da música. A nota depende da qualidade
            dessa melodia e de você cantar junto com a faixa.
          </p>
          <p className="hint small-print" data-testid="basic-complement">
            Avaliação básica (complementar): {result.score.score ?? '—'}/100 · fórmula v
            {ref.formulaVersion}
          </p>
        </>
      ) : (
        <>
          <ul className="components" data-testid="voice-components">
            {(Object.keys(result.score.components) as (keyof typeof COMPONENT_LABEL)[]).map(
              (key) => (
                <li key={key}>
                  <span>{COMPONENT_LABEL[key]}</span>
                  <span className="meter">
                    <i style={{ width: pct(result.score.components[key]) }} />
                  </span>
                  <span className="num">{pct(result.score.components[key])}</span>
                </li>
              )
            )}
          </ul>
          <p className="hint" data-testid="voice-disclaimer">
            {result.score.disclaimer}
          </p>
          <p className="hint small-print">
            Fórmula v{result.score.formulaVersion} · voz em{' '}
            {Math.round(result.summary.voicedFraction * 100)}% do tempo · maior pausa{' '}
            {result.summary.longestGapSec.toFixed(1)} s
          </p>
          <MetricsTable result={result} />
        </>
      )}
    </div>
  )
}

/** Números medidos que geraram a nota (mesmos valores gravados no log "Métricas da avaliação"). */
function MetricsTable({ result }: { result: VoiceResult }): React.JSX.Element {
  const s = result.summary
  const p = (x: number): string => `${(x * 100).toFixed(1)}%`
  const rows: [string, string][] = [
    ['Tempo analisado', `${s.durationSec.toFixed(1)} s`],
    ['Tempo com voz', `${s.voicedSec.toFixed(1)} s (${p(s.voicedFraction)})`],
    ['Tempo em silêncio', p(s.silenceFraction)],
    ['Tempo em ruído', p(s.noiseFraction)],
    ['Maior pausa sem voz', `${s.longestGapSec.toFixed(1)} s`],
    ['Frases (trechos contínuos de voz)', String(s.voicedRunCount)],
    [
      'Duração média / maior frase',
      `${s.meanRunSec.toFixed(1)} s / ${s.longestRunSec.toFixed(1)} s`
    ],
    ['Estabilidade do pitch', p(s.stableFraction)],
    ['Nível médio da voz', `${s.meanVoiceDb.toFixed(1)} dBFS`],
    ['Ruído ambiente', `${s.ambientNoiseDb.toFixed(1)} dBFS`],
    ['Saturação (clipping)', p(s.clippingFraction)]
  ]
  return (
    <details className="metrics" data-testid="voice-metrics" open>
      <summary>Métricas que geraram a nota</summary>
      <table>
        <tbody>
          {rows.map(([name, value]) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
