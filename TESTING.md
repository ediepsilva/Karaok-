# Testes

## Automatizados

```bash
npm run typecheck   # TypeScript strict (main + renderer)
npm run lint        # ESLint
npm run format:check
npm test            # Vitest: testes unitários e de integração (SQLite e disco reais)
npm run e2e         # build + abre o Electron de verdade e usa a interface
```

`npm test` cobre: parser de nomes, scanner (subpastas, pares, órfãos, arquivos inválidos), banco
(criação, migrações, duplicados, busca, persistência, corrupção), serviço de biblioteca,
decodificador CD+G (memory/border preset, tile block, XOR, scroll, paleta, transparência,
sincronismo por tempo, seek), estados do player e logger.

`npm run e2e` (`scripts/e2e.mjs`) usa perfil e biblioteca temporários e verifica: inicialização,
criação do SQLite, importação pela interface, busca, reprodução, sincronismo CDG × áudio (cor de
um pixel por segundo), Pause/Continue/Stop/Seek/Volume, tela cheia, MP3 corrompido, CDG inválido,
arquivos removidos, persistência após fechar/abrir e logs.

**Limite:** nenhum script consegue confirmar que o áudio é _audível_ nem que a imagem está
_bonita_. Isso é o checklist manual abaixo.

## Fixture

`test-assets/mp3g/` (gerado por `npm run fixtures`; origem e licença em
`test-assets/mp3g/README.md`).

## Testar com um MP3+G real e legal

1. Baixe uma amostra gratuita oficial (por exemplo, as amostras gratuitas da Zoom Karaoke).
2. Coloque `nome.mp3` e `nome.cdg` (mesmo nome) em `test-assets/manual/` ou em qualquer pasta.
   Se vier em `.zip`, extraia antes (ZIP será suportado na Fase 2).
3. `npm run dev` (ou o app gerado por `npm run dist`), clique em **Adicionar pasta de músicas**.
4. Siga o checklist.

## Checklist manual

- [ ] abrir a aplicação
- [ ] adicionar pasta; a música aparece com título e artista
- [ ] clicar na música: começa a tocar
- [ ] áudio audível
- [ ] letra/gráfico do CDG visível
- [ ] letras trocam junto com a música (sincronismo correto do começo ao fim)
- [ ] Pause: áudio e gráfico congelam
- [ ] Play: retoma do mesmo ponto
- [ ] arrastar a barra de posição: áudio e gráfico acompanham
- [ ] Stop: volta ao início, tela limpa
- [ ] Volume altera o som
- [ ] Tela cheia entra e sai (Esc)
- [ ] fechar e abrir: a música continua cadastrada
- [ ] apagar/renomear a pasta e clicar na música: mensagem amigável, sem travar

## Resultados

Ver o relatório final da Fase 1 (preenchido após a execução).
