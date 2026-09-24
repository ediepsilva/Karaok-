import { open } from 'node:fs/promises'
import { crc32, inflateRawSync } from 'node:zlib'

/**
 * Leitor mínimo de ZIP (sem dependências) para MP3+G compactado. Lê o diretório central sem
 * carregar o arquivo inteiro e só descompacta uma entrada sob demanda, em memória: nada é
 * extraído para o disco (sem risco de "zip slip") e os tamanhos são limitados (zip bomb).
 * Não suporta ZIP64 nem entradas criptografadas: ambos geram ZipFormatError.
 */

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipFormatError'
  }
}

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  crc: number
  offset: number
}

export const MAX_ENTRY_BYTES = 200 * 1024 * 1024
const MAX_DIRECTORY_BYTES = 16 * 1024 * 1024
const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

export async function listZip(path: string): Promise<ZipEntry[]> {
  const handle = await open(path, 'r')
  try {
    const { size: fileSize } = await handle.stat()
    if (fileSize < 22) throw new ZipFormatError('Arquivo ZIP vazio ou truncado.')

    const tailLength = Math.min(fileSize, 22 + 0xffff)
    const tail = Buffer.alloc(tailLength)
    await handle.read(tail, 0, tailLength, fileSize - tailLength)
    let eocd = -1
    for (let i = tailLength - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new ZipFormatError('Não é um arquivo ZIP válido.')

    const total = tail.readUInt16LE(eocd + 10)
    const directorySize = tail.readUInt32LE(eocd + 12)
    const directoryOffset = tail.readUInt32LE(eocd + 16)
    if (total === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      throw new ZipFormatError('ZIP64 não é suportado.')
    }
    if (directorySize > MAX_DIRECTORY_BYTES || directoryOffset + directorySize > fileSize) {
      throw new ZipFormatError('Diretório do ZIP inválido.')
    }

    const directory = Buffer.alloc(directorySize)
    await handle.read(directory, 0, directorySize, directoryOffset)

    const entries: ZipEntry[] = []
    let pos = 0
    for (let n = 0; n < total; n++) {
      if (pos + 46 > directory.length || directory.readUInt32LE(pos) !== CENTRAL_SIGNATURE) {
        throw new ZipFormatError('Diretório do ZIP corrompido.')
      }
      const flags = directory.readUInt16LE(pos + 8)
      const nameLength = directory.readUInt16LE(pos + 28)
      const extraLength = directory.readUInt16LE(pos + 30)
      const commentLength = directory.readUInt16LE(pos + 32)
      const nameEnd = pos + 46 + nameLength
      if (nameEnd > directory.length) throw new ZipFormatError('Diretório do ZIP corrompido.')
      const nameBytes = directory.subarray(pos + 46, nameEnd)
      const entry: ZipEntry = {
        name: nameBytes.toString(flags & 0x0800 ? 'utf8' : 'latin1'),
        method: directory.readUInt16LE(pos + 10),
        crc: directory.readUInt32LE(pos + 16),
        compressedSize: directory.readUInt32LE(pos + 20),
        size: directory.readUInt32LE(pos + 24),
        offset: directory.readUInt32LE(pos + 42)
      }
      if (flags & 0x0001) throw new ZipFormatError('ZIP criptografado não é suportado.')
      if (!entry.name.endsWith('/')) entries.push(entry)
      pos = nameEnd + extraLength + commentLength
    }
    return entries
  } finally {
    await handle.close()
  }
}

/** Descompacta uma entrada em memória, validando tamanho e CRC. */
export async function readZipEntry(path: string, entry: ZipEntry): Promise<Buffer> {
  if (entry.size > MAX_ENTRY_BYTES || entry.compressedSize > MAX_ENTRY_BYTES) {
    throw new ZipFormatError('Entrada do ZIP grande demais.')
  }
  const handle = await open(path, 'r')
  try {
    const header = Buffer.alloc(30)
    const { bytesRead } = await handle.read(header, 0, 30, entry.offset)
    if (bytesRead < 30 || header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      throw new ZipFormatError('Cabeçalho local do ZIP inválido.')
    }
    const dataStart = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
    const compressed = Buffer.alloc(entry.compressedSize)
    const read = await handle.read(compressed, 0, entry.compressedSize, dataStart)
    if (read.bytesRead < entry.compressedSize) throw new ZipFormatError('ZIP truncado.')

    let data: Buffer
    if (entry.method === 0) {
      data = compressed
    } else if (entry.method === 8) {
      try {
        data = inflateRawSync(compressed, { maxOutputLength: Math.max(entry.size, 1) })
      } catch {
        throw new ZipFormatError('Dados compactados corrompidos no ZIP.')
      }
    } else {
      throw new ZipFormatError(`Método de compactação ${entry.method} não suportado.`)
    }
    if (data.length !== entry.size) throw new ZipFormatError('Tamanho da entrada não confere.')
    if (crc32(data) !== entry.crc) throw new ZipFormatError('CRC da entrada não confere.')
    return data
  } finally {
    await handle.close()
  }
}
