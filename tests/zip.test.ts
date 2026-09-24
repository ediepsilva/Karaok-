import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { buildFixtureCdg } from '../scripts/lib/fixture-media'
import { buildZip } from '../scripts/lib/zip-builder'
import { openMedia, ZipEntryCache } from '../src/main/library/media-source'
import { scanFolder } from '../src/main/library/scanner'
import { listZip, readZipEntry, ZipFormatError } from '../src/main/library/zip-reader'
import { FAKE_MP3, makeTempDir, writeFile } from './helpers'

const CDG = buildFixtureCdg(4)

function makeZip(name: string, files: { name: string; data: Buffer; method?: 0 | 8 }[]): string {
  const dir = makeTempDir()
  const path = join(dir, name)
  writeFileSync(path, buildZip(files))
  return path
}

describe('zip-reader', () => {
  it('lista entradas (ignorando diretórios) e lê deflate e stored com CRC válido', async () => {
    const path = makeZip('a.zip', [
      { name: 'pasta/', data: Buffer.alloc(0), method: 0 },
      { name: 'musica.mp3', data: FAKE_MP3, method: 0 },
      { name: 'musica.cdg', data: CDG, method: 8 }
    ])
    const entries = await listZip(path)
    expect(entries.map((e) => e.name)).toEqual(['musica.mp3', 'musica.cdg'])
    expect(await readZipEntry(path, entries[0]!)).toEqual(FAKE_MP3)
    expect(await readZipEntry(path, entries[1]!)).toEqual(CDG)
  })

  it('rejeita arquivo que não é ZIP, vazio ou truncado', async () => {
    const dir = makeTempDir()
    await expect(
      listZip(writeFile(join(dir, 'x.zip'), 'texto qualquer sem estrutura zip!'))
    ).rejects.toBeInstanceOf(ZipFormatError)
    await expect(listZip(writeFile(join(dir, 'y.zip'), ''))).rejects.toBeInstanceOf(ZipFormatError)
    const good = buildZip([{ name: 'a.mp3', data: FAKE_MP3 }])
    await expect(
      listZip(writeFile(join(dir, 'z.zip'), good.subarray(0, good.length - 10)))
    ).rejects.toBeInstanceOf(ZipFormatError)
  })

  it('detecta dados corrompidos (CRC não confere)', async () => {
    const zip = buildZip([{ name: 'a.cdg', data: CDG, method: 0 }])
    const dataStart = 30 + 'a.cdg'.length
    zip[dataStart + 10] = (zip[dataStart + 10] ?? 0) ^ 0xff
    const path = writeFile(join(makeTempDir(), 'c.zip'), zip)
    const [entry] = await listZip(path)
    await expect(readZipEntry(path, entry!)).rejects.toThrow(/CRC/)
  })

  it('protege contra zip bomb: tamanho declarado menor que o real', async () => {
    const real = Buffer.alloc(100_000, 7)
    const zip = buildZip([{ name: 'a.bin', data: real }])
    // adultera o tamanho descompactado no diretório central (offset 24 do registro central)
    const centralStart = zip.length - 22 - (46 + 'a.bin'.length)
    zip.writeUInt32LE(10, centralStart + 24)
    const path = writeFile(join(makeTempDir(), 'bomb.zip'), zip)
    const [entry] = await listZip(path)
    await expect(readZipEntry(path, entry!)).rejects.toBeInstanceOf(ZipFormatError)
  })

  it('recusa entradas gigantes e métodos de compactação desconhecidos', async () => {
    const path = makeZip('m.zip', [{ name: 'a.bin', data: FAKE_MP3 }])
    const [entry] = await listZip(path)
    await expect(readZipEntry(path, { ...entry!, size: 300 * 1024 * 1024 })).rejects.toThrow(
      /grande demais/
    )
    await expect(readZipEntry(path, { ...entry!, method: 14 })).rejects.toThrow(/não suportado/)
  })

  it('não confunde deflate manual com armazenado', async () => {
    const data = Buffer.from('a'.repeat(5000))
    const zip = buildZip([{ name: 'x.txt', data }])
    expect(zip.includes(deflateRawSync(data))).toBe(true)
    const path = writeFile(join(makeTempDir(), 'd.zip'), zip)
    const [entry] = await listZip(path)
    expect(entry!.compressedSize).toBeLessThan(entry!.size)
  })
})

