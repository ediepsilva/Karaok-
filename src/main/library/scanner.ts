import { open, readdir, stat } from 'node:fs/promises'
import { basename, extname, join, parse } from 'node:path'
import type { ImportIssue } from '@shared/types'

export interface SongPair {
  baseName: string
  mp3Path: string
  cdgPath: string
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

/**
 * Percorre a pasta e subpastas procurando pares NOME.mp3 + NOME.cdg (mesmo diretório,
 * comparação sem diferenciar maiúsculas). Não segue links simbólicos.
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

    const group: DirEntries = { mp3: new Map(), cdg: new Map() }
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
          mp3Path,
          cdgPath,
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
  }

  result.pairs.sort((a, b) => a.mp3Path.localeCompare(b.mp3Path))
  return result
}
