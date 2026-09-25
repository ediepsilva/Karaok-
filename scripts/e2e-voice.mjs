/**
 * Teste ponta a ponta da FASE 4A (microfone + avaliação básica), com o app Electron real.
 * O microfone é um WAV conhecido reproduzido pelo Chromium (--use-file-for-fake-audio-capture);
 * SEM a flag que pula o pedido de permissão, para exercitar a trava do microfone do app.
 *
 * Cenários (um app por WAV): tom A4 estável, silêncio, ruído e melodia (uma nota por segundo).
 * Limite: o microfone falso não escuta o alto-falante; logo a MEDIÇÃO de latência por cliques só
 * tem o caminho de falha testado aqui (o caminho de sucesso é coberto por teste unitário e manual).
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const voiceDir = join(root, 'test-assets', 'voice')
const work = mkdtempSync(join(tmpdir(), 'karaoke-e2e-voice-'))
const userData = join(work, 'userdata')
const library = join(work, 'library')
cpSync(join(root, 'test-assets', 'mp3g'), library, { recursive: true })

const results = []
let failed = 0
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { ELECTRON_RUN_AS_NODE: _ignored, ...cleanEnv } = process.env

async function launch(wav) {
  const file = join(voiceDir, wav)
  if (!existsSync(file)) throw new Error(`WAV de teste ausente: ${file} (rode npm run fixtures)`)
  const app = await electron.launch({
    ...(process.env.E2E_EXE ? { executablePath: process.env.E2E_EXE } : {}),
    args: [
      ...(process.env.E2E_EXE ? [] : [root]),
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${file}`
    ],
    env: { ...cleanEnv, KARAOKE_USER_DATA: userData, ELECTRON_RENDERER_URL: '' }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid="song-list"]')
  return { app, page }
}

const T = (id) => `[data-testid="${id}"]`
const text = (page, id) => page.textContent(T(id))
const waitText = (page, id, re, timeout = 20000) =>
  page.waitForFunction(
    ([sel, source, flags]) =>
      new RegExp(source, flags).test(document.querySelector(sel)?.textContent ?? ''),
    [T(id), re.source, re.flags],
    { timeout }
  )
const openVoice = async (page) => {
  const open = await page.evaluate(
    () => document.querySelector('[data-testid="voice-details"]').open
  )
  if (!open) await page.click(`${T('voice-details')} summary`)
}
const micActive = async (page) =>
  /ATIVO/.test(await text(page, 'mic-status')) && !/INATIVO/.test(await text(page, 'mic-status'))
const number = (s) => Number((s.match(/-?\d+(\.\d+)?/) ?? [NaN])[0])
const setRange = (page, id, value) =>
  page.evaluate(
    ([sel, v]) => {
      const input = document.querySelector(sel)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
        input,
        String(v)
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    [T(id), value]
  )
const playSong = (page, title) => page.click(`.song-row:has-text("${title}")`)
const readLog = () => {
  const dir = join(userData, 'logs')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.log'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
}

/** Toca "Tom de Teste" (12 s) inteira e devolve o resultado da avaliação (ou null). */
async function performFullSong(page) {
  await page.click(T('voice-enabled')).catch(() => {})
  await playSong(page, 'Tom de Teste')
  await page.waitForSelector(T('voice-result'), { timeout: 45000 })
  return {
    score: number(await text(page, 'voice-score')),
    label: await text(page, 'voice-result-label')
  }
}

