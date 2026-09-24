import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanFolder } from '../src/main/library/scanner'
import { FAKE_MP3, FIXTURE_DIR, makeTempDir, writeFile, writeSongPair } from './helpers'

describe('scanFolder', () => {
  it('encontra pares MP3+CDG na raiz e em subpastas', async () => {
    const root = makeTempDir()
    writeSongPair(join(root, 'Rock Nacional'), 'Capital Inicial - Primeiros Erros')
    writeSongPair(join(root, 'A', 'B', 'C'), 'Artista - Profunda')
    writeSongPair(root, 'Raiz - Musica')
    const result = await scanFolder(root)
    expect(result.pairs.map((p) => p.baseName).sort()).toEqual([
      'Artista - Profunda',
      'Capital Inicial - Primeiros Erros',
      'Raiz - Musica'
    ])
    expect(result.issues).toEqual([])
  })

  it('MP3 sem CDG é ignorado e informado', async () => {
    const root = makeTempDir()
    writeFile(join(root, 'so-audio.mp3'), FAKE_MP3)
    const result = await scanFolder(root)
    expect(result.pairs).toHaveLength(0)
    expect(result.mp3WithoutCdg).toEqual([join(root, 'so-audio.mp3')])
  })

  it('CDG sem MP3 é ignorado e informado', async () => {
    const root = makeTempDir()
    writeFile(join(root, 'so-grafico.cdg'), Buffer.alloc(240))
    const result = await scanFolder(root)
    expect(result.pairs).toHaveLength(0)
    expect(result.cdgWithoutMp3).toEqual([join(root, 'so-grafico.cdg')])
  })

  it('casa extensões sem diferenciar maiúsculas e nome do par', async () => {
    const root = makeTempDir()
    writeFile(join(root, 'Song.MP3'), FAKE_MP3)
    writeFile(join(root, 'song.CDG'), Buffer.alloc(2400))
    expect((await scanFolder(root)).pairs).toHaveLength(1)
  })

  it('não casa arquivos de pastas diferentes', async () => {
    const root = makeTempDir()
    writeFile(join(root, 'a', 'x.mp3'), FAKE_MP3)
    writeFile(join(root, 'b', 'x.cdg'), Buffer.alloc(2400))
    const result = await scanFolder(root)
    expect(result.pairs).toHaveLength(0)
    expect(result.mp3WithoutCdg).toHaveLength(1)
    expect(result.cdgWithoutMp3).toHaveLength(1)
  })

  it('MP3 corrompido (cabeçalho inválido) e CDG vazio viram problemas, não pares', async () => {
    const root = makeTempDir()
    writeFile(join(root, 'ruim.mp3'), 'isto não é um mp3')
    writeFile(join(root, 'ruim.cdg'), Buffer.alloc(2400))
    writeFile(join(root, 'vazio.mp3'), FAKE_MP3)
    writeFile(join(root, 'vazio.cdg'), Buffer.alloc(0))
    const result = await scanFolder(root)
    expect(result.pairs).toHaveLength(0)
    expect(result.issues).toHaveLength(2)
  })

  it('pasta inexistente vira problema sem lançar exceção', async () => {
    const result = await scanFolder(join(makeTempDir(), 'nao-existe'))
    expect(result.pairs).toHaveLength(0)
    expect(result.issues).toHaveLength(1)
  })

  it('estima a duração pelo tamanho do CDG (300 pacotes/s × 24 bytes)', async () => {
    const root = makeTempDir()
    writeFile(join(root, 'x.mp3'), FAKE_MP3)
    writeFile(join(root, 'x.cdg'), Buffer.alloc(7200 * 5))
    expect((await scanFolder(root)).pairs[0]?.duration).toBe(5)
  })

  it('reconhece o fixture MP3+G do repositório', async () => {
    const result = await scanFolder(FIXTURE_DIR)
    expect(result.pairs.map((p) => p.baseName).sort()).toEqual([
      'Artista Teste - Tom de Teste',
      'Outro Artista - Segunda Musica'
    ])
    expect(result.mp3WithoutCdg).toHaveLength(1)
    expect(result.cdgWithoutMp3).toHaveLength(1)
    expect(result.issues).toEqual([])
  })
})