describe('scanner com ZIP', () => {
  it('reconhece ZIP com MP3+CDG (até em subpasta interna) como uma música', async () => {
    const root = makeTempDir()
    writeFileSync(
      join(root, 'Artista Zip - Musica Zipada.zip'),
      buildZip([
        { name: 'interno/Faixa.MP3', data: FAKE_MP3 },
        { name: 'interno/faixa.cdg', data: CDG }
      ])
    )
    const result = await scanFolder(root)
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]).toMatchObject({
      source: 'zip',
      baseName: 'Artista Zip - Musica Zipada',
      zipMp3Entry: 'interno/Faixa.MP3',
      zipCdgEntry: 'interno/faixa.cdg',
      duration: 4
    })
    expect(result.issues).toEqual([])
  })

  it('ZIP sem par, corrompido, com entradas perigosas ou vazias vira problema', async () => {
    const root = makeTempDir()
    writeFileSync(join(root, 'so-mp3.zip'), buildZip([{ name: 'a.mp3', data: FAKE_MP3 }]))
    writeFileSync(join(root, 'lixo.zip'), 'não sou um zip')
    writeFileSync(
      join(root, 'perigoso.zip'),
      buildZip([
        { name: '../fora.mp3', data: FAKE_MP3 },
        { name: '../fora.cdg', data: CDG }
      ])
    )
    writeFileSync(
      join(root, 'vazio.zip'),
      buildZip([
        { name: 'a.mp3', data: Buffer.alloc(0) },
        { name: 'a.cdg', data: CDG }
      ])
    )
    const result = await scanFolder(root)
    expect(result.pairs).toHaveLength(0)
    expect(result.issues).toHaveLength(4)
  })

  it('ZIP convive com pares soltos na mesma pasta', async () => {
    const root = makeTempDir()
    writeFile(join(root, 'solto.mp3'), FAKE_MP3)
    writeFile(join(root, 'solto.cdg'), CDG)
    writeFileSync(
      join(root, 'zipado.zip'),
      buildZip([
        { name: 'z.mp3', data: FAKE_MP3 },
        { name: 'z.cdg', data: CDG }
      ])
    )
    const result = await scanFolder(root)
    expect(result.pairs.map((p) => p.source).sort()).toEqual(['files', 'zip'])
  })
})

describe('media-source', () => {
  it('serve entradas de ZIP por intervalo de bytes e usa cache', async () => {
    const path = makeZip('m.zip', [
      { name: 'a.mp3', data: FAKE_MP3 },
      { name: 'a.cdg', data: CDG }
    ])
    const location = {
      source: 'zip' as const,
      mp3Path: path,
      cdgPath: path,
      zipMp3Entry: 'a.mp3',
      zipCdgEntry: 'a.cdg'
    }
    const cache = new ZipEntryCache(2)
    const media = await openMedia(location, 'cdg', cache)
    expect(media.size).toBe(CDG.length)
    expect(Buffer.from(media.read(0, 23) as Buffer)).toEqual(CDG.subarray(0, 24))
    const again = await cache.get(path, 'a.cdg')
    expect(again).toBe(await cache.get(path, 'a.cdg')) // mesma instância = cache
  })

  it('entrada inexistente no ZIP falha com erro claro', async () => {
    const path = makeZip('m.zip', [{ name: 'a.mp3', data: FAKE_MP3 }])
    await expect(new ZipEntryCache().get(path, 'nao-existe.cdg')).rejects.toThrow(/não encontrada/)
  })
})
