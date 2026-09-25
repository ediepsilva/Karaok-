/**
 * Teste ponta a ponta da FASE 5 (aplausos + voz ao fim da apresentação), com o app Electron real.
 * O microfone é o WAV conhecido de tom estável (Fase 4A); a "plateia" e a locução (TTS) usam a
 * voz de verdade do sistema operacional (sem depender de internet).
 */
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const voiceDir = join(root, 'test-assets', 'voice')
const work = mkdtempSync(join(tmpdir(), 'karaoke-e2e-celebration-'))

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
    args: [root, '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${file}`],
    env: { ...cleanEnv, KARAOKE_USER_DATA: join(work, 'userdata'), ELECTRON_RENDERER_URL: '' }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid="song-list"]')
  // Instrumenta ANTES de qualquer apresentação (bem cedo: nenhuma apresentação termina tão rápido):
  // grava toda AudioContext criada e toda fala pedida, sem trocar o comportamento real.
  await page.evaluate(() => {
    window.__celebration = { audioContexts: 0, utterances: [] }
    const OriginalAudioContext = window.AudioContext
    window.AudioContext = new Proxy(OriginalAudioContext, {
      construct(target, args) {
        window.__celebration.audioContexts++
        return Reflect.construct(target, args)
      }
    })
    if (window.speechSynthesis) {
      const originalSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis)
      window.speechSynthesis.speak = (utterance) => {
        window.__celebration.utterances.push({
          text: utterance.text,
          lang: utterance.lang,
          rate: utterance.rate
        })
        originalSpeak(utterance)
      }
    }
  })
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
const playSong = (page, title) => page.click(`.song-row:has-text("${title}")`)
const celebrationState = (page) => page.evaluate(() => window.__celebration)

try {
  console.log('\n## Aplausos + voz ao fim da apresentação (nota alta)')
  let { app, page } = await launch('steady-a440.wav')
  await app.evaluate(
    ({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    },
    join(root, 'test-assets', 'mp3g')
  )
  await page.click('[data-testid="btn-add-folder"]')
  await page.waitForSelector(T('import-summary'))
  await openVoice(page)

  check(
    'C1. "Comemorar com aplausos e voz" vem ligado por padrão',
    await page.isChecked(T('celebration-enabled'))
  )
  check(
    'C2. o controle de volume aparece quando está ligado',
    (await page.$(T('celebration-volume'))) !== null
  )

  await page.fill(T('singer-input'), 'Fulano')
  if (!(await page.isChecked(T('voice-enabled')))) await page.click(T('voice-enabled'))
  await playSong(page, 'Tom de Teste')
  await waitText(page, 'mic-status', /MICROFONE ATIVO/, 25000)
  await page.waitForSelector(T('voice-result'), { timeout: 45000 })
  // A tela mostra a nota em escala 0,0–10,0; a fala (TTS) usa os "pontos" na escala interna
  // 0–100, exposta em data-score-100 (ver VoicePanel.tsx) exatamente para isto.
  const score = Number(await page.getAttribute(T('voice-score'), 'data-score-100'))
  check('C3. apresentação gerou uma nota', score >= 0 && score <= 100, `${score}/100`)

  // dá tempo do atraso da fala (SPEECH_DELAY_SEC) + a fala em si acontecer
  await sleep(4000)
  const state = await celebrationState(page)
  check(
    'C4. um AudioContext foi criado para os aplausos',
    state.audioContexts >= 1,
    `${state.audioContexts}`
  )
  check(
    'C5. o app pediu para falar (TTS) mencionando o cantor e a nota',
    state.utterances.length === 1 &&
      state.utterances[0].text.includes('Fulano') &&
      state.utterances[0].text.includes(String(score)),
    JSON.stringify(state.utterances)
  )
  check(
    'C6. a fala está em português (pt-*)',
    /^pt/i.test(state.utterances[0]?.lang ?? ''),
    state.utterances[0]?.lang
  )
  await app.close()

  console.log('\n## Desligado: nenhuma fala nem aplauso')
  ;({ app, page } = await launch('steady-a440.wav'))
  await app.evaluate(
    ({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    },
    join(root, 'test-assets', 'mp3g')
  )
  await page.click('[data-testid="btn-add-folder"]')
  await page.waitForSelector(T('import-summary'))
  await openVoice(page)
  await page.click(T('celebration-enabled')) // desliga
  check(
    'D1. desligar esconde o controle de volume',
    (await page.$(T('celebration-volume'))) === null
  )
  if (!(await page.isChecked(T('voice-enabled')))) await page.click(T('voice-enabled'))
  await playSong(page, 'Tom de Teste')
  await waitText(page, 'mic-status', /MICROFONE ATIVO/, 25000)
  await page.waitForSelector(T('voice-result'), { timeout: 45000 })
  await sleep(3000)
  const off = await celebrationState(page)
  check(
    'D2. com a comemoração desligada, nenhuma fala é pedida',
    off.utterances.length === 0,
    JSON.stringify(off.utterances)
  )
  // NOTA: a persistência da preferência entre reaberturas (como voice-prefs já faz) depende do
  // Chromium gravar o localStorage em disco antes do processo encerrar; em testes automatizados
  // que fecham o Electron logo em seguida isso é pouco confiável (falso negativo), então não é
  // verificado aqui. Testado manualmente: liga/desliga a comemoração, feche e reabra o app.
  await app.close()
} catch (error) {
  failed++
  console.error('FALHA INESPERADA NO E2E DE COMEMORAÇÃO:', error)
}

console.log(
  `\nE2E COMEMORAÇÃO: ${results.filter((r) => r.ok).length}/${results.length} verificações aprovadas${failed ? ` — ${failed} FALHA(S)` : ''}`
)
process.exit(failed ? 1 : 0)
