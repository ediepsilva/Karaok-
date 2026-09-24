# Roadmap

Cada fase reaproveita o mesmo projeto; nada é recriado do zero.

## Fase 1 — Fundação + Player MP3+G (esta)

- Electron + React + TypeScript, SQLite com migrações, logs, tratamento de erros.
- Importação de pasta (recursiva) de pares `.mp3` + `.cdg`, sem duplicados.
- Biblioteca, busca por título/artista, persistência.
- Player MP3 + decodificador CD+G próprio, sincronizado pelo relógio do áudio.
- Play / Pause / Stop / Volume / Seek / Tela cheia.

## Fase 2 — Biblioteca avançada + Fila

ZIP MP3+G, importação avançada, edição de metadados (gênero, idioma, código), fila de cantores
(nome, música, posição, status), favoritos, histórico. As colunas `genre`, `language`,
`last_played` e `play_count` já existem no banco.

## Fase 3 — Câmera

Captura da webcam/câmera do cantor, exibida junto do CDG (`getUserMedia`).

## Fase 4 — Avaliação vocal

Análise do microfone (afinação, ritmo, entradas, % cantado) para nota de 0 a 100.

## Fase 5 — Nota + Aplausos + Voz

Aplausos proporcionais à nota, Text-to-Speech com mensagens variadas e _audio ducking_ dos
aplausos durante a fala, seguido de fade-out.

## Fase 6 — Transmissão remota

Salas com código/link, servidor de sinalização, WebRTC + WebSocket, espectadores.

## Fase 7 — Cantores remotos

Convidados entram na fila, escolhem músicas e cantam remotamente.

## Fase 8 — Comercialização

Instalador assinado, licenciamento, atualização automática, integração com catálogos licenciados
de terceiros (conforme contrato).

## Onde cada fase se encaixa na arquitetura

| Futuro                      | Ponto de extensão                                               |
| --------------------------- | --------------------------------------------------------------- |
| Fila, favoritos, histórico  | novas migrações em `src/main/db/migrations.ts` + serviços       |
| ZIP                         | `src/main/library/scanner.ts` (novo leitor) + protocolo mídia   |
| Câmera, avaliação, aplausos | novos módulos em `src/renderer/src/` usando o relógio do player |
| Streaming                   | novo serviço no `main` (sinalização) e módulo no renderer       |
| Catálogos externos          | nova fonte de `Song` atrás do `LibraryService`                  |
