# Karaoke Studio

Aplicativo de karaokê para Windows que toca músicas **MP3+G** (`.mp3` + `.cdg`). Estado atual:
**Fases 1 e 2** (fundação, player, biblioteca avançada com ZIP/metadados/favoritos e fila de cantores). Veja [ROADMAP.md](ROADMAP.md) para as próximas fases e
[TESTING.md](TESTING.md) para os testes.

## Tecnologias

Electron 44 · React 19 · TypeScript (strict) · electron-vite · SQLite (`node:sqlite`, embutido no
Node/Electron, sem dependência nativa) · Vitest · ESLint · Prettier.

Decodificador CD+G próprio (sem dependências), o que evita questões de licença.

## Requisitos

Windows 10/11, Node.js 22.13 ou superior (testado com 24), Git.

## Instalação e execução

```bash
npm install
node node_modules/electron/install.js   # só se o binário do Electron não tiver sido baixado
npm run dev        # desenvolvimento
npm run build      # compila para out/
npm start          # roda o build
npm run dist       # gera o app em release/win-unpacked/
```

## Como usar

1. **Adicionar pasta de músicas** e escolha a raiz da sua coleção. As subpastas são percorridas.
2. Cada `nome.mp3` com `nome.cdg` no mesmo diretório vira uma música. MP3 sem CDG (e CDG sem MP3)
   são ignorados e contados no resumo. Reimportar não duplica.
3. Artista e título vêm do nome do arquivo (`Artista - Título`, com código de catálogo inicial
   descartado). Se não der para interpretar, o nome do arquivo vira o título.
4. Pesquise por título ou artista (sem distinguir acentos/caixa) e clique numa música para tocar.

## Biblioteca avançada (Fase 2)

- **ZIP MP3+G**: a importação reconhece arquivos `.zip` que contenham `nome.mp3` + `nome.cdg` (até em subpasta interna). Nada é extraído para o disco; os nomes das entradas são validados e o tamanho é limitado.
- **Pastas lembradas** e **Reescanear pastas**: traz só as músicas novas, sem duplicar. Pastas que sumiram são informadas.
- **Editar** (✎): título, artista, gênero, idioma e código. A busca cobre título, artista, gênero e código.
- **Favoritos** (★) com filtro “Só favoritas”.
- **Fila**: informe o **nome do cantor**, use ＋ na música; reordene com ↑ ↓, remova ou toque na hora. Ao fim de uma música, a próxima da fila toca sozinha; **Próxima** pula. A fila persiste ao fechar o app.
- **Histórico**: cada execução guarda música e cantor; dá para tocar de novo ou reenfileirar.

## Arquitetura

```
src/main/       processo principal: banco, biblioteca, scanner, logs, IPC, protocolo de mídia
src/preload/    ponte segura (contextIsolation) — só expõe a API tipada
src/renderer/   interface React, player, decodificador CD+G
src/shared/     tipos e canais IPC compartilhados
scripts/        geração de fixtures e teste ponta a ponta
tests/          testes Vitest
```

- **Sincronismo:** o relógio do `<audio>` é a referência. A cada quadro, o decodificador CD+G
  avança até `audio.currentTime` (reprocessa do início se o tempo recuar), então pausa, retomada,
  stop e seek funcionam sem estado de tempo próprio.
- **Segurança:** `contextIsolation`, sem `nodeIntegration`, `sandbox`, CSP, IPC validado. O
  renderer nunca informa caminhos de arquivo: acessa mídia por `karaoke-media://song/<id>/mp3|cdg`,
  resolvido no main a partir do banco.
- **Módulos futuros** (câmera, avaliação, aplausos, TTS, streaming, integrações) ainda não existem;
  a estrutura permite adicioná-los sem reescrever (ver ROADMAP).

## Banco de dados

SQLite em `%APPDATA%\Karaoke Studio\karaoke.db`, criado automaticamente, com migrações versionadas
(`PRAGMA user_version`) em `src/main/db/migrations.ts`. Tabelas: `songs` (id, title, artist,
genre, language, mp3_path, cdg_path, duration, date_added, last_played, play_count e colunas
normalizadas para busca) e `settings`. Índice único no caminho do MP3 evita duplicados. Se o
arquivo estiver corrompido, é movido para `karaoke.db.corrupt-<data>` e um banco novo é criado.

## Logs

`%APPDATA%\Karaoke Studio\logs\karaoke-AAAA-MM-DD.log`, uma linha por evento:
`data-hora [NÍVEL] mensagem {contexto}`. Registram inicialização, versão, banco, importação
(encontradas/duplicadas/ignoradas), problemas de MP3/CDG, falhas de reprodução e de banco.

## Problemas conhecidos

- A duração exibida antes de tocar é estimada pelo tamanho do CDG; passa a ser a real do MP3
  quando o áudio carrega.
- ZIP: um arquivo .zip vale uma música (o primeiro par MP3+CDG de mesmo nome dentro dele). Não há suporte a ZIP64, senha ou mais de uma música por ZIP. A entrada é descompactada em memória (limite de 200 MB por entrada).
- Fila: interrompida com Stop, o item continua marcado como "Tocando" até você iniciar outro ou reabrir o app.
- "Limpar indisponíveis" apaga do catálogo tudo cujo arquivo não for encontrado; se um HD externo estiver desconectado, as músicas dele também saem (a fila delas cai junto; o histórico é mantido). Há confirmação antes.
- CD+G: implementados os comandos usados na prática (presets, tile block/XOR, scroll, paleta,
  transparência). Efeitos raros de emuladores (canais R-W/subcódigo extra) não são tratados.
- Sem monitor secundário ainda; só tela cheia da área do CDG.
