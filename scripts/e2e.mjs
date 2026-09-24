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
cpSync(join(root, 'test-assets', 'mp3g-zip'), join(library, 'Zipados'), { recursive: true })

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

// Se ELECTRON_RUN_AS_NODE estiver no ambiente (ocorreu em ferramentas iniciadas por extensões do
// VS Code), o Electron roda como Node puro e o app não abre; por isso a variável é removida.
const { ELECTRON_RUN_AS_NODE: _ignored, ...cleanEnv } = process.env

async function launch() {
  const app = await electron.launch({
    // E2E_EXE=caminho do .exe testa o app empacotado; sem ele, testa out/ via Electron do projeto.
    ...(process.env.E2E_EXE ? { executablePath: process.env.E2E_EXE } : {}),
    // A câmera virtual do Chromium substitui a webcam; SEM a flag que pula o pedido de permissão,
    // para exercitar a política de permissões do app.
    args: [...(process.env.E2E_EXE ? [] : [root]), '--use-fake-device-for-media-stream'],
    env: { ...cleanEnv, KARAOKE_USER_DATA: userData, ELECTRON_RENDERER_URL: '' }
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
    count.startsWith('6 '),
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
    (await page.textContent('[data-testid="song-count"]')).startsWith('6 ')
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
    document.querySelector('[data-testid="song-count"]')?.textContent?.startsWith('6 ')
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
    !a1.paused && a1.t > 0.5,
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
  await waitStatus(page, 'stopped', 6000).catch(() => {})
  check(
    '23. fim da música leva a Stop (tempo 0)',
    (await status(page)) === 'stopped' && (await audioState(page)).t === 0
  )

  // ---------- Fase 2 ----------
  const setRange = (selector, value) =>
    page.evaluate(
      ([sel, v]) => {
        const input = document.querySelector(sel)
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(input, String(v))
        input.dispatchEvent(new Event('input', { bubbles: true }))
      },
      [selector, value]
    )
  const waitCount = (testid, prefix) =>
    page.waitForFunction(
      ([id, p]) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.startsWith(p),
      [testid, prefix],
      { timeout: 8000 }
    )
  const npTitle = () => page.textContent('[data-testid="np-title"]')
  const rowOf = (title) => `.song-item:has-text("${title}")`

  // ZIP
  check(
    '30. ZIP importado aparece na biblioteca com a etiqueta ZIP',
    (await page.textContent(`${rowOf('Musica Zipada')} .tag`)) === 'ZIP'
  )
  await clickSong(page, 'Musica Zipada')
  await waitStatus(page, 'playing')
  await sleep(800)
  const zipAudio = await audioState(page)
  check(
    '31. música dentro do ZIP toca (áudio avança)',
    !zipAudio.paused && zipAudio.t > 0.4 && Math.abs(zipAudio.duration - 8) < 0.5,
    `t=${zipAudio.t.toFixed(2)} dur=${zipAudio.duration.toFixed(2)}`
  )
  const zipSync = await syncSamples(page, 4)
  check(
    '32. CDG do ZIP renderiza e acompanha o áudio',
    zipSync.usable >= 2 &&
      zipSync.good === zipSync.usable &&
      (await page.$('[data-testid="cdg-error"]')) === null,
    `${zipSync.good}/${zipSync.usable}`
  )
  await setRange('.seek', 6)
  await sleep(500)
  const zipSeek = await syncSamples(page, 2)
  check(
    '33. seek dentro do ZIP (Range em memória) funciona',
    (await audioState(page)).t >= 6 && zipSeek.good === zipSeek.usable,
    `${zipSeek.good}/${zipSeek.usable}`
  )
  await page.click('[data-testid="btn-stop"]')
  await waitStatus(page, 'stopped')

  // Metadados, busca por gênero/código e favoritos
  await page.click(`${rowOf('Tom de Teste')} [data-testid="btn-edit"]`)
  await page.fill('[data-testid="edit-genre"]', 'Sertanejo')
  await page.fill('[data-testid="edit-language"]', 'Português')
  await page.fill('[data-testid="edit-code"]', 'ZZ-77')
  await page.click('[data-testid="edit-save"]')
  await page.waitForSelector('[data-testid="edit-dialog"]', { state: 'detached' })
  await page.fill('.search', 'sertanejo')
  await waitCount('song-count', '1 ')
  check(
    '34. metadados editados; busca por gênero',
    (await page.textContent('.song-row .title')).includes('Tom de Teste')
  )
  await page.fill('.search', 'zz-77')
  await waitCount('song-count', '1 ')
  check('35. busca por código', (await page.textContent('.song-row .title')).includes('ZZ-77'))
  await page.fill('.search', '')
  await waitCount('song-count', '6 ')

  await page.click(`${rowOf('Tom de Teste')} [data-testid="btn-edit"]`)
  await page.fill('[data-testid="edit-title"]', '   ')
  await page.click('[data-testid="edit-save"]')
  await page.waitForSelector('[data-testid="edit-dialog"] [role="alert"]')
  check(
    '36. título vazio é recusado com mensagem',
    (await page.textContent('[data-testid="edit-dialog"] [role="alert"]')).includes('título')
  )
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="edit-dialog"]', { state: 'detached' })

  await page.click(`${rowOf('Tom de Teste')} [data-testid="btn-favorite"]`)
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="btn-favorite"][aria-pressed="true"]')
  )
  await page.check('[data-testid="favorites-only"]')
  await waitCount('song-count', '1 ')
  check(
    '37. favoritar e filtrar “só favoritas”',
    (await page.textContent('.song-row .title')).includes('Tom de Teste')
  )
  await page.uncheck('[data-testid="favorites-only"]')
  await waitCount('song-count', '6 ')

  // Fila: nome obrigatório, ordem, reordenar
  const enqueueBtn = (title) => `${rowOf(title)} [data-testid="btn-enqueue"]`
  check(
    '38. adicionar à fila exige nome do cantor',
    await page.isDisabled(enqueueBtn('Segunda Musica'))
  )
  await page.fill('[data-testid="singer-input"]', 'Ana')
  await page.click(enqueueBtn('Segunda Musica'))
  await page.waitForSelector('[data-testid="flash"]')
  await page.fill('[data-testid="singer-input"]', 'Bruno')
  await page.click(enqueueBtn('Musica Zipada'))
  await page.click('[data-testid="tab-queue"]')
  await waitCount('queue-count', '2 ')
  const order = () =>
    page.$$eval('[data-testid="queue-singer"]', (els) => els.map((e) => e.textContent))
  check(
    '39. fila mostra cantores na ordem de entrada',
    JSON.stringify(await order()) === '["Ana","Bruno"]',
    JSON.stringify(await order())
  )
  await page.click('.queue-item:nth-child(2) [data-testid="queue-up"]')
  await page.waitForFunction(
    () => document.querySelector('[data-testid="queue-singer"]')?.textContent === 'Bruno'
  )
  check('40. mover para cima reordena a fila', JSON.stringify(await order()) === '["Bruno","Ana"]')
  await page.click('.queue-item:nth-child(1) [data-testid="queue-down"]')
  await page.waitForFunction(
    () => document.querySelector('[data-testid="queue-singer"]')?.textContent === 'Ana'
  )
  check('41. mover para baixo devolve a ordem', JSON.stringify(await order()) === '["Ana","Bruno"]')

  // Tocar a fila: 1º item → avança sozinho para o 2º → fim
  await page.click('.queue-item:nth-child(1) [data-testid="queue-play"]')
  await waitStatus(page, 'playing')
  check(
    '42. “Tocar agora” inicia o item e mostra o cantor',
    (await npTitle()) === 'Segunda Musica' &&
      (await page.textContent('.np-singer')).includes('Ana') &&
      (await page.getAttribute('.queue-item:nth-child(1)', 'data-status')) === 'playing'
  )
  await setRange('.seek', 5.2)
  await page.waitForFunction(
    () => document.querySelector('[data-testid="np-title"]')?.textContent === 'Musica Zipada',
    null,
    { timeout: 8000 }
  )
  await waitStatus(page, 'playing')
  await waitCount('queue-count', '1 ')
  check(
    '43. ao terminar, a próxima da fila toca sozinha (cantor Bruno)',
    (await page.textContent('.np-singer')).includes('Bruno') && (await audioState(page)).t < 3
  )
  await setRange('.seek', 7.2)
  await waitStatus(page, 'stopped', 8000)
  await waitCount('queue-count', '0 ')
  check(
    '44. fim da última música esvazia a fila e para',
    (await status(page)) === 'stopped' && (await page.isDisabled('[data-testid="btn-next"]'))
  )

  // Próxima (pular) e remover
  await page.click('[data-testid="tab-library"]')
  await page.fill('[data-testid="singer-input"]', 'Carla')
  await page.click(enqueueBtn('Segunda Musica'))
  await page.click(enqueueBtn('Musica Zipada'))
  await page.click(enqueueBtn('Tom de Teste'))
  await page.click('[data-testid="tab-queue"]')
  await waitCount('queue-count', '3 ')
  await page.click('.queue-item:nth-child(1) [data-testid="queue-play"]')
  await waitStatus(page, 'playing')
  await page.click('[data-testid="btn-next"]')
  await page.waitForFunction(
    () => document.querySelector('[data-testid="np-title"]')?.textContent === 'Musica Zipada',
    null,
    { timeout: 8000 }
  )
  await waitCount('queue-count', '2 ')
  const skipped = await waitStatus(page, 'playing').then(
    () => 'playing',
    async () => status(page)
  )
  check(
    '45. “Próxima” pula para o item seguinte da fila e ele toca',
    skipped === 'playing',
    skipped
  )
  await page.click('.queue-item:nth-child(2) [data-testid="queue-remove"]')
  await waitCount('queue-count', '1 ')
  check(
    '46. remover item da fila',
    (await page.$$eval('.queue-item .song', (els) => els.map((e) => e.textContent))).every(
      (t) => !t.includes('Tom de Teste')
    )
  )
  await page.click('[data-testid="btn-stop"]')

  // Histórico
  await page.click('[data-testid="tab-history"]')
  await page.waitForSelector('.history-item')
  const hist = await page.$$eval('.history-item', (els) => els.map((e) => e.textContent))
  check(
    '47. histórico lista execuções com o cantor',
    hist.length >= 5 &&
      hist.some((t) => t.includes('Ana')) &&
      hist.some((t) => t.includes('Bruno')) &&
      hist.some((t) => t.includes('Carla')),
    `${hist.length} entradas`
  )

  // Deixa um item na fila para testar persistência
  await page.click('[data-testid="tab-library"]')
  await page.fill('[data-testid="singer-input"]', 'Diego')
  await page.click(enqueueBtn('Tom de Teste'))
  await page.click('[data-testid="tab-queue"]')
  await waitCount('queue-count', '2 ')
  await page.click('[data-testid="tab-library"]')
  await page.fill('[data-testid="singer-input"]', '')

  // ---------- Fase 3: câmera do cantor (câmera virtual do Chromium) ----------
  const camBtn = '[data-testid="btn-camera"]'
  const camOn = () => page.getAttribute(camBtn, 'aria-pressed')
  const camInfo = () =>
    page.evaluate(() => {
      const v = document.querySelector('[data-testid="camera-video"]')
      const stage = document.querySelector('[data-testid="stage"]')
      const canvas = document.querySelector('[data-testid="cdg-canvas"]')
      const r = (el) => {
        const b = el.getBoundingClientRect()
        return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }
      }
      return {
        w: v.videoWidth,
        t: v.currentTime,
        paused: v.paused,
        hasStream: !!v.srcObject,
        transform: getComputedStyle(v).transform,
        display: getComputedStyle(v).display,
        video: r(v),
        stage: r(stage),
        canvas: r(canvas)
      }
    })
  const camFrameColors = () =>
    page.evaluate(() => {
      const v = document.querySelector('[data-testid="camera-video"]')
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 36
      const ctx = c.getContext('2d')
      ctx.drawImage(v, 0, 0, 64, 36)
      const d = ctx.getImageData(0, 0, 64, 36).data
      const colors = new Set()
      for (let i = 0; i < d.length; i += 4)
        colors.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`)
      return colors.size
    })

  await clickSong(page, 'Tom de Teste')
  await waitStatus(page, 'playing')
  await sleep(600)
  check(
    '53. câmera nunca liga sozinha (padrão “Ligar ao tocar” desligado)',
    (await camOn()) === 'false' && (await page.$('[data-testid="camera-error"]')) === null
  )
  check(
    '54. câmeras listadas para escolha',
    (await page.$$eval('[data-testid="camera-device"] option', (o) => o.length)) >= 1 &&
      !(await page.isDisabled('[data-testid="camera-device"]'))
  )

  await page.click(camBtn)
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="btn-camera"]')?.getAttribute('aria-pressed') === 'true',
    null,
    { timeout: 10000 }
  )
  await page.waitForFunction(
    () => document.querySelector('[data-testid="camera-video"]')?.videoWidth > 0,
    null,
    { timeout: 10000 }
  )
  const c1 = await camInfo()
  await sleep(700)
  const c2 = await camInfo()
  check(
    '55. câmera liga com permissão só de vídeo e exibe imagem ao vivo',
    c1.w > 0 && !c2.paused && c2.t > c1.t && c2.hasStream,
    `${c1.w}px t=${c2.t.toFixed(2)}`
  )
  check('56. imagem da câmera tem conteúdo (não é quadro vazio)', (await camFrameColors()) > 3)
  const label = await page.$eval(
    '[data-testid="camera-device"]',
    (s) => s.options[s.selectedIndex]?.textContent ?? ''
  )
  check(
    '57. nome real da câmera aparece depois da permissão',
    label.length > 0 && !/^Câmera \d+$/.test(label),
    label
  )
  const camSync = await syncSamples(page, 5)
  check(
    '58. CDG segue sincronizado com a câmera ligada',
    camSync.usable >= 2 && camSync.good === camSync.usable,
    `${camSync.good}/${camSync.usable}`
  )

  const pip = await camInfo()
  check(
    '59. posição “sobre o canto”: câmera pequena sobre o CDG',
    pip.video.w < pip.stage.w * 0.4 &&
      pip.video.l > pip.canvas.l &&
      pip.video.r <= pip.stage.r + 1 &&
      pip.video.b <= pip.stage.b + 1,
    `${Math.round(pip.video.w)}x${Math.round(pip.video.h)} em ${Math.round(pip.stage.w)}px`
  )
  await page.selectOption('[data-testid="camera-layout"]', 'side')
  await sleep(300)
  const side = await camInfo()
  check(
    '60. posição “ao lado”: câmera e CDG não se sobrepõem',
    side.video.l >= side.canvas.r - 2 &&
      side.video.w > side.stage.w * 0.25 &&
      side.display === 'block',
    `video.l=${Math.round(side.video.l)} canvas.r=${Math.round(side.canvas.r)}`
  )
  const sideSync = await syncSamples(page, 3)
  check(
    '61. CDG continua correto no modo lado a lado',
    sideSync.good === sideSync.usable && sideSync.usable >= 1,
    `${sideSync.good}/${sideSync.usable}`
  )
  await page.selectOption('[data-testid="camera-layout"]', 'pip')

  check(
    '62. espelhar: ligado por padrão e alternável',
    (await camInfo()).transform.startsWith('matrix(-1') &&
      (await page.uncheck('[data-testid="camera-mirror"]'),
      await sleep(100),
      (await camInfo()).transform === 'none')
  )
  await page.check('[data-testid="camera-mirror"]')

  await page.click('[data-testid="btn-fullscreen"]')
  await page
    .waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 5000 })
    .catch(() => {})
  const fsCam = await page.evaluate(() => {
    const v = document.querySelector('[data-testid="camera-video"]')
    const b = v.getBoundingClientRect()
    return {
      inside: document.fullscreenElement?.contains(v) ?? false,
      visible: b.width > 50 && b.height > 30
    }
  })
  await page.evaluate(() => document.exitFullscreen())
  await page.waitForFunction(() => document.fullscreenElement === null)
  check(
    '63. em tela cheia a câmera continua junto do CDG',
    fsCam.inside && fsCam.visible,
    JSON.stringify(fsCam)
  )

  await clickSong(page, 'Segunda Musica')
  await waitStatus(page, 'playing')
  await sleep(600)
  const c3 = await camInfo()
  await sleep(500)
  const c4 = await camInfo()
  check('64. trocar de música não derruba a câmera', (await camOn()) === 'true' && c4.t > c3.t)

  check(
    '65. microfone segue bloqueado (só vídeo é liberado)',
    await page.evaluate(() =>
      navigator.mediaDevices.getUserMedia({ audio: true }).then(
        () => false,
        (e) => e.name === 'NotAllowedError'
      )
    )
  )

  await page.evaluate(() => {
    window.__camTrack = document
      .querySelector('[data-testid="camera-video"]')
      .srcObject.getVideoTracks()[0]
  })
  await page.click(camBtn)
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="btn-camera"]')?.getAttribute('aria-pressed') === 'false'
  )
  const off = await page.evaluate(() => ({
    src: document.querySelector('[data-testid="camera-video"]').srcObject,
    track: window.__camTrack.readyState
  }))
  check(
    '66. desligar libera a câmera de verdade (luz apaga)',
    off.src === null && off.track === 'ended'
  )

  await page.check('[data-testid="camera-auto"]')
  await sleep(1200)
  check(
    '67a. marcar “Ligar ao tocar” com música tocando não liga na hora (vale da próxima)',
    (await camOn()) === 'false'
  )
  await clickSong(page, 'Tom de Teste')
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="btn-camera"]')?.getAttribute('aria-pressed') === 'true',
    null,
    { timeout: 10000 }
  )
  check('67. “Ligar ao tocar” liga a câmera quando a música começa', true)
  await page.click(camBtn)
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="btn-camera"]')?.getAttribute('aria-pressed') === 'false'
  )
  await sleep(1500)
  check('68. desligada à mão, não religa sozinha na mesma música', (await camOn()) === 'false')
  await page.uncheck('[data-testid="camera-auto"]')

  // Câmera escolhida que sumiu: cai para a padrão com aviso (preferência inválida guardada)
  await page.evaluate(() =>
    localStorage.setItem(
      'karaoke.camera',
      JSON.stringify({
        deviceId: 'camera-que-nao-existe',
        layout: 'pip',
        mirror: true,
        autoStart: false
      })
    )
  )
  await page.reload()
  await page.waitForSelector('[data-testid="song-list"]')
  await page.click(camBtn)
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="btn-camera"]')?.getAttribute('aria-pressed') === 'true',
    null,
    { timeout: 10000 }
  )
  const notice = await page.textContent('[data-testid="camera-notice"]').catch(() => '')
  check('69. câmera escolhida ausente: usa a padrão e avisa', /padrão/.test(notice ?? ''), notice)
  await page.selectOption('[data-testid="camera-layout"]', 'side')
  await page.click(camBtn)
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="btn-camera"]')?.getAttribute('aria-pressed') === 'false'
  )

  // Falha real do getUserMedia (sem câmera / sem permissão / em uso): mensagem clara, app segue vivo
  const failWith = async (name) => {
    await page.evaluate((n) => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('simulado', n))
    }, name)
    await page.click(camBtn)
    await page.waitForSelector('[data-testid="camera-error"]', { timeout: 8000 })
    return page.textContent('[data-testid="camera-error"]')
  }
  const noCam = await failWith('NotFoundError')
  check(
    '72. sem câmera: mensagem clara e o botão não fica “ligado”',
    /Nenhuma câmera encontrada/.test(noCam) && (await camOn()) === 'false',
    noCam
  )
  const denied = await failWith('NotAllowedError')
  check(
    '73. sem permissão do Windows: mensagem orienta onde liberar',
    /Privacidade/.test(denied),
    denied
  )
  const busy = await failWith('NotReadableError')
  check('74. câmera em uso por outro programa: mensagem clara', /em uso/.test(busy), busy)
  check(
    '75. falha da câmera não afeta a música (player continua funcional)',
    (await status(page)) !== 'error' && (await page.$('[data-testid="player-error"]')) === null
  )
  await page.reload()
  await page.waitForSelector('[data-testid="song-list"]')

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

  // Manutenção da biblioteca pela interface
  await page.click('[data-testid="tab-library"]')
  page.on('dialog', (dialog) => void dialog.accept())
  await page.click('text=Reescanear pastas')
  await page.waitForFunction(() =>
    /pasta\(s\) reescaneada/.test(
      document.querySelector('[data-testid="library-notice"]')?.textContent ?? ''
    )
  )
  check('51. “Reescanear pastas” funciona pela interface', true)
  await page.click('text=Limpar indisponíveis')
  await page.waitForFunction(() =>
    /1 música\(s\) indisponível/.test(
      document.querySelector('[data-testid="library-notice"]')?.textContent ?? ''
    )
  )
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="song-count"]')?.textContent?.startsWith('5 ')
  )
  check('52. “Limpar indisponíveis” remove só a música sem arquivos (6 → 5)', true)

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
  await page.click('[data-testid="tab-queue"]')
  await page.waitForFunction(
    () => document.querySelector('[data-testid="queue-count"]')?.textContent?.startsWith('2 '),
    null,
    { timeout: 8000 }
  )
  const restoredQueue = await page.$$eval('.queue-item', (els) =>
    els.map((e) => [
      e.getAttribute('data-status'),
      e.querySelector('[data-testid="queue-singer"]').textContent
    ])
  )
  check(
    '48. após reabrir, a fila continua (ninguém “tocando”)',
    JSON.stringify(restoredQueue) ===
      JSON.stringify([
        ['waiting', 'Carla'],
        ['waiting', 'Diego']
      ]),
    JSON.stringify(restoredQueue)
  )
  await page.click('[data-testid="tab-history"]')
  await page.waitForSelector('.history-item')
  check(
    '49. após reabrir, o histórico continua',
    (await page.locator('.history-item').count()) >= 5
  )
  await page.click('[data-testid="tab-library"]')
  await page.check('[data-testid="favorites-only"]')
  await page.waitForFunction(
    () => document.querySelector('[data-testid="song-count"]')?.textContent?.startsWith('1 '),
    null,
    { timeout: 8000 }
  )
  await page.uncheck('[data-testid="favorites-only"]')
  await page.fill('.search', 'zz-77')
  await page.waitForFunction(
    () => document.querySelector('[data-testid="song-count"]')?.textContent?.startsWith('1 '),
    null,
    { timeout: 8000 }
  )
  check('50. após reabrir, favorito e metadados editados continuam', true)
  check(
    '70. após reabrir, a posição da câmera continua e ela NÃO liga sozinha',
    (await page.inputValue('[data-testid="camera-layout"]')) === 'side' &&
      (await page.getAttribute('[data-testid="btn-camera"]', 'aria-pressed')) === 'false'
  )
  await app.close()

  const db = new DatabaseSync(dbPath, { readOnly: true })
  const rows = db.prepare('SELECT COUNT(*) AS n, SUM(play_count) AS plays FROM songs').get()
  const version = db.prepare('PRAGMA user_version').get().user_version
  db.close()
  check(
    '28. SQLite contém as músicas e contador de execuções',
    rows.n === 5 && rows.plays >= 1 && version === 2,
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
  check(
    '71. log registra a câmera ligada e a permissão de microfone negada',
    /Câmera ligada/.test(log) && /Permissão negada/.test(log)
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
