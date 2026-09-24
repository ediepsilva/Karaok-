/**
 * Gera os fixtures MP3+G de teste em test-assets/mp3g/. Conteúdo 100% sintético (tons senoidais e
 * gráficos CD+G gerados por código): sem música de terceiros, livre para redistribuição.
 * Uso: npm run fixtures
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildFixtureCdg, buildFixtureMp3 } from './lib/fixture-media'

const root = join(process.cwd(), 'test-assets', 'mp3g')
mkdirSync(join(root, 'Subpasta'), { recursive: true })

const write = (relative: string, data: Buffer): void => {
  writeFileSync(join(root, relative), data)
  console.log(`${relative} (${data.length} bytes)`)
}

write('Artista Teste - Tom de Teste.mp3', buildFixtureMp3(12))
write('Artista Teste - Tom de Teste.cdg', buildFixtureCdg(12))
write(join('Subpasta', 'Outro Artista - Segunda Musica.mp3'), buildFixtureMp3(6))
write(join('Subpasta', 'Outro Artista - Segunda Musica.cdg'), buildFixtureCdg(6))
// Órfãos: exercitam o tratamento de MP3 sem CDG e CDG sem MP3.
write('Sem Letra - So Audio.mp3', buildFixtureMp3(2))
write('Sem Audio - So Grafico.cdg', buildFixtureCdg(2))
