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
      title: 'Tempo Perdido',
      code: 'SC1234-01'
    })
    expect(parseSongName('12345 - Djavan - Oceano')).toEqual({
      artist: 'Djavan',
      title: 'Oceano',
      code: '12345'
    })
  })

  it('separa o código numérico do FIM do nome (padrão de lojas de karaokê)', () => {
    expect(parseSongName('Raca Negra - Cheia de manias (versao 2019) - 80026')).toEqual({
      artist: 'Raca Negra',
      title: 'Cheia de manias (versao 2019)',
      code: '80026'
    })
    // só dois pedaços: o número faz parte do título
    expect(parseSongName('Banda - 1979')).toEqual({ artist: 'Banda', title: '1979' })
    // número curto no fim não é código
    expect(parseSongName('A - B - 12')).toEqual({ artist: 'A', title: 'B - 12' })
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
