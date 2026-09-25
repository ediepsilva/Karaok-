# Edie Music Show

_Sua voz. Seu palco. Seu show._

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

## Câmera do cantor (Fase 3)

- **Ligar câmera** abre a webcam (só vídeo) e mostra a imagem junto do CDG: **sobre o canto** ou
  **ao lado**. Há seletor de câmera (troca ao vivo), **Espelhar** e, em tela cheia, a câmera
  continua junto do CDG.
- **Ligar ao tocar** (opcional): liga a câmera quando uma música começa. Vale a partir da próxima
  música e, se você desligar à mão, ela não religa na mesma música. Por padrão a câmera **nunca**
  liga sozinha, e ao reabrir o app ela começa desligada.
- **Privacidade**: nada é gravado nem enviado; a imagem só é exibida na tela. O microfone
  continua bloqueado (será liberado apenas com a avaliação vocal).
- Se o Windows bloquear a câmera, o app mostra onde liberar (Configurações › Privacidade ›
  Câmera). Uma câmera desconectada durante o uso é informada.

## Avaliação vocal — microfone (Fase 4A)

Painel **🎤 Avaliação vocal** (embaixo do player). Detalhes da fórmula:
[docs/AVALIACAO_BASICA.md](docs/AVALIACAO_BASICA.md).

- **Avaliação básica (modo recreativo).** Um MP3+G não traz a melodia, então o app **não sabe qual
  nota deveria ser cantada**. A nota (0–100) mede atividade vocal, estabilidade do pitch,
  continuidade e qualidade do sinal, e o resultado avisa que **não mede afinação**.
- **Avaliação com melodia de referência (Fase 4B).** Se houver `Musica.mid`/`.kar`/`.midi` ao lado
  da música (ou dentro do ZIP), o app compara a voz com a melodia (afinação, notas, ritmo, duração,
  entrada das frases, consistência, % cantado; oitava ignorada, transposição detectada) e rotula o
  resultado **AVALIAÇÃO COM MELODIA DE REFERÊNCIA**. Detalhes em
  [docs/AVALIACAO_COM_MELODIA.md](docs/AVALIACAO_COM_MELODIA.md).
- **Aplausos + voz (Fase 5).** Ao fim de uma apresentação com nota, aplausos sintéticos
  proporcionais à nota e uma frase falada parabenizando o cantor pelo nome (voz do próprio sistema,
  sem internet); aplausos abaixam durante a fala e somem com _fade-out_. Liga/desliga e volume
  próprios. Detalhes em [docs/FASE5_APLAUSOS_VOZ.md](docs/FASE5_APLAUSOS_VOZ.md).
- **Microfone restrito.** A avaliação vem desligada. O microfone só abre ao apertar **Testar
  microfone** ou durante uma apresentação com **Avaliar minha apresentação** marcado, e é liberado
  ao terminar, ao desmarcar e após pausas longas. Nunca liga sozinho ao abrir o app.
- **Diagnóstico** para ajustar com o seu microfone: dispositivo, nível, ruído ambiente, estado
  (silêncio/ruído/voz), frequência, nota aproximada, confiança, % de voz, latência e quadros
  descartados.
- **Latência:** automática, medida por cliques (exige alto-falantes) e ajuste manual.
- Fones de ouvido são **recomendados** (evitam captar a música), mas não obrigatórios.
- Nada é gravado nem enviado: só números (nota e resumo). O processamento é 100% local.

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

> A pasta de dados continua se chamando `Karaoke Studio` (nome antigo do app) mesmo depois da
> marca virar Edie Music Show — de propósito, para ninguém perder a biblioteca/histórico só por
> causa da troca de nome (ver `src/main/index.ts`).

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
- Câmera: os testes automáticos usam uma câmera virtual; a qualidade da imagem da webcam real e o
  comportamento de desconectar uma webcam USB dependem de conferência manual (TESTING.md).
- Câmera: não há gravação, foto nem transmissão (Fases 5 e 6); o app apenas exibe a imagem.
- Avaliação básica: não distingue canto de fala, e a música captada pelo microfone (sem fones)
  pode contar como voz. Ruído mascarado por voz contínua não é medido. Os limiares foram testados
  com sinais sintéticos e **ainda precisam ser ajustados com voz real** (TESTING.md).
- Avaliação básica (sem MIDI/KAR): não mede afinação.
- Avaliação com melodia: depende da qualidade do MIDI/KAR (trilha vocal clara, andamento e
  sincronia com o MP3); não há alinhamento automático. Testada com melodias sintéticas; **falta
  validar com MIDI/KAR reais e voz real** (TESTING.md).
