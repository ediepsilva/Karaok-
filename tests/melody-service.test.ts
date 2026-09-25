import { rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { TrackBuilder, buildMidi, melodyMidi } from '../scripts/lib/midi-builder'
import { buildZip } from '../scripts/lib/zip-builder'
import { currentVersion, migrate, openDatabase } from '../src/main/db/database'
import { FolderRepository } from '../src/main/db/folder-repository'
import { migrations } from '../src/main/db/migrations'
import { SongRepository } from '../src/main/db/song-repository'
import { LibraryService } from '../src/main/library/library-service'
import { scanFolder } from '../src/main/library/scanner'
import { MelodyError, MelodyService } from '../src/main/melody/melody-service'
import { FAKE_MP3, makeTempDir, memoryLogger, writeFile, writeSongPair } from './helpers'
import { buildFixtureCdg } from '../scripts/lib/fixture-media'

const NOTES: [number, number, number][] = Array.from({ length: 12 }, (_, i) => [
  60 + (i % 5),
  i,
  0.8
])

function setup() {
  const logger = memoryLogger()
  const db = openDatabase(join(makeTempDir(), 'k.db'), logger)
  const repo = new SongRepository(db)
  return {
    db,
    repo,
    logger,
    library: new LibraryService(repo, new FolderRepository(db), logger),
    melody: new MelodyService(repo, logger)
  }
}

describe('detecção de MIDI/KAR ao lado da música', () => {
  it('reconhece .mid, .midi e .kar de mesmo nome (sem diferenciar maiúsculas)', async () => {
    const root = makeTempDir()
    writeSongPair(root, 'A - Um')
    writeSongPair(root, 'B - Dois')
    writeSongPair(root, 'C - Tres')
    writeSongPair(root, 'D - Sem')
    writeFile(join(root, 'A - Um.mid'), melodyMidi(NOTES))
    writeFile(join(root, 'B - Dois.MIDI'), melodyMidi(NOTES))
    writeFile(join(root, 'C - Tres.Kar'), melodyMidi(NOTES))
    const pairs = (await scanFolder(root)).pairs
    const byName = Object.fromEntries(
      pairs.map((p) => [p.baseName, p.melodyPath.split(/[\\/]/).pop()])
    )
    expect(byName).toEqual({
      'A - Um': 'A - Um.mid',
      'B - Dois': 'B - Dois.MIDI',
      'C - Tres': 'C - Tres.Kar',
      'D - Sem': ''
    })
  })

  it('com .kar e .mid do mesmo nome, o .kar vence (traz a letra)', async () => {
    const root = makeTempDir()
    writeSongPair(root, 'A - Um')
    writeFile(join(root, 'A - Um.mid'), melodyMidi(NOTES))
    writeFile(join(root, 'A - Um.kar'), melodyMidi(NOTES))
    const [pair] = (await scanFolder(root)).pairs
    expect(pair!.melodyPath.endsWith('.kar')).toBe(true)
  })

  it('MIDI sem música (órfão) e MIDI de outro nome não são associados', async () => {
    const root = makeTempDir()
    writeSongPair(root, 'A - Um')
    writeFile(join(root, 'Outro Nome.mid'), melodyMidi(NOTES))
    const result = await scanFolder(root)
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]!.melodyPath).toBe('')
  })

  it('dentro do ZIP: prefere o MIDI de mesmo nome do MP3; senão o primeiro; senão nenhum', async () => {
    const root = makeTempDir()
    const cdg = buildFixtureCdg(3)
    writeFileSync(
      join(root, 'a.zip'),
      buildZip([
        { name: 'faixa.mp3', data: FAKE_MP3 },
        { name: 'faixa.cdg', data: cdg },
        { name: 'outro.mid', data: melodyMidi(NOTES) },
        { name: 'faixa.mid', data: melodyMidi(NOTES) }
      ])
    )
    writeFileSync(
      join(root, 'b.zip'),
      buildZip([
        { name: 'x.mp3', data: FAKE_MP3 },
        { name: 'x.cdg', data: cdg },
        { name: 'qualquer.kar', data: melodyMidi(NOTES) }
      ])
    )
    writeFileSync(
      join(root, 'c.zip'),
      buildZip([
        { name: 'y.mp3', data: FAKE_MP3 },
        { name: 'y.cdg', data: cdg }
      ])
    )
    const byZip = Object.fromEntries(
      (await scanFolder(root)).pairs.map((p) => [p.baseName, p.melodyEntry])
    )
    expect(byZip).toEqual({ a: 'faixa.mid', b: 'qualquer.kar', c: '' })
  })
})

