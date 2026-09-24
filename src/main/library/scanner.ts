import { open, readdir, stat } from 'node:fs/promises'
import { basename, extname, join, parse, posix } from 'node:path'
import type { ImportIssue, SongSource } from '@shared/types'
import { listZip, ZipFormatError } from './zip-reader'

export interface SongPair {
  baseName: string
  source: SongSource
  /** Para `zip`, mp3Path e cdgPath são o próprio arquivo .zip. */
  mp3Path: string
  cdgPath: string
  zipMp3Entry: string
  zipCdgEntry: string
  /** Duração estimada (segundos): o CDG tem 300 pacotes de 24 bytes por segundo. */
  duration: number
  folderName: string
}

export interface ScanResult {
  pairs: SongPair[]
  mp3WithoutCdg: string[]
  cdgWithoutMp3: string[]
  issues: ImportIssue[]
}

export const CDG_BYTES_PER_SECOND = 7200

interface DirEntries {
  mp3: Map<string, string>
  cdg: Map<string, string>
  zip: string[]
}

/** Verifica cabeçalho de MP3: tag ID3 ou sincronismo de frame MPEG. */
export async function looksLikeMp3(path: string): Promise<boolean> {
  const handle = await open(path, 'r')
  try {
    const buf = Buffer.alloc(4)
    const { bytesRead } = await handle.read(buf, 0, 4, 0)
    if (bytesRead < 3) return false
    if (buf.toString('latin1', 0, 3) === 'ID3') return true
    return bytesRead === 4 && buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0
  } finally {
    await handle.close()
  }
}

/** Entradas com ".." ou caminho absoluto são ignoradas (nunca extraímos, mas não confiamos no nome). */
const isSafeEntryName = (name: string): boolean =>
  !name.startsWith('/') && !/^[A-Za-z]:/.test(name) && !name.split(/[\\/]/).includes('..')

/** Procura um par NOME.mp3 + NOME.cdg (mesma pasta interna) dentro do ZIP. */
async function scanZip(zipPath: string, folderName: string, result: ScanResult): Promise<void> {
  try {
    const entries = (await listZip(zipPath)).filter((e) => isSafeEntryName(e.name))
    const mp3 = new Map<string, (typeof entries)[number]>()
    const cdg = new Map<string, (typeof entries)[number]>()
    for (const entry of entries) {
      const key = posix.join(posix.dirname(entry.name), parse(entry.name).name).toLowerCase()
      const ext = extname(entry.name).toLowerCase()
      if (ext === '.mp3') mp3.set(key, entry)
      else if (ext === '.cdg') cdg.set(key, entry)
    }
    for (const [key, mp3Entry] of [...mp3].sort(([a], [b]) => a.localeCompare(b))) {
      const cdgEntry = cdg.get(key)
      if (!cdgEntry) continue
      if (mp3Entry.size === 0 || cdgEntry.size < 24) {
        result.issues.push({ path: zipPath, reason: 'ZIP com MP3 vazio ou CDG vazio/truncado' })
        return
      }
      result.pairs.push({
        baseName: parse(zipPath).name,
        source: 'zip',
        mp3Path: zipPath,
        cdgPath: zipPath,
        zipMp3Entry: mp3Entry.name,
        zipCdgEntry: cdgEntry.name,
        duration: Math.round(cdgEntry.size / CDG_BYTES_PER_SECOND),
        folderName
      })
      return // um ZIP = uma música
    }
    result.issues.push({ path: zipPath, reason: 'ZIP sem um par MP3+CDG' })
  } catch (error) {
    const reason =
      error instanceof ZipFormatError
        ? error.message
        : `Erro ao ler ZIP: ${(error as Error).message}`
    result.issues.push({ path: zipPath, reason })
  }
}

/**
 * Percorre a pasta e subpastas procurando pares NOME.mp3 + NOME.cdg (mesmo diretório,
 * comparação sem diferenciar maiúsculas) e arquivos .zip com um par dentro. Não segue links
 * simbólicos.
 */
export async function scanFolder(root: string): Promise<ScanResult> {
  const result: ScanResult = { pairs: [], mp3WithoutCdg: [], cdgWithoutMp3: [], issues: [] }
  const pending: string[] = [root]

  while (pending.length > 0) {
    const dir = pending.pop() as string
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      result.issues.push({ path: dir, reason: `Pasta inacessível: ${(error as Error).message}` })
      continue
    }

    const group: DirEntries = { mp3: new Map(), cdg: new Map(), zip: [] }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        pending.push(full)
        continue
      }
      if (!entry.isFile()) continue
      const ext = extname(entry.name).toLowerCase()
      const key = parse(entry.name).name.toLowerCase()
      if (ext === '.mp3') group.mp3.set(key, full)
      else if (ext === '.cdg') group.cdg.set(key, full)
      else if (ext === '.zip') group.zip.push(full)
    }

    for (const [key, mp3Path] of group.mp3) {
      const cdgPath = group.cdg.get(key)
      if (!cdgPath) {
        result.mp3WithoutCdg.push(mp3Path)
        continue
      }
      try {
        const [mp3Stat, cdgStat] = await Promise.all([stat(mp3Path), stat(cdgPath)])
        if (mp3Stat.size === 0 || !(await looksLikeMp3(mp3Path))) {
          result.issues.push({ path: mp3Path, reason: 'MP3 vazio ou com cabeçalho inválido' })
          continue
        }
        if (cdgStat.size < 24) {
          result.issues.push({ path: cdgPath, reason: 'CDG vazio ou truncado' })
          continue
        }
        result.pairs.push({
          baseName: parse(mp3Path).name,
          source: 'files',
          mp3Path,
          cdgPath,
          zipMp3Entry: '',
          zipCdgEntry: '',
          duration: Math.round(cdgStat.size / CDG_BYTES_PER_SECOND),
          folderName: basename(dir)
        })
      } catch (error) {
        result.issues.push({
          path: mp3Path,
          reason: `Erro ao ler arquivos: ${(error as Error).message}`
        })
      }
    }
    for (const [key, cdgPath] of group.cdg) {
      if (!group.mp3.has(key)) result.cdgWithoutMp3.push(cdgPath)
    }
    for (const zipPath of group.zip) await scanZip(zipPath, basename(dir), result)
  }

  result.pairs.sort((a, b) => a.mp3Path.localeCompare(b.mp3Path))
  return result
}
