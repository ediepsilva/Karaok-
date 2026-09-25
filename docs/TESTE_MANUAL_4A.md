# Teste manual — Fase 4A (AVALIAÇÃO BÁSICA) com música real

Projeto: `C:\xampp\htdocs\Karaoke`. Nada de Maven/Spring/.NET/JDK pertence a este projeto.

## Como abrir

- **Executável (recomendado):** `C:\xampp\htdocs\Karaoke\release\win-unpacked\Karaoke Studio.exe`
  (duplo clique). Se ele não existir ou você alterou o código: `npm run dist` e abra de novo.
- **Alternativa (compila e abre):** no terminal, em `C:\xampp\htdocs\Karaoke`, `npm run teste`.

## Passo a passo

1. **Importar a pasta:** botão **Adicionar pasta de músicas** (topo da tela) → escolha a pasta onde
   está o MP3+G (ou o `.zip`). A música aparece na lista; um aviso resume a importação.
2. **Escolher a música:** digite o **nome do cantor** no campo _Cantor_ (opcional para tocar) e
   **clique na linha da música** para tocar.
3. **Painel 🎤 Avaliação vocal** (embaixo do player; já vem aberto): a lista **Microfone** escolhe o
   dispositivo. O texto de modo deve dizer **AVALIAÇÃO BÁSICA** (sua música não tem MIDI/KAR).
4. **Conferir o microfone antes:** aperte **Testar microfone** (o Windows/Chromium pode não pedir
   nada; o app libera só para si). Fale/cante e observe:
   - selo **MICROFONE ATIVO** no título do painel e faixa grande **● CAPTANDO VOZ** /
     **○ SILÊNCIO** / **● RUÍDO**;
   - **barra de nível** e **Nível de entrada** (dBFS; cantando costuma ficar entre −35 e −10);
   - **Frequência**, **Nota aproximada** e **Confiança** em tempo real;
   - **Estado** (voz / silêncio / ruído), **Ruído ambiente**, **Voz detectada (5 s)**;
   - **Latência** (mede com **Medir latência** só se estiver **sem fones**; com fones, use o ajuste
     manual).
     Aperte **Parar teste** ao terminar (o microfone é liberado).
5. **Iniciar a avaliação:** marque **Avaliar minha apresentação** e depois **clique na música**
   (ou toque de novo). O microfone abre sozinho ao começar; aparece "Apresentação em análise".
6. **Cantar** normalmente, com fones se possível (recomendado, não obrigatório).
7. **Finalizar:** deixe a música terminar ou aperte **Parar**. O microfone é liberado.
8. **Resultado:** cartão **AVALIAÇÃO BÁSICA** com a nota 0–100, as barras de cada componente e a
   tabela **Métricas que geraram a nota** (tempo com voz, silêncio, ruído, maior pausa, frases,
   estabilidade, nível médio da voz, ruído ambiente, saturação).

## O que observar (e anotar)

- Nível cantando e nível em silêncio; ruído ambiente; se aparece "ambiente ruidoso".
- Se o estado fica **voz** enquanto você canta e **silêncio** quando para (sem piscar demais).
- Se a **frequência/nota** acompanha o que você canta; confiança alta (> 80%) em notas firmes.
- Se a música saindo das caixas é lida como voz (sem fones isso pode acontecer).
- A nota e se pareceu justa: cantando o tempo todo, cantando pouco, ficando quieto (deve ser ~0).

## Logs

Pasta: `%APPDATA%\Karaoke Studio\logs` (normalmente
`C:\Users\<você>\AppData\Roaming\Karaoke Studio\logs`), um arquivo por dia `karaoke-AAAA-MM-DD.log`.
Também há o botão **Abrir pasta de logs** no painel (na lista de diagnóstico).

Linhas úteis (procure pelo texto):

- `Amostra do microfone` — **1 por segundo** enquanto o microfone está aberto: `contexto`
  (`teste` ou `apresentação`), nível médio, piso de ruído, quadros de voz/silêncio/ruído, frequência
  mediana, nota, confiança média, saturação.
- `Microfone ligado` / `Microfone ativo` / `Microfone liberado` — dispositivo e ciclo de vida.
- `Avaliação concluída` — nota, modo, duração.
- `Métricas da avaliação` — resumo completo (`summary`), componentes da nota, latência.

Com esses números ajustamos os limiares em `src/renderer/src/voice/voice-config.ts`.
Me envie o arquivo de log do dia (não contém áudio, só números) depois do teste.