describe('banco: migração 3 e biblioteca', () => {
  it('a migração 2 → 3 preserva as músicas e cria as novas colunas/tabela', () => {
    const db = new DatabaseSync(':memory:')
    migrate(
      db,
      migrations.filter((m) => m.version <= 2)
    )
    db.exec(`INSERT INTO songs (title, artist, mp3_path, cdg_path, date_added, title_norm, artist_norm)
             VALUES ('Antiga', 'Artista', 'a.mp3', 'a.cdg', 'x', 'antiga', 'artista')`)
    expect(currentVersion(db)).toBe(2)
    expect(migrate(db)).toBe(3)
    const row = db.prepare('SELECT title, melody_path, melody_entry FROM songs').get() as Record<
      string,
      unknown
    >
    expect(row).toMatchObject({ title: 'Antiga', melody_path: '', melody_entry: '' })
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).toContain('melody_choices')
    db.close()
  })

  it('importar marca a música com melodia (hasMelody/melodyFormat) e conta no resumo', async () => {
    const { library } = setup()
    const root = makeTempDir()
    writeSongPair(root, 'A - Um')
    writeSongPair(root, 'B - Dois')
    writeFile(join(root, 'A - Um.kar'), melodyMidi(NOTES))
    const result = await library.importFolder(root)
    expect(result.withMelody).toBe(1)
    const songs = library.list()
    expect(songs.find((s) => s.title === 'Um')).toMatchObject({
      hasMelody: true,
      melodyFormat: 'kar'
    })
    expect(songs.find((s) => s.title === 'Dois')).toMatchObject({
      hasMelody: false,
      melodyFormat: null
    })
  })

  it('reimportar depois de adicionar um MIDI liga a melodia à música já cadastrada (sem duplicar)', async () => {
    const { library } = setup()
    const root = makeTempDir()
    writeSongPair(root, 'A - Um')
    await library.importFolder(root)
    expect(library.list()[0]!.hasMelody).toBe(false)
    writeFile(join(root, 'A - Um.mid'), melodyMidi(NOTES))
    const second = await library.importFolder(root)
    expect(second).toMatchObject({ added: 0, duplicates: 1, withMelody: 1 })
    expect(library.list()).toHaveLength(1)
    expect(library.list()[0]).toMatchObject({ hasMelody: true, melodyFormat: 'midi' })
  })

  it('a escolha de trilha some junto com a música (cascata)', async () => {
    const { library, repo, db } = setup()
    const root = makeTempDir()
    writeSongPair(root, 'A - Um')
    await library.importFolder(root)
    const id = library.list()[0]!.id
    repo.setMelodyChoice(id, 1)
    expect(repo.getMelodyChoice(id)).toBe(1)
    repo.deleteMany([id])
    expect((db.prepare('SELECT COUNT(*) AS n FROM melody_choices').get() as { n: number }).n).toBe(
      0
    )
  })
})

