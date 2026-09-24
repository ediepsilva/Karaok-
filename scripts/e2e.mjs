/**
 * Teste ponta a ponta do aplicativo empacotado em out/ (npm run e2e).
 * Abre o Electron de verdade com um perfil e uma biblioteca temporários, usa a interface real
 * (botões, busca, player) e confere áudio, CDG, sincronismo, persistência e logs.
 * Limitação: "áudio audível" não pode ser verificado por script (só relógio/estado do <audio>).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const fixtures = join(root, 'test-assets', 'mp3g')
const work = mkdtempSync(join(tmpdir(), 'karaoke-e2e-'))
const userData = join(work, 'userdata')
const library = join(work, 'library')
cpSync(fixtures, library, { recursive: true })

// Mídias defeituosas: MP3 com cabeçalho válido mas dados corrompidos; CDG que é só texto.
const goodMp3 = readFileSync(join(fixtures, 'Artista Teste - Tom de Teste.mp3'))
const goodCdg = readFileSync(join(fixtures, 'Artista Teste - Tom de Teste.cdg'))
mkdirSync(join(library, 'Defeitos'), { recursive: true })
writeFileSync(
  join(library, 'Defeitos', 'Falha - Mp3 Corrompido.mp3'),
  Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200, 0x41)])
)
writeFileSync(join(library, 'Defeitos', 'Falha - Mp3 Corrompido.cdg'), goodCdg)
writeFileSync(join(library, 'Defeitos', 'Falha - Cdg Invalido.mp3'), goodMp3)
writeFileSync(
  join(library, 'Defeitos', 'Falha - Cdg Invalido.cdg'),
  'Isto nao e um arquivo CDG, apenas texto para testar o tratamento de erro.'
)
mkdirSync(join(library, 'Removivel'), { recursive: true })
writeFileSync(join(library, 'Removivel', 'Removivel Artista - Cancao Removivel.mp3'), goodMp3)
writeFileSync(join(library, 'Removivel', 'Removivel Artista - Cancao Removivel.cdg'), goodCdg)

const PALETTE = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [255, 0, 255],
  [0, 255, 255],
  [255, 136, 0]
]
const results = []
let failed = 0
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launch() {
  const app = await electron.launch({
    args: [root],
    env: { ...process.env, KARAOKE_USER_DATA: userData, ELECTRON_RENDERER_URL: '' }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid="song-list"]')
  return { app, page }
}

const status = (page) => page.textContent('[data-testid="player-status"]')
const waitStatus = (page, wanted, timeout = 8000) =>
  page.waitForFunction(
    (w) => document.querySelector('[data-testid="player-status"]')?.textContent === w,
    wanted,
    { timeout }
  )
const audioState = (page) =>
  page.evaluate(() => {
    const a = document.querySelector('audio')
    return { t: a.currentTime, paused: a.paused, volume: a.volume, duration: a.duration }
  })
const sample = (page) =>
  page.evaluate(() => {
    const a = document.querySelector('audio')
    const c = document.querySelector('[data-testid="cdg-canvas"]')
    const p = c.getContext('2d').getImageData(150, 108, 1, 1).data
    return { t: a.currentTime, px: [p[0], p[1], p[2], p[3]] }
  })

/** Confere se a cor central do CDG corresponde ao segundo atual do áudio. */
async function syncSamples(page, count) {
  let good = 0
  let usable = 0
  for (let i = 0; i < count; i++) {
    const { t, px } = await sample(page)
    const frac = t - Math.floor(t)
    if (frac > 0.12 && frac < 0.9) {
      usable++
      const want = PALETTE[Math.floor(t) % 7]
      if (px[0] === want[0] && px[1] === want[1] && px[2] === want[2]) good++
    }
    await sleep(370)
  }
  return { good, usable }
}

const clickSong = (page, title) => page.click(`.song-row:has-text("${title}")`)

