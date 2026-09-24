import { crc32, deflateRawSync } from 'node:zlib'

/** Construtor de ZIP (stored/deflate) para fixtures e testes. Não faz parte do app. */
export interface ZipFile {
  name: string
  data: Buffer
  /** 0 = armazenado, 8 = deflate (padrão). */
  method?: 0 | 8
}

export function buildZip(files: ZipFile[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const method = file.method ?? 8
    const body = method === 8 ? deflateRawSync(file.data) : file.data
    const crc = crc32(file.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += 30 + name.length + body.length
  }

  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
