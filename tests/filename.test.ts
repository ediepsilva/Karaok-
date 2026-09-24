import { describe, expect, it } from 'vitest'
import { normalizeForSearch, parseSongName } from '../src/main/library/filename'

describe('parseSongName', () => {
  it('separa "Artista - Título"', () => {
    expect(parseSongName('Capital Inicial - Primeiros Erros')).toEqual({
      artist: 'Capital Inicial',
      title: 'Primeiros Erros'
    })
  })

  it('mantém hífens extras no título', () => {
    expect(parseSongName('Artista - Título - Ao Vivo')).toEqual({
      artist: 'Artista',
      title: 'Título - Ao Vivo'
    })
  })

  it('descarta código de catálogo inicial', () => {
    expect(parseSongName('SC1234-01 - Legião Urbana - Tempo Perdido')).toEqual({
      artist: 'Legião Urbana',
      title: 'Tempo Perdido'
    })
    expect(parseSongName('12345 - Djavan - Oceano')).toEqual({ artist: 'Djavan', title: 'Oceano' })
  })

  it('sem separador, usa o nome do arquivo como título', () => {
    expect(parseSongName('Musica Sem Artista')).toEqual({ artist: '', title: 'Musica Sem Artista' })
  })

  it('não trata número isolado como artista', () => {
    expect(parseSongName('01 - Canção')).toEqual({ artist: '', title: '01 - Canção' })
  })

  it('aceita "Artista-Título" compacto com um único hífen', () => {
    expect(parseSongName('Queen-Bicycle')).toEqual({ artist: 'Queen', title: 'Bicycle' })
  })

  it('não descarta música com hífens internos de palavra composta', () => {
    expect(parseSongName('Guns-N-Roses')).toEqual({ artist: '', title: 'Guns-N-Roses' })
  })

  it('converte underscores e colapsa espaços', () => {
    expect(parseSongName('Artista_X  -  Titulo_Y')).toEqual({
      artist: 'Artista X',
      title: 'Titulo Y'
    })
  })

  it('nunca devolve título vazio', () => {
    expect(parseSongName('   ').title).not.toBe('')
    expect(parseSongName(' - ').title).not.toBe('')
  })
})

describe('normalizeForSearch', () => {
  it('remove acentos e caixa', () => {
    expect(normalizeForSearch('  Coração   DE  Estudante ')).toBe('coracao de estudante')
  })
})
