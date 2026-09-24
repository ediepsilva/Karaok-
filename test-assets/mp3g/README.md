# Fixture MP3+G de teste

**Origem:** gerado por este projeto (`npm run fixtures`, código em `scripts/`). Não vem de nenhum
repositório externo e não contém música de terceiros.

**Conteúdo:**

- MP3: tons senoidais (um por segundo) codificados com `@breezystack/lamejs`.
- CDG: gráficos sintéticos. A cada segundo `k` a tela é preenchida com uma cor fixa
  (vermelho, verde, azul, amarelo, magenta, ciano, laranja, repetindo) e são desenhados `k+1`
  blocos brancos. Isso permite conferir o sincronismo olhando um pixel e ouvindo a nota.

**Licença:** conteúdo próprio, sem restrições (domínio público / CC0) para uso e redistribuição.

**Finalidade:** testes automatizados (scanner, importação, decodificador, sincronismo) e teste
manual do player. Não é música de verdade: para testar com MP3+G real, veja `TESTING.md`.

**Arquivos:**

| Arquivo                                 | Papel                              |
| --------------------------------------- | ---------------------------------- |
| `Artista Teste - Tom de Teste.mp3/.cdg` | par válido, 12 s                   |
| `Subpasta/Outro Artista - Segunda Musica.mp3/.cdg` | par válido em subpasta, 6 s |
| `Sem Letra - So Audio.mp3`              | MP3 sem CDG (deve ser ignorado)    |
| `Sem Audio - So Grafico.cdg`            | CDG sem MP3 (deve ser ignorado)    |
