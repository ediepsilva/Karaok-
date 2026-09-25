# Fase 5 — Aplausos + voz (comemoração)

Ao fim de uma apresentação **com nota** (avaliação básica ou com melodia de referência), o app
toca aplausos proporcionais à nota e uma frase falada (TTS) parabenizando o cantor pelo nome,
com os aplausos abaixados durante a fala (_ducking_) e um _fade-out_ no final.

100% gerado por código: sem áudio de terceiros, sem depender de internet (a voz é a do próprio
sistema operacional, via [Web Speech API](https://developer.mozilla.org/docs/Web/API/Web_Speech_API)).

## Quando toca

Só quando a apresentação termina com uma nota (avaliação vocal ligada e apresentação longa o
bastante). Sem nota (avaliação desligada ou apresentação curta demais), não há comemoração —
consistente com "aplausos proporcionais à nota" do roteiro da fase.

## Controles

No painel **🎤 Avaliação vocal**: caixa **"Comemorar com aplausos e voz ao terminar"** (ligada por
padrão) e um controle de volume (independente do volume da música), em
`src/renderer/src/components/VoicePanel.tsx`. Preferência guardada em
`localStorage` (`karaoke.celebration`), como as demais preferências de voz.

## Aplausos (código-fonte)

`src/renderer/src/celebration/applause-plan.ts` traduz a nota (0–100) em um plano:

| Nota | Palmas | Volume de pico | Duração | Assobio |
| ---- | ------ | -------------- | ------- | ------- |
| 0    | 6      | 0,18           | 1,8 s   | não     |
| 50   | ~38    | ~0,52          | ~3,7 s  | não     |
| 85+  | ≥ 58   | ≥ 0,75         | ≥ 5 s   | sim     |
| 100  | 70     | 0,85           | 5,5 s   | sim     |

Interpolação linear entre os extremos; uma nota 0 ainda recebe uma salva de palmas educada
(nunca silêncio total — ninguém sai do palco sem aplauso nenhum).

`src/renderer/src/celebration/celebration-controller.ts` sintetiza tudo via Web Audio API:

- **Tapete de fundo**: ruído filtrado (passa-faixa) com envelope de ataque/liberação, pelo tempo
  todo dos aplausos.
- **Palmas individuais**: estalos curtos de ruído (passa-alta com corte aleatório), espalhados em
  instantes aleatórios pela duração — cada nota gera uma quantidade diferente.
- **Assobio de torcida** (nota ≥ 85): um osciloscópio senoidal com variação de frequência, somado
  por cima.

## Locução (TTS)

`src/renderer/src/celebration/tts-messages.ts` escolhe uma frase (com o nome do cantor e a nota)
de um banco de mensagens por faixa: excelente (≥ 90), muito bom (≥ 70), bom (≥ 50), regular (≥ 30),
incentivo (< 30). Várias variações por faixa para não repetir sempre a mesma frase.

Voz: qualquer voz `pt-BR` disponível no sistema; sem isso, qualquer `pt-*`; sem nenhuma, a voz
padrão do navegador/SO (`pickPortugueseVoice`). Sem voz em português instalada, a fala ainda
acontece (só que na voz padrão do sistema).

## Ducking e fade-out

1. Aplausos começam imediatamente (tapete + palmas agendadas).
2. Depois de ~0,7 s, a fala começa. No `onstart` do TTS, o volume dos aplausos desce para ~22% em
   250 ms; no fim da fala (`onend`/`onerror`), volta a 100% em 400 ms.
3. Depois da fala, os aplausos continuam por ~0,8 s e então desaparecem com um _fade-out_ de 2,5 s.
4. Rede de segurança: se a fala nunca terminar (voz indisponível numa máquina específica), tudo é
   encerrado sozinho depois de 20 s.

Trocar de música ou fechar o app interrompe qualquer comemoração em andamento na hora (`stop()`).

## Testes

- **Unitários** (`tests/applause-plan.test.ts`, `tests/tts-messages.test.ts`,
  `tests/celebration-controller.test.ts`): fórmula da nota→plano (monotônica, nunca zerada,
  limite do assobio), sorteio de mensagens (sem marcador sobrando, nome/nota corretos),
  e o controlador completo com um `AudioContext`/`SpeechSynthesis` falsos (temporizadores
  simulados): número de fontes de áudio criadas, atraso antes de falar, ducking na fala,
  fade-out e fechamento do contexto, rede de segurança, `stop()` idempotente.
- **Ponta a ponta** (`scripts/e2e-celebration.mjs`, `npm run e2e:celebration`): com o app
  Electron real e uma voz do sistema de verdade — confirma que a caixa vem ligada por padrão, que
  uma apresentação real gera a fala esperada (nome do cantor + nota, em português), e que
  desligar a comemoração realmente não fala nada.

**Limitação conhecida dos testes automatizados:** não é possível ouvir o áudio nem confirmar que
uma voz humana "soa bem" — isso pede teste manual (ver TESTING.md). A persistência da preferência
entre reaberturas do app depende do Chromium gravar o `localStorage` em disco antes do processo
fechar; em testes automatizados que fecham o Electron logo em seguida isso pode falhar por uma
questão de tempo (a mesma limitação já existe nas preferências de voz da Fase 4A) — funciona bem
no uso normal, onde o app não fecha imediatamente depois do clique.

## Fora do escopo desta fase

- Nenhuma personalização das frases pelo usuário (fica para um ajuste futuro, se pedido).
- Volume dos aplausos não é "ducado" pela música em si, só a fala é ducada em cima dos aplausos.
- Sem aplausos para quem canta com a avaliação desligada (sem nota, sem comemoração).