try {
  // =====================================================================
  // Cenário A — tom A4 estável
  // =====================================================================
  console.log('\n## Cenário A: tom A4 estável (steady-a440.wav)')
  let { app, page } = await launch('steady-a440.wav')
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, library)
  await page.click('text=Adicionar pasta de músicas')
  await page.waitForSelector(T('import-summary'))
  await openVoice(page)

  const denied = await page.evaluate(() =>
    navigator.mediaDevices.getUserMedia({ audio: true }).then(
      () => 'concedido',
      (e) => e.name
    )
  )
  check(
    'V1. sem armar a trava, o microfone é negado (acesso restrito)',
    denied === 'NotAllowedError',
    denied
  )
  check(
    'V2. microfone começa INATIVO e a avaliação vem desligada',
    /INATIVO/.test(await text(page, 'mic-status')) && !(await page.isChecked(T('voice-enabled')))
  )
  check(
    'V3. o painel avisa: modo básico não mede afinação, e recomenda fones sem exigir',
    /AVALIAÇÃO BÁSICA/.test(await text(page, 'voice-mode-label')) &&
      /Não mede afinação/.test(await text(page, 'voice-mode-label')) &&
      /recomendamos o uso de fones de ouvido/.test(await text(page, 'headphones-tip'))
  )

  await page.click(T('voice-enabled'))
  await sleep(1500)
  check(
    'V4. habilitar a avaliação NÃO liga o microfone (só durante a apresentação)',
    !(await micActive(page))
  )

  check(
    'V5. lista de microfones disponível',
    (await page.$$eval(`${T('mic-device')} option`, (o) => o.length)) >= 2
  )

  await page.click(T('btn-mic-test'))
  await waitText(page, 'mic-status', /MICROFONE ATIVO/, 20000)
  check('V6. "Testar microfone" liga o microfone', await micActive(page))
  await waitText(page, 'diag-state', /voz/, 20000)
  await waitText(page, 'diag-voiced', /^(8\d|9\d|100)%/, 30000)
  const freq = number(await text(page, 'diag-freq'))
  const note = await text(page, 'diag-note')
  const clarity = number(await text(page, 'diag-clarity'))
  const level = number(await text(page, 'diag-level'))
  const fps = number(await text(page, 'diag-fps'))
  check(
    'V7. detecta a frequência do tom conhecido (440 Hz ±4)',
    Math.abs(freq - 440) <= 4,
    `${freq} Hz`
  )
  check('V8. mostra a nota musical aproximada (A4)', /^A4/.test(note), note)
  check('V9. confiança alta em tom limpo (≥ 90%)', clarity >= 90, `${clarity}%`)
  check(
    'V10. nível de entrada coerente com -20 dBFS (±4)',
    Math.abs(level - -20) <= 4,
    `${level} dBFS`
  )
  check('V11. análise em tempo real (≥ 20 quadros/s)', fps >= 20, `${fps} quadros/s`)
  const format = await text(page, 'diag-format')
  check(
    'V12. captura sem eco/supressão/AGC (não distorcem o pitch)',
    /eco off/.test(format) && /ruído off/.test(format) && /AGC off/.test(format),
    format
  )
  const deviceLabel = await text(page, 'diag-device')
  check('V13. mostra o dispositivo selecionado', /Fake/i.test(deviceLabel), deviceLabel)

  await page.click(T('btn-measure-latency'))
  await waitText(page, 'latency-message', /Não foi possível medir/, 30000)
  check(
    'V14. medição de latência sem clique audível falha com aviso claro (não inventa valor)',
    /sistema/.test(await text(page, 'diag-latency'))
  )

  await page.click(T('btn-mic-test'))
  await waitText(page, 'mic-status', /INATIVO/, 10000)
  check(
    'V15. "Parar teste" libera o microfone',
    !(await micActive(page)) && (await text(page, 'diag-state')) === '—'
  )

  // seleção de dispositivo (os rótulos aparecem depois da primeira captura)
  const options = await page.$$eval(`${T('mic-device')} option`, (o) =>
    o.map((x) => ({ value: x.value, label: x.textContent }))
  )
  const second =
    options.find((o) => /Fake Audio Input 2/.test(o.label)) ?? options[options.length - 1]
  await page.selectOption(T('mic-device'), second.value)
  await page.click(T('btn-mic-test'))
  await waitText(page, 'mic-status', /MICROFONE ATIVO/, 20000)
  const chosen = await text(page, 'diag-device')
  check(
    'V16. seleção de dispositivo: usa o microfone escolhido',
    /Fake Audio Input 2/.test(chosen),
    chosen
  )
  await page.click(T('btn-mic-test'))
  await waitText(page, 'mic-status', /INATIVO/, 10000)

  await setRange(page, 'latency-manual', 120)
  await sleep(300)
  const latencyText = await text(page, 'diag-latency')
  check('V17. ajuste manual de latência entra no total', /\+120 ms/.test(latencyText), latencyText)

  // ---- apresentação: início, pausa, parada antecipada ----
  await playSong(page, 'Tom de Teste')
  await waitText(page, 'mic-status', /MICROFONE ATIVO/, 25000)
  check(
    'V18. ao começar a apresentação (avaliação ligada), o microfone abre',
    await micActive(page)
  )
  await sleep(3500)
  await page.click(T('btn-pause'))
  await waitText(page, 'perf-status', /em pausa/, 10000)
  check(
    'V19. pausa curta: análise pausada e microfone mantido',
    (await micActive(page)) && /em pausa/.test(await text(page, 'perf-status'))
  )
  await page.click(T('btn-play'))
  await page.waitForFunction(() => document.querySelector('audio').currentTime > 7, null, {
    timeout: 30000
  })
  await page.click(T('btn-stop'))
  await page.waitForSelector(T('voice-result'), { timeout: 20000 })
  const partial = await text(page, 'voice-result')
  const partialScore = number(await text(page, 'voice-score'))
  check(
    'V20. parar antes do fim encerra e mostra o resultado (AVALIAÇÃO BÁSICA)',
    (await text(page, 'voice-result-label')) === 'AVALIAÇÃO BÁSICA'
  )
  check(
    'V21. tom contínuo e estável rende nota alta no modo básico (≥ 85)',
    partialScore >= 85 && partialScore <= 100,
    `${partialScore}/100`
  )
  check(
    'V22. o resultado informa a fração da música avaliada',
    /\d+% da música/.test(partial),
    (partial.match(/\d+% da música/) ?? [''])[0]
  )
  check(
    'V23. o resultado avisa que NÃO mede se cantou as notas certas',
    /NÃO mede se você cantou as notas certas/.test(await text(page, 'voice-disclaimer'))
  )
  await waitText(page, 'mic-status', /INATIVO/, 15000)
  check('V24. ao terminar a apresentação, o microfone é liberado', !(await micActive(page)))

  // ---- desabilitar a avaliação no meio da música ----
  await page.click(`${T('voice-result')} .link`)
  await playSong(page, 'Tom de Teste')
  await waitText(page, 'mic-status', /MICROFONE ATIVO/, 25000)
  await page.click(T('voice-enabled'))
  await waitText(page, 'mic-status', /INATIVO/, 10000)
  await sleep(1500)
  check(
    'V25. desativar a avaliação no meio da música libera o microfone e não gera nota',
    !(await micActive(page)) && (await page.$(T('voice-result'))) === null
  )
  await page.click(T('btn-stop'))
  await page.click(T('voice-enabled')) // deixa habilitada para a persistência
  await app.close()

  // persistência + microfone nunca liga sozinho ao abrir
  ;({ app, page } = await launch('steady-a440.wav'))
  await openVoice(page)
  await sleep(2500)
  check(
    'V26. após reabrir: preferências mantidas e o microfone NÃO abre sozinho',
    (await page.inputValue(T('latency-manual'))) === '120' &&
      (await page.isChecked(T('voice-enabled'))) &&
      !(await micActive(page))
  )
  await app.close()

  const log = readLog()
  check(
    'V27. log registra permissão negada, microfone ativo/liberado e avaliação concluída',
    /Permissão negada/.test(log) &&
      /Permissão de microfone concedida/.test(log) &&
      /Microfone ativo/.test(log) &&
      /Microfone liberado/.test(log) &&
      /Avaliação básica concluída/.test(log)
  )
  const active = (log.match(/Microfone ativo/g) ?? []).length
  const released = (log.match(/Microfone liberado/g) ?? []).length
  check(
    'V28. todo "Microfone ativo" tem um "Microfone liberado" (nada ficou aberto)',
    active > 0 && active === released,
    `${active} ativações, ${released} liberações`
  )

  // =====================================================================
  // Cenário B — silêncio
  // =====================================================================
  console.log('\n## Cenário B: silêncio (silence.wav)')
  ;({ app, page } = await launch('silence.wav'))
  await openVoice(page)
  await page.click(T('voice-enabled')).catch(() => {}) // já estava habilitada: garante o estado abaixo
  if (!(await page.isChecked(T('voice-enabled')))) await page.click(T('voice-enabled'))
  await playSong(page, 'Tom de Teste')
  await waitText(page, 'mic-status', /MICROFONE ATIVO/, 25000)
  await sleep(2500)
  const silentState = await text(page, 'diag-state')
  await page.waitForSelector(T('voice-result'), { timeout: 50000 })
  const silenceScore = number(await text(page, 'voice-score'))
  check('B1. silêncio é detectado como silêncio', silentState === 'silêncio', silentState)
  check('B2. silêncio recebe nota 0', silenceScore === 0, `${silenceScore}/100`)
  await app.close()

  // =====================================================================
  // Cenário C — ruído
  // =====================================================================
  console.log('\n## Cenário C: ruído (noise.wav)')
  ;({ app, page } = await launch('noise.wav'))
  await openVoice(page)
  if (!(await page.isChecked(T('voice-enabled')))) await page.click(T('voice-enabled'))
  await playSong(page, 'Tom de Teste')
  await waitText(page, 'mic-status', /MICROFONE ATIVO/, 25000)
  const noiseStates = new Set()
  for (let i = 0; i < 8; i++) {
    await sleep(500)
    noiseStates.add(await text(page, 'diag-state'))
  }
  await page.waitForSelector(T('voice-result'), { timeout: 50000 })
  const noiseScore = number(await text(page, 'voice-score'))
  check(
    'C1. ruído branco nunca é confundido com voz',
    !noiseStates.has('voz'),
    [...noiseStates].join(', ')
  )
  check(
    'C2. ruído é detectado como ruído (antes de o piso ambiente se adaptar)',
    noiseStates.has('ruído'),
    [...noiseStates].join(', ')
  )
  check('C3. só ruído recebe nota 0', noiseScore === 0, `${noiseScore}/100`)
  await app.close()

  // =====================================================================
  // Cenário D — melodia (uma nota por segundo)
  // =====================================================================
  console.log('\n## Cenário D: melodia (melody.wav)')
  ;({ app, page } = await launch('melody.wav'))
  await openVoice(page)
  if (!(await page.isChecked(T('voice-enabled')))) await page.click(T('voice-enabled'))
  await playSong(page, 'Tom de Teste')
  await waitText(page, 'mic-status', /MICROFONE ATIVO/, 25000)
  const seen = new Set()
  const valid = new Set(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'])
  let wrongNotes = 0
  for (let i = 0; i < 48; i++) {
    await sleep(250)
    if (await page.$(T('voice-result'))) break
    const n = (await text(page, 'diag-note')).split(' ')[0]
    if (n !== '—') {
      seen.add(n)
      if (!valid.has(n)) wrongNotes++
    }
  }
  await page.waitForSelector(T('voice-result'), { timeout: 45000 })
  const melodyScore = number(await text(page, 'voice-score'))
  check(
    'D1. acompanha as mudanças de nota (≥ 5 notas distintas da melodia)',
    [...seen].filter((n) => valid.has(n)).length >= 5,
    [...seen].join(' ')
  )
  check(
    'D2. quase nenhuma leitura fora das notas tocadas (≤ 10%)',
    wrongNotes <= 4,
    `${wrongNotes} leituras fora`
  )
  check(
    'D3. melodia com pausas de respiração rende nota alta (≥ 70)',
    melodyScore >= 70 && melodyScore <= 100,
    `${melodyScore}/100`
  )
  await app.close()
} catch (error) {
  failed++
  console.error('FALHA INESPERADA NO E2E DE VOZ:', error)
}

console.log(
  `\nE2E VOZ: ${results.filter((r) => r.ok).length}/${results.length} verificações aprovadas${failed ? ` — ${failed} FALHA(S)` : ''}`
)
console.log(`Artefatos: ${work}`)
process.exit(failed ? 1 : 0)
