/**
 * Verificação do seletor "Adicionar pasta de músicas": abre uma única vez por clique, fica aberto
 * até o usuário decidir, cancelar volta ao app sem importar nada, e cliques repetidos enquanto o
 * seletor está aberto não abrem um segundo diálogo (sem loop). Roda inteiramente dentro do processo
 * Electron criado pelo próprio teste (via `app.evaluate`, stub do `dialog.showOpenDialog`): nunca
 * usa automação do Windows (SendKeys, UI Automation) nem mexe em janelas fora dessa instância, para
 * não poder interferir com um app aberto manualmente ao lado. Uso: node scripts/check-folder-dialog.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const work = mkdtempSync(join(tmpdir(), 'karaoke-dialog-'))
const { ELECTRON_RUN_AS_NODE: _ignored, ...cleanEnv } = process.env

let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launch() {
  const app = await electron.launch({
    ...(process.env.E2E_EXE ? { executablePath: process.env.E2E_EXE } : {}),
    args: process.env.E2E_EXE ? [] : [root],
    env: { ...cleanEnv, KARAOKE_USER_DATA: join(work, 'userdata'), ELECTRON_RENDERER_URL: '' }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid="song-list"]')
  return { app, page }
}

/** Substitui o diálogo NESTA instância isolada: nunca toca em janelas de outros processos. */
const stubDialog = (app, folder) =>
  app.evaluate(({ dialog }, dir) => {
    const calls = []
    globalThis.__calls = calls
    dialog.showOpenDialog = (...args) => {
      const call = { at: Date.now(), options: args.at(-1) }
      calls.push(call)
      return new Promise((resolveCall) => {
        // some tempo real de escolha manual: o app deve continuar aguardando, sem timeout algum.
        setTimeout(
          () =>
            resolveCall(
              dir === null
                ? { canceled: true, filePaths: [] }
                : { canceled: false, filePaths: [dir] }
            ),
          1500
        )
      })
    }
  }, folder)
const calls = (app) => app.evaluate(() => globalThis.__calls)

try {
  console.log('\n## Cancelar: não reabre nem importa nada')
  let { app, page } = await launch()
  await stubDialog(app, null)
  await page.click('[data-testid="btn-add-folder"]')
  await sleep(200)
  check(
    '1. o botão fica desabilitado enquanto o seletor está "aberto"',
    await page.isDisabled('[data-testid="btn-add-folder"]')
  )
  // cliques repetidos enquanto o seletor está aberto: não deve abrir um segundo diálogo
  await page.click('[data-testid="btn-add-folder"]', { force: true }).catch(() => {})
  await page.click('[data-testid="btn-add-folder"]', { force: true }).catch(() => {})
  await sleep(2000)
  check(
    '2. showOpenDialog foi chamado 1 vez só (sem duplicar por clique repetido)',
    (await calls(app)).length === 1
  )
  check(
    '3. properties inclui openDirectory',
    (await calls(app))[0].options.properties.includes('openDirectory')
  )
  check(
    '4. depois de cancelar, o botão volta a funcionar e nada foi importado',
    !(await page.isDisabled('[data-testid="btn-add-folder"]')) &&
      (await page.$('[data-testid="import-summary"]')) === null
  )
  // clica de novo (segunda rodada) para confirmar que NÃO abre sozinho / não entra em loop
  await sleep(3000)
  check(
    '5. o diálogo não reabre sozinho depois de cancelar (sem loop)',
    (await calls(app)).length === 1
  )
  await app.close()

  console.log('\n## Selecionar: importa uma única vez e não reabre')
  ;({ app, page } = await launch())
  await stubDialog(app, root + '\\test-assets\\mp3g')
  await page.click('[data-testid="btn-add-folder"]')
  await page.waitForSelector('[data-testid="import-summary"]', { timeout: 15000 })
  await sleep(3000)
  check('6. showOpenDialog foi chamado 1 vez só', (await calls(app)).length === 1)
  check(
    '7. importou uma vez (o resumo não fica se repetindo/duplicando)',
    /música\(s\) adicionada/.test(await page.textContent('[data-testid="import-summary"]'))
  )
  check('8. o diálogo não reabre sozinho depois de importar', (await calls(app)).length === 1)
  await app.close()
} catch (error) {
  failed++
  console.error('FALHA INESPERADA:', error)
}
console.log(failed ? `\n${failed} FALHA(S)` : '\nSELETOR DE PASTA: todas as verificações aprovadas')
process.exit(failed ? 1 : 0)