try {
  // ---------- Execução 1 ----------
  let { app, page } = await launch()
  check('1. aplicação inicializa (janela + lista)', true)
  check(
    '2. isolamento: contextIsolation ativo e sem require no renderer',
    await page.evaluate(() => typeof require === 'undefined' && typeof window.api === 'object')
  )

  const dbPath = join(userData, 'karaoke.db')
  check('3. banco SQLite criado automaticamente', existsSync(dbPath))

  // Seleção de pasta: o diálogo nativo é substituído e o botão real é clicado.
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, library)
  await page.click('text=Adicionar pasta de músicas')
  await page.waitForSelector('[data-testid="import-summary"]')
  const summary = await page.textContent('[data-testid="import-summary"]')
  // fixture: 2 pares; Defeitos: 2 pares; Removivel/x: 1 par → 5 pares; 1 MP3 solo + 1 CDG solo (Removivel copia Subpasta)
  const count = await page.textContent('[data-testid="song-count"]')
  check(
    '4. importação recursiva encontra os pares MP3+CDG',
    count.startsWith('5 '),
    `${count} | ${summary.trim()}`
  )
  check('5. MP3 sem CDG e CDG sem MP3 são informados', /1 MP3 sem CDG, 1 CDG sem MP3/.test(summary))

  await page.click('text=Adicionar pasta de músicas')
  await page.waitForFunction(() =>
    /0 música\(s\) adicionada/.test(
      document.querySelector('[data-testid="import-summary"]')?.textContent ?? ''
    )
  )
  check(
    '6. reimportar não duplica músicas',
    (await page.textContent('[data-testid="song-count"]')).startsWith('5 ')
  )

  await page.fill('.search', 'tom de teste')
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="song-count"]')?.textContent?.startsWith('1 ')
  )
  check('7. busca por título', (await page.textContent('.song-row .title')) === 'Tom de Teste')
  await page.fill('.search', 'outro artista')
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="song-count"]')?.textContent?.startsWith('1 ') &&
      document.querySelector('.song-row .artist')?.textContent === 'Outro Artista'
  )
  check('8. busca por artista', true)
  await page.fill('.search', 'ARTISTA TESTE')
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="song-count"]')?.textContent?.startsWith('1 ')
  )
  await page.fill('.search', 'zzzz-nada')
  await page.waitForSelector('.empty')
  await page.fill('.search', '')
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="song-count"]')?.textContent?.startsWith('5 ')
  )

  // ---------- Reprodução ----------
  await clickSong(page, 'Tom de Teste')
  await waitStatus(page, 'playing')
  check(
    '9. título e artista exibidos',
    (await page.textContent('[data-testid="np-title"]')) === 'Tom de Teste' &&
      (await page.textContent('[data-testid="np-artist"]')) === 'Artista Teste'
  )
  await sleep(1200)
  const a1 = await audioState(page)
  check(
    '10. MP3 reproduz (relógio do áudio avança)',
    !a1.paused && a1.t > 0.8,
    `t=${a1.t.toFixed(2)}`
  )
  const dur = await page.textContent('[data-testid="time-duration"]')
  check('11. duração exibida', dur === '0:12', dur)
  const sync1 = await syncSamples(page, 6)
  check(
    '12. CDG renderiza e acompanha o áudio (cor por segundo)',
    sync1.usable >= 3 && sync1.good === sync1.usable,
    `${sync1.good}/${sync1.usable} amostras`
  )
  const shown = await page.textContent('[data-testid="time-current"]')
  check('13. tempo atual exibido', /^0:0[2-9]$|^0:1\d$/.test(shown), shown)

  await page.click('[data-testid="btn-pause"]')
  await waitStatus(page, 'paused')
  const p1 = await audioState(page)
  await sleep(900)
  const p2 = await audioState(page)
  const s1 = await sample(page)
  await sleep(300)
  const s2 = await sample(page)
  check(
    '14. Pause para áudio e CDG',
    p1.paused && Math.abs(p2.t - p1.t) < 0.05 && s1.px.join() === s2.px.join(),
    `t=${p1.t.toFixed(2)}→${p2.t.toFixed(2)}`
  )

  await page.click('[data-testid="btn-play"]')
  await waitStatus(page, 'playing')
  await sleep(700)
  const r1 = await audioState(page)
  check(
    '15. Continue retoma de onde parou',
    !r1.paused && r1.t > p2.t + 0.4 && r1.t < p2.t + 2,
    `${p2.t.toFixed(2)}→${r1.t.toFixed(2)}`
  )
  const sync2 = await syncSamples(page, 4)
  check(
    '16. sincronismo mantido após pause/continue',
    sync2.good === sync2.usable && sync2.usable >= 1,
    `${sync2.good}/${sync2.usable}`
  )

  // Seek
  await page.evaluate(() => {
    const input = document.querySelector('.seek')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '9')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(500)
  const sk = await syncSamples(page, 2)
  const sa = await audioState(page)
  check(
    '17. seek reposiciona áudio e CDG',
    sa.t >= 9 && sk.good === sk.usable,
    `t=${sa.t.toFixed(2)} ${sk.good}/${sk.usable}`
  )

  // Volume
  await page.evaluate(() => {
    const input = document.querySelector('[data-testid="volume"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '0.35')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  check(
    '18. Volume altera o volume do áudio',
    Math.abs((await audioState(page)).volume - 0.35) < 0.001
  )

  // Tela cheia
  await page.click('[data-testid="btn-fullscreen"]')
  await page
    .waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 5000 })
    .catch(() => {})
  const fs1 = await page.evaluate(() => document.fullscreenElement?.getAttribute('data-testid'))
  check('19. tela cheia entra (stage)', fs1 === 'stage', String(fs1))
  await page.evaluate(() => document.exitFullscreen())
  await page.waitForFunction(() => document.fullscreenElement === null)
  check('20. tela cheia sai', true)

  // Stop
  await page.click('[data-testid="btn-stop"]')
  await waitStatus(page, 'stopped')
  await sleep(200)
  const st = await audioState(page)
  const stPx = await sample(page)
  check(
    '21. Stop para e volta ao início com tela limpa',
    st.paused && st.t === 0 && stPx.px[0] === 0 && stPx.px[1] === 0 && stPx.px[2] === 0,
    `t=${st.t}`
  )
  await page.click('[data-testid="btn-play"]')
  await waitStatus(page, 'playing')
  await sleep(500)
  check('22. Play após Stop reinicia do começo', (await audioState(page)).t < 2)

  // Fim natural: vai para perto do fim
  await page.evaluate(() => {
    document.querySelector('audio').currentTime = 11
  })
  await waitStatus(page, 'stopped', 6000)
  check('23. fim da música leva a Stop (tempo 0)', (await audioState(page)).t === 0)

  // ---------- Erros ----------
  await clickSong(page, 'Mp3 Corrompido')
  await page.waitForSelector('[data-testid="player-error"]', { timeout: 8000 })
  check(
    '24. MP3 corrompido: mensagem amigável, app segue vivo',
    (await page.textContent('[data-testid="player-error"]')).includes(
      'Não foi possível reproduzir esta música.'
    )
  )

  await clickSong(page, 'Cdg Invalido')
  await page.waitForSelector('[data-testid="cdg-error"]', { timeout: 8000 })
  await sleep(500)
  check(
    '25. CDG inválido: mensagem amigável e áudio continua',
    (await page.textContent('[data-testid="cdg-error"]')).includes(
      'Não foi possível exibir os gráficos desta música.'
    ) && !(await audioState(page)).paused
  )

  // Pasta removida: apaga os arquivos e tenta tocar
  const removable = join(library, 'Removivel')
  const { rmSync } = await import('node:fs')
  rmSync(removable, { recursive: true, force: true })
  await clickSong(page, 'Cancao Removivel')
  await page.waitForSelector('[data-testid="player-error"]', { timeout: 8000 })
  const errText = await page.textContent('[data-testid="player-error"]')
  check(
    '26. arquivos removidos: informa indisponibilidade',
    errText.includes('não estão mais disponíveis'),
    errText
  )

  await page.screenshot({ path: join(work, 'screenshot.png') })
  await app.close()

  // ---------- Execução 2: persistência ----------
  ;({ app, page } = await launch())
  await page.waitForFunction(
    () => document.querySelector('[data-testid="song-count"]')?.textContent?.startsWith('5 '),
    null,
    { timeout: 8000 }
  )
  check('27. após reabrir, a biblioteca continua cadastrada (5 músicas)', true)
  await app.close()

  const db = new DatabaseSync(dbPath, { readOnly: true })
  const rows = db.prepare('SELECT COUNT(*) AS n, SUM(play_count) AS plays FROM songs').get()
  const version = db.prepare('PRAGMA user_version').get().user_version
  db.close()
  check(
    '28. SQLite contém as músicas e contador de execuções',
    rows.n === 5 && rows.plays >= 1,
    `songs=${rows.n} plays=${rows.plays} user_version=${version}`
  )

  const logDir = join(userData, 'logs')
  const logFile = readdirSync(logDir).find((f) => f.endsWith('.log'))
  const log = logFile ? readFileSync(join(logDir, logFile), 'utf8') : ''
  check(
    '29. logs criados (inicialização, importação, erros)',
    /Inicializando Karaoke Studio/.test(log) &&
      /Importação concluída/.test(log) &&
      /\[ERROR\] Falha de reprodução de áudio/.test(log) &&
      /\[ERROR\] Falha ao carregar CDG/.test(log) &&
      /Arquivo da música não está mais disponível/.test(log)
  )
} catch (error) {
  failed++
  console.error('FALHA INESPERADA NO E2E:', error)
}

console.log(
  `\nE2E: ${results.filter((r) => r.ok).length}/${results.length} verificações aprovadas${failed ? ` — ${failed} FALHA(S)` : ''}`
)
console.log(`Artefatos: ${work}`)
process.exit(failed ? 1 : 0)
