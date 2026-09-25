# Roadmap

Cada fase reaproveita o mesmo projeto; nada é recriado do zero.

## Fase 1 — Fundação + Player MP3+G (concluída)

- Electron + React + TypeScript, SQLite com migrações, logs, tratamento de erros.
- Importação de pasta (recursiva) de pares `.mp3` + `.cdg`, sem duplicados.
- Biblioteca, busca por título/artista, persistência.
- Player MP3 + decodificador CD+G próprio, sincronizado pelo relógio do áudio.
- Play / Pause / Stop / Volume / Seek / Tela cheia.

## Fase 2 — Biblioteca avançada + Fila (concluída)

- ZIP MP3+G (leitor próprio, em memória, com limites), pastas lembradas e reescaneamento, limpeza de músicas indisponíveis.
- Edição de metadados (título, artista, gênero, idioma, código); busca por gênero e código.
- Favoritos e histórico (música + cantor).
- Fila de cantores com nome, ordem, status (aguardando/tocando) e avanço automático; persiste ao reabrir.
- Banco na versão 2 (migração preserva os dados da Fase 1).

## Fase 3 — Câmera (concluída)

- Captura de **vídeo** da câmera do cantor (`getUserMedia`), com escolha do dispositivo, hot-plug e
  tratamento de erros (sem câmera, sem permissão do Windows, em uso, câmera desconectada).
- Exibida junto do CDG: sobre o canto ou ao lado; espelhar; funciona em tela cheia.
- “Ligar ao tocar” opcional (a câmera nunca liga sozinha por padrão).
- Política de permissões do Electron: só vídeo e tela cheia, só para o próprio app; microfone negado.
- O `MediaStream` fica exposto em `useCamera().stream` para a Fase 6 (transmissão) reaproveitar.
- **Fora do escopo desta fase**: gravação, foto, transmissão e qualquer análise da imagem.

## Fase 4 — Avaliação vocal

Dividida em duas partes. Um MP3+G **não contém a melodia**; por isso há dois modos, e o app diz
qual foi usado.

### Fase 4A — Microfone + análise vocal base + AVALIAÇÃO BÁSICA (concluída)

- Captura do microfone com trava de permissão, seleção de dispositivo, abertura só durante o teste
  ou uma apresentação com a avaliação habilitada, e liberação ao terminar.
- Detecção de voz/silêncio/ruído, pitch (MPM próprio), estabilidade, continuidade, saturação.
- Compensação de latência (automática, medida por cliques e ajuste manual).
- Tela de diagnóstico (dispositivo, nível, frequência, nota, confiança, % de voz, latência).
- **AVALIAÇÃO BÁSICA** (modo recreativo, sem melodia): mede atividade vocal, estabilidade,
  continuidade e qualidade do sinal. **Não mede afinação.** Fórmula em
  [docs/AVALIACAO_BASICA.md](docs/AVALIACAO_BASICA.md).
- Contratos (`reference.ts`) prontos para a melodia de referência. Sem MIDI/KAR ainda.

### Fase 4B — Melodia de referência (implementada; falta teste manual com arquivos e voz reais)

- MIDI/KAR ao lado da música ou dentro do ZIP; parser SMF 0/1/2, KAR, RMID; escolha automática
  e manual da trilha da melodia (guardada por música).
- Comparação de pitch com a melodia: afinação, notas, ritmo, duração, entrada das frases,
  consistência e % cantado; oitava ignorada; transposição detectada.
- **AVALIAÇÃO COM MELODIA DE REFERÊNCIA**; sem melodia continua **AVALIAÇÃO BÁSICA**.
  Ver [docs/AVALIACAO_COM_MELODIA.md](docs/AVALIACAO_COM_MELODIA.md).

## Fase 5 — Nota + Aplausos + Voz (implementada; falta teste manual de áudio)

- Ao fim de uma apresentação com nota: aplausos sintéticos (Web Audio) proporcionais à nota,
  seguidos de uma frase falada (TTS, voz do sistema) parabenizando o cantor pelo nome.
- Aplausos abaixam durante a fala (_ducking_) e desaparecem com _fade-out_ ao final.
- Liga/desliga e volume próprios, guardados entre sessões.
- Ver [docs/FASE5_APLAUSOS_VOZ.md](docs/FASE5_APLAUSOS_VOZ.md).
- **Níveis de dificuldade** (Amador/Semiprofissional/Profissional), escolhidos antes de cantar,
  com promoção semiautomática de nível e nota exibida em escala 0,0–10,0. Mesmo motor de
  avaliação da Fase 4, só a tolerância/peso mudam por nível. Ver
  [docs/NIVEIS_AVALIACAO.md](docs/NIVEIS_AVALIACAO.md).

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
