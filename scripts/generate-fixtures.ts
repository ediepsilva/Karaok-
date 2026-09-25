/**
 * Gera os fixtures MP3+G de teste em test-assets/mp3g/. Conteúdo 100% sintético (tons senoidais e
 * gráficos CD+G gerados por código): sem música de terceiros, livre para redistribuição.
 * Uso: npm run fixtures
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildFixtureCdg, buildFixtureMp3 } from './lib/fixture-media'
import { TrackBuilder, buildMidi, melodyMidi } from './lib/midi-builder'
import { buildZip } from './lib/zip-builder'
import { concat, silence, toWav, voiceTone, whiteNoise } from './lib/voice-signals'

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

// MP3+G compactado (Fase 2): um ZIP = uma música.
const zipDir = join(process.cwd(), 'test-assets', 'mp3g-zip')
mkdirSync(zipDir, { recursive: true })
const zip = buildZip([
  { name: 'Musica Zipada.mp3', data: buildFixtureMp3(8) },
  { name: 'Musica Zipada.cdg', data: buildFixtureCdg(8) }
])
writeFileSync(join(zipDir, 'Zip Artista - Musica Zipada.zip'), zip)
console.log(`mp3g-zip/Zip Artista - Musica Zipada.zip (${zip.length} bytes)`)

// Microfone falso (Fase 4A): WAVs conhecidos que o Chromium reproduz como se fossem o microfone
// (--use-file-for-fake-audio-capture). 16 kHz mono, 12 s, repetem em loop. Sinais sintéticos.
{
  const voiceDir = join(process.cwd(), 'test-assets', 'voice')
  mkdirSync(voiceDir, { recursive: true })
  const rate = 16000
  const notes = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88]
  const files: Record<string, Float32Array> = {
    // A4 estável e contínuo: "cantor perfeito" para o modo básico e leitura de frequência/nota
    'steady-a440.wav': voiceTone(440, 12, rate, { db: -20 }),
    // uma nota por segundo (mesma sequência do fixture MP3), com pequenas pausas de respiração
    'melody.wav': concat(
      ...Array.from({ length: 12 }, (_, i) =>
        concat(voiceTone(notes[i % notes.length]!, 0.85, rate, { db: -18 }), silence(0.15, rate))
      )
    ),
    'silence.wav': silence(12, rate),
    'noise.wav': whiteNoise(12, rate, -22, 42)
  }
  for (const [name, signal] of Object.entries(files)) {
    const wav = toWav(signal, rate)
    writeFileSync(join(voiceDir, name), wav)
    console.log(`voice/${name} (${wav.length} bytes)`)
  }
}

// Melodia de referência (Fase 4B): músicas de 8 s com MIDI/KAR ao lado. Ficam em test-assets/melody/,
// separadas de mp3g/ para não misturar com as músicas que testam a avaliação básica.
{
  const dir = join(process.cwd(), 'test-assets', 'melody')
  mkdirSync(dir, { recursive: true })
  const mp3 = buildFixtureMp3(8)
  const cdg = buildFixtureCdg(8)
  const song = (name: string, extension: string, midi: Buffer): void => {
    writeFileSync(join(dir, `${name}.mp3`), mp3)
    writeFileSync(join(dir, `${name}.cdg`), cdg)
    writeFileSync(join(dir, `${name}.${extension}`), midi)
    console.log(`melody/${name}.${extension}`)
  }
  const line = (pitch: number): [number, number, number][] =>
    Array.from({ length: 8 }, (_, i) => [pitch, i, 0.9])

  // A4 em todas as notas: bate com o WAV de tom estável (steady-a440.wav)
  song('Ref Artista - Nota La', 'mid', melodyMidi(line(69)))
  // C4 com letra KAR: o mesmo WAV (A4) fica 3 semitons fora do tom (transposição detectada)
  song(
    'Ref Artista - Nota Do',
    'kar',
    melodyMidi(line(60), {
      kar: true,
      lyrics: [
        [0, '/Ola '],
        [2, 'mun'],
        [4, 'do'],
        [6, '\\Fim']
      ]
    })
  )
  // arquivo de melodia corrompido: o app deve avisar e cair para a avaliação básica
  song('Ref Artista - Melodia Quebrada', 'mid', Buffer.from('isto nao e um arquivo MIDI valido'))
  // duas trilhas candidatas (A4 e C5): permite testar a troca de trilha
  {
    const tempo = new TrackBuilder().tempo(0, 500000)
    const first = new TrackBuilder().name('Melody')
    const second = new TrackBuilder().name('Harmonia Aguda')
    for (let i = 0; i < 8; i++) {
      first.noteSec(i, 0.9, 69)
      second.noteSec(i, 0.9, 72)
    }
    song('Ref Artista - Duas Trilhas', 'mid', buildMidi([tempo, first, second]))
  }
}
