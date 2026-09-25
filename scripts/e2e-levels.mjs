/**
 * Teste ponta a ponta dos NÍVEIS DE DIFICULDADE (Amador/Semiprofissional/Profissional), com o app
 * Electron real e o microfone falso de tom estável (Fase 4A).
 */
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const voiceDir = join(root, 'test-assets', 'voice')
const work = mkdtempSync(join(tmpdir(), 'karaoke-e2e-levels-'))
const userData = join(work, 'userdata')

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
const playSong = (page, title) => page.click(`.song-row:has-text("${title}")`)
const score100 = (page) => page.getAttribute(T('voice-score'), 'data-score-100').then(Number)

const performOnce = async (page, singer, level) => {
  await page.fill(T('singer-input'), singer)
  await openVoice(page)
  if (level) await page.click(T(`level-${level}`))
  if (!(await page.isChecked(T('voice-enabled')))) await page.click(T('voice-enabled'))
  await playSong(page, 'Tom de Teste')
  await waitText(page, 'mic-status', /MICROFONE ATIVO/, 25000)
  await page.waitForSelector(T('voice-result'), { timeout: 45000 })
  const score = await score100(page)
  await page.click(`${T('voice-result')} .link`).catch(() => {})
  return score
}

try {
  console.log('\n## Seletor de nível')
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
    'L1. o seletor de nível aparece com as 3 opções',
    (await page.$$(T('level-amateur'))).length === 1 &&
      (await page.$$(T('level-semiPro'))).length === 1 &&
      (await page.$$(T('level-professional'))).length === 1
  )
  await page.fill(T('singer-input'), 'Cantor Novo Nunca Visto')
  check(
    'L2. cantor novo começa no Amador',
    await page.getAttribute(T('level-amateur'), 'aria-pressed').then((v) => v === 'true')
  )
  check(
    'L3. a descrição do nível aparece',
    /tolerante|intermediária|rigorosa/i.test(await text(page, 'level-description'))
  )

  console.log('\n## Mesma apresentação, notas diferentes por nível')
  const amateurScore = await performOnce(page, 'Comparador', 'amateur')
  const semiProScore = await performOnce(page, 'Comparador', 'semiPro')
  const professionalScore = await performOnce(page, 'Comparador', 'professional')
  check(
    'L4. Amador ≥ Semiprofissional ≥ Profissional para a mesma voz',
    amateurScore >= semiProScore && semiProScore >= professionalScore,
    `${amateurScore} / ${semiProScore} / ${professionalScore}`
  )

  console.log('\n## Persistência por cantor')
  await page.fill(T('singer-input'), 'Comparador')
  await sleep(300)
  check(
    'L5. o último nível usado por esse cantor fica pré-selecionado',
    await page.getAttribute(T('level-professional'), 'aria-pressed').then((v) => v === 'true')
  )
  await page.fill(T('singer-input'), 'Outra Pessoa')
  await sleep(300)
  check(
    'L6. outro cantor não herda o nível do primeiro (começa no Amador)',
    await page.getAttribute(T('level-amateur'), 'aria-pressed').then((v) => v === 'true')
  )
  await app.close()

  console.log('\n## Promoção de nível (Amador → Semiprofissional)')
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
  await page.fill(T('singer-input'), 'Promissor')
  if (!(await page.isChecked(T('voice-enabled')))) await page.click(T('voice-enabled'))
  await playSong(page, 'Tom de Teste')
  await waitText(page, 'mic-status', /MICROFONE ATIVO/, 25000)
  await page.waitForSelector(T('voice-result'), { timeout: 45000 })
  const offerText = await text(page, 'promotion-offer').catch(() => null)
  check(
    'L7. nota alta no Amador oferece subir para Semiprofissional',
    (await page.$(T('promotion-offer'))) !== null && /Semiprofissional/.test(offerText ?? ''),
    offerText
  )
  await page.click(T('btn-promote'))
  check('L8. aceitar a promoção esconde a oferta', (await page.$(T('promotion-offer'))) === null)
  await page.click(`${T('voice-result')} .link`)
  await sleep(300)
  check(
    'L9. o nível do cantor já é Semiprofissional na tela',
    await page.getAttribute(T('level-semiPro'), 'aria-pressed').then((v) => v === 'true')
  )
  await app.close()

  console.log('\n## Recusar promoção mantém o nível')
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
  await page.fill(T('singer-input'), 'Teimoso')
  if (!(await page.isChecked(T('voice-enabled')))) await page.click(T('voice-enabled'))
  await playSong(page, 'Tom de Teste')
  await waitText(page, 'mic-status', /MICROFONE ATIVO/, 25000)
  await page.waitForSelector(T('voice-result'), { timeout: 45000 })
  await page.click(T('btn-stay-level'))
  await page.click(`${T('voice-result')} .link`)
  await sleep(300)
  check(
    'L10. recusar mantém o cantor no Amador',
    await page.getAttribute(T('level-amateur'), 'aria-pressed').then((v) => v === 'true')
  )
  await app.close()

  console.log('\n## Profissional não oferece promoção (só elogia)')
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
  await page.fill(T('singer-input'), 'Veterano')
  await page.click(T('level-professional'))
  if (!(await page.isChecked(T('voice-enabled')))) await page.click(T('voice-enabled'))
  await playSong(page, 'Tom de Teste')
  await waitText(page, 'mic-status', /MICROFONE ATIVO/, 25000)
  await page.waitForSelector(T('voice-result'), { timeout: 45000 })
  check(
    'L11. Profissional no topo não oferece promoção',
    (await page.$(T('promotion-offer'))) === null
  )
  check(
    'L12. Profissional com nota alta recebe só um elogio',
    (await page.$(T('top-level-praise'))) !== null
  )
  await app.close()
} catch (error) {
  failed++
  console.error('FALHA INESPERADA NO E2E DE NÍVEIS:', error)
}

console.log(
  `\nE2E NÍVEIS: ${results.filter((r) => r.ok).length}/${results.length} verificações aprovadas${failed ? ` — ${failed} FALHA(S)` : ''}`
)
process.exit(failed ? 1 : 0)
