/**
 * Teste ponta a ponta da FASE 4A/4B (microfone, avaliação básica e com melodia MIDI/KAR), com o app Electron real.
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
// A nota exibida (voice-score) está em escala 0,0–10,0; o valor interno (0–100) fica em
// data-score-100 exatamente para os testes não precisarem reinterpretar a vírgula decimal.
const score100 = (page) => page.getAttribute(T('voice-score'), 'data-score-100').then(Number)
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
    score: await score100(page),
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
  check(
    'V7b. indicador grande informa que está captando voz',
    /CAPTANDO VOZ/.test(await text(page, 'diag-live')),
    await text(page, 'diag-live')
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
  const partialScore = await score100(page)
  check(
    'V20. parar antes do fim encerra e mostra o resultado (AVALIAÇÃO BÁSICA)',
    (await text(page, 'voice-result-label')) === 'AVALIAÇÃO BÁSICA'
  )
  check(
    'V21. tom contínuo e estável rende nota alta no modo básico (≥ 85)',
    partialScore >= 85 && partialScore <= 100,
    `${partialScore}/100`
  )
  const partialScoreText = await text(page, 'voice-score')
  check(
    'V21b. a nota aparece na tela em escala 0,0–10,0 (não 0–100)',
    /^\d{1,2},\d\/10$/.test(partialScoreText),
    partialScoreText
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
  const metricsText = await text(page, 'voice-metrics')
  check(
    'V23b. o resultado mostra as métricas que geraram a nota',
    /Tempo com voz/.test(metricsText) &&
      /Estabilidade do pitch/.test(metricsText) &&
      /Ruído ambiente/.test(metricsText) &&
      /Nível médio da voz/.test(metricsText)
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
      /Avaliação concluída/.test(log)
  )
  check(
    'V27b. log tem telemetria por segundo e as métricas da avaliação (para ajustar limiares)',
    (log.match(/Amostra do microfone/g) ?? []).length >= 10 &&
      /"contexto":"apresentação"/.test(log) &&
      /Métricas da avaliação.*"summary":{.*"components":{/.test(log)
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
  const silenceScore = await score100(page)
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
  const noiseScore = await score100(page)
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
  const melodyScore = await score100(page)
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
  // =====================================================================
  // Cenário E — melodia de referência MIDI/KAR (Fase 4B)
  // =====================================================================
  console.log('\n## Cenário E: melodia de referência (test-assets/melody)')
  const melodyLibrary = join(work, 'library-melody')
  cpSync(join(root, 'test-assets', 'melody'), melodyLibrary, { recursive: true })
  const runSong = async (page, title) => {
    await playSong(page, title)
    await page.waitForSelector(T('voice-result'), { timeout: 60000 })
    const out = {
      score: await score100(page),
      label: await text(page, 'voice-result-label'),
      mode: await page.getAttribute(T('voice-result'), 'data-mode'),
      notes: (await page.textContent(T('ref-notes')).catch(() => '')) ?? '',
      transpose: (await page.textContent(T('ref-transpose')).catch(() => '')) ?? ''
    }
    await page.click(`${T('voice-result')} .link`)
    await waitText(page, 'mic-status', /INATIVO/, 15000)
    return out
  }
  ;({ app, page } = await launch('steady-a440.wav'))
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, melodyLibrary)
  await page.click('text=Adicionar pasta de músicas')
  await waitText(page, 'import-summary', /4 música\(s\) adicionada\(s\)/, 30000)
  check(
    'E1. importação detecta MIDI/KAR ao lado das músicas',
    /com melodia MIDI\/KAR/.test(await text(page, 'import-summary')),
    await text(page, 'import-summary')
  )
  const tags = await page.$$eval(T('tag-melody'), (els) => els.map((e) => e.textContent))
  check(
    'E2. etiquetas MIDI e KAR aparecem na biblioteca',
    tags.includes('MIDI') && tags.includes('KAR'),
    tags.join(',')
  )
  await openVoice(page)
  if (!(await page.isChecked(T('voice-enabled')))) await page.click(T('voice-enabled'))

  // E3-E6: A4 contínuo contra melodia A4
  await playSong(page, 'Nota La')
  await waitText(page, 'melody-status', /Nota La\.mid|MID/i, 15000)
  const status = await text(page, 'melody-status')
  check(
    'E3. com MIDI, o modo passa a AVALIAÇÃO COM MELODIA DE REFERÊNCIA (com a melodia identificada)',
    /AVALIAÇÃO COM MELODIA DE REFERÊNCIA/.test(await text(page, 'voice-mode-label')) &&
      /8 notas/.test(status),
    status
  )
  await page.waitForSelector(T('voice-result'), { timeout: 60000 })
  const la = {
    score: await score100(page),
    label: await text(page, 'voice-result-label'),
    mode: await page.getAttribute(T('voice-result'), 'data-mode'),
    notes: await text(page, 'ref-notes'),
    transpose: await text(page, 'ref-transpose')
  }
  check(
    'E4. resultado rotulado AVALIAÇÃO COM MELODIA DE REFERÊNCIA',
    la.label === 'AVALIAÇÃO COM MELODIA DE REFERÊNCIA' && la.mode === 'reference',
    la.label
  )
  check('E5. cantar a nota certa rende nota alta (≥ 85)', la.score >= 85, `${la.score}/100`)
  check(
    'E6. reconhece que está no tom, sem transposição',
    /no tom/.test(la.transpose),
    la.transpose
  )
  check('E6b. informa notas acertadas', /Notas acertadas: [4-8] de 8/.test(la.notes), la.notes)
  await page.click(`${T('voice-result')} .link`)
  await waitText(page, 'mic-status', /INATIVO/, 15000)

  // E7: KAR em outro tom (C4) cantado em A4 -> transposição de 3 semitons
  const doRes = await runSong(page, 'Nota Do')
  check(
    'E7. KAR: transposição de 3 semitons detectada e nota alta (≥ 80)',
    /transposição detectada: [+-]3 semitons/.test(doRes.transpose) && doRes.score >= 80,
    `${doRes.score}/100 · ${doRes.transpose}`
  )

  // E8: melodia quebrada -> aviso e volta ao modo básico
  await playSong(page, 'Melodia Quebrada')
  await waitText(page, 'melody-error', /melodia/i, 15000)
  check(
    'E8. arquivo de melodia inválido: avisa e cai para AVALIAÇÃO BÁSICA (nunca finge afinação)',
    /AVALIAÇÃO BÁSICA/.test(await text(page, 'voice-mode-label')) &&
      /Usando a avaliação básica/.test(await text(page, 'melody-error'))
  )
  await page.waitForSelector(T('voice-result'), { timeout: 60000 })
  const broken = {
    label: await text(page, 'voice-result-label'),
    score: await score100(page)
  }
  check(
    'E9. sem melodia utilizável o resultado continua AVALIAÇÃO BÁSICA',
    broken.label === 'AVALIAÇÃO BÁSICA' && broken.score >= 70,
    `${broken.label} ${broken.score}/100`
  )
  await page.click(`${T('voice-result')} .link`)
  await waitText(page, 'mic-status', /INATIVO/, 15000)

  // E10: duas trilhas -> escolha e persistência
  await playSong(page, 'Duas Trilhas')
  await page.waitForSelector(T('melody-track'), { timeout: 15000 })
  const trackOptions = await page.$$eval(`${T('melody-track')} option`, (o) =>
    o.map((x) => ({ value: x.value, label: x.textContent }))
  )
  const before = await page.inputValue(T('melody-track'))
  const other = trackOptions.find((o) => o.value !== before)
  check(
    'E10. música com duas trilhas oferece a escolha e sugere uma',
    trackOptions.length === 2 && trackOptions.some((o) => /sugerida/.test(o.label)),
    trackOptions.map((o) => o.label).join(' | ')
  )
  await page.selectOption(T('melody-track'), other.value)
  await sleep(800)
  await page.click(T('btn-stop'))
  await app.close()
  ;({ app, page } = await launch('steady-a440.wav'))
  await openVoice(page)
  await playSong(page, 'Duas Trilhas')
  await page.waitForSelector(T('melody-track'), { timeout: 15000 })
  check(
    'E11. a trilha escolhida fica guardada após reabrir o app',
    (await page.inputValue(T('melody-track'))) === other.value,
    `esperado ${other.value}, veio ${await page.inputValue(T('melody-track'))}`
  )
  await page.click(T('btn-stop'))
  await app.close()

  // E12: cantar a melodia errada contra a referência A4 -> nota baixa
  ;({ app, page } = await launch('melody.wav'))
  await openVoice(page)
  if (!(await page.isChecked(T('voice-enabled')))) await page.click(T('voice-enabled'))
  const wrong = await runSong(page, 'Nota La')
  check(
    'E12. cantar notas diferentes da referência rende nota bem menor que a certa',
    wrong.mode === 'reference' && wrong.score < la.score - 25,
    `${wrong.score}/100 (certa: ${la.score}) · ${wrong.notes}`
  )
  await app.close()

  // E13: silêncio contra referência -> 0
  ;({ app, page } = await launch('silence.wav'))
  await openVoice(page)
  if (!(await page.isChecked(T('voice-enabled')))) await page.click(T('voice-enabled'))
  const quiet = await runSong(page, 'Nota La')
  check('E13. silêncio contra a referência recebe 0', quiet.score === 0, `${quiet.score}/100`)
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