describe('MelodyService', () => {
  async function withSong(midi: Buffer | null, name = 'A - Um.mid') {
    const ctx = setup()
    const root = makeTempDir()
    writeSongPair(root, 'A - Um')
    if (midi) writeFile(join(root, name), midi)
    await ctx.library.importFolder(root)
    return { ...ctx, root, id: ctx.library.list()[0]!.id, midiPath: join(root, name) }
  }

  function multiTrack(): Buffer {
    const tempo = new TrackBuilder().tempo(0, 500000)
    const bass = new TrackBuilder().name('Bass')
    const melody = new TrackBuilder().name('Melody')
    const words = new TrackBuilder().name('Words').lyric(0, 'la', 0x05).lyric(960, 'lá', 0x05)
    for (let i = 0; i < 20; i++) {
      bass.noteSec(i * 0.5, 0.4, 40, { channel: 1 })
      melody.noteSec(i * 0.5, 0.4, 62 + (i % 5), { channel: 0 })
    }
    return buildMidi([tempo, bass, melody, words])
  }

  it('sem MIDI/KAR devolve null (avaliação básica)', async () => {
    const { melody, id } = await withSong(null)
    await expect(melody.get(id)).resolves.toBeNull()
  })

  it('lê o arquivo, escolhe a trilha da melodia e devolve as notas em segundos', async () => {
    const { melody, id } = await withSong(multiTrack())
    const info = (await melody.get(id))!
    expect(info.format).toBe('midi')
    expect(info.fileName).toBe('A - Um.mid')
    expect(info.tracks.map((t) => t.name).sort()).toEqual(['Bass', 'Melody'])
    expect(info.selectedTrack).toBe(2)
    expect(info.selectionIsManual).toBe(false)
    expect(info.tracks.find((t) => t.index === 2)!.suggested).toBe(true)
    expect(info.notes).toHaveLength(20)
    expect(info.notes[3]).toMatchObject({ midi: 65 })
    expect(info.notes[3]!.start).toBeCloseTo(1.5, 3)
    expect(info.lyricCount).toBe(2)
    expect(info.durationSec).toBeCloseTo(9.9, 1)
  })

  it('o usuário pode trocar a trilha; a escolha é guardada e marcada como manual', async () => {
    const { melody, id } = await withSong(multiTrack())
    const info = (await melody.setTrack(id, 1))!
    expect(info.selectedTrack).toBe(1)
    expect(info.selectionIsManual).toBe(true)
    expect(info.notes.every((n) => n.midi === 40)).toBe(true)
    const again = (await melody.get(id))!
    expect(again.selectedTrack).toBe(1)
  })

  it('rejeita trilha inválida, inexistente ou percussão', async () => {
    const tempo = new TrackBuilder().tempo(0, 500000)
    const melody = new TrackBuilder().name('Melody')
    const drums = new TrackBuilder().name('Drums')
    for (let i = 0; i < 20; i++) {
      melody.noteSec(i * 0.5, 0.4, 62 + (i % 5))
      drums.noteSec(i * 0.25, 0.1, 36, { channel: 9 })
    }
    const { melody: service, id } = await withSong(buildMidi([tempo, melody, drums]))
    await expect(service.setTrack(id, 2)).rejects.toThrow(/não pode ser usada/)
    await expect(service.setTrack(id, 99)).rejects.toThrow(/não pode ser usada/)
    await expect(service.setTrack(id, -1)).rejects.toBeInstanceOf(MelodyError)
    await expect(service.setTrack(id, 1.5)).rejects.toBeInstanceOf(MelodyError)
    await expect(service.setTrack(id, '1')).rejects.toBeInstanceOf(MelodyError)
    await expect(service.setTrack(id, 1)).resolves.not.toBeNull()
  })

  it('setTrack em música sem melodia falha com mensagem clara', async () => {
    const { melody, id } = await withSong(null)
    await expect(melody.setTrack(id, 1)).rejects.toThrow(/não tem melodia/)
  })

  it('arquivo de melodia inválido: erro com o nome do arquivo (o app usa a avaliação básica)', async () => {
    const { melody, id, logger } = await withSong(Buffer.from('isto não é MIDI, é só texto'))
    await expect(melody.get(id)).rejects.toThrow(/Não foi possível ler a melodia \(A - Um\.mid\)/)
    expect(logger.entries.some((e) => e.level === 'WARN' && /inválida/.test(e.message))).toBe(true)
  })

  it('MIDI sem trilha utilizável (só percussão/poucas notas): notas vazias', async () => {
    const d = new TrackBuilder().name('Drums')
    for (let i = 0; i < 20; i++) d.noteSec(i * 0.25, 0.1, 36, { channel: 9 })
    const { melody, id } = await withSong(buildMidi([new TrackBuilder().tempo(0, 500000), d]))
    const info = (await melody.get(id))!
    expect(info.selectedTrack).toBeNull()
    expect(info.notes).toEqual([])
  })

  it('arquivo apagado depois: erro claro', async () => {
    const { melody, id, midiPath } = await withSong(multiTrack())
    rmSync(midiPath)
    await expect(melody.get(id)).rejects.toBeInstanceOf(MelodyError)
  })

  it('reflete alterações no arquivo (cache por data e tamanho)', async () => {
    const { melody, id, midiPath } = await withSong(melodyMidi(NOTES))
    expect((await melody.get(id))!.notes).toHaveLength(12)
    writeFileSync(midiPath, melodyMidi(NOTES.slice(0, 9)))
    const future = new Date(Date.now() + 5000)
    utimesSync(midiPath, future, future)
    expect((await melody.get(id))!.notes).toHaveLength(9)
  })

  it('lê a melodia de dentro do ZIP', async () => {
    const ctx = setup()
    const root = makeTempDir()
    writeFileSync(
      join(root, 'Cantor Zip - Musica.zip'),
      buildZip([
        { name: 'x.mp3', data: FAKE_MP3 },
        { name: 'x.cdg', data: buildFixtureCdg(12) },
        { name: 'x.kar', data: melodyMidi(NOTES, { kar: true, lyrics: [[0, '/Oi']] }) }
      ])
    )
    await ctx.library.importFolder(root)
    const song = ctx.library.list()[0]!
    expect(song).toMatchObject({ hasMelody: true, melodyFormat: 'kar', source: 'zip' })
    const info = (await ctx.melody.get(song.id))!
    expect(info.format).toBe('kar')
    expect(info.notes).toHaveLength(12)
    expect(info.lyricCount).toBe(1)
  })

  it('melodia monofônica: notas sobrepostas viram uma linha só', async () => {
    const t = new TrackBuilder().name('Melody')
    for (let i = 0; i < 12; i++) {
      t.noteSec(i, 0.9, 60)
      t.noteSec(i + 0.5, 0.9, 67) // sobreposta e mais aguda
    }
    const { melody, id } = await withSong(buildMidi([new TrackBuilder().tempo(0, 500000), t]))
    const notes = (await melody.get(id))!.notes
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i]!.start).toBeGreaterThanOrEqual(
        notes[i - 1]!.start + notes[i - 1]!.duration - 1e-6
      )
    }
  })
})
