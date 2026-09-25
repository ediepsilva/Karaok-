# Avaliação básica (modo recreativo) — Fase 4A

> **O que esta nota É:** uma medida de _atividade vocal_, _estabilidade_, _continuidade_ e _qualidade
> do sinal_ do microfone durante a música.
>
> **O que esta nota NÃO É:** uma avaliação de afinação. Sem uma melodia de referência o aplicativo
> **não sabe qual nota deveria ser cantada** e, portanto, nunca afirma "você acertou X% das notas".
> A avaliação **com melodia de referência** (afinação, notas, ritmo, duração, entrada das frases)
> é a Fase 4B (MIDI/KAR), descrita em [AVALIACAO_COM_MELODIA.md](AVALIACAO_COM_MELODIA.md), e usa
> o rótulo `AVALIAÇÃO COM MELODIA DE REFERÊNCIA`.

Todos os limiares e pesos ficam em um único arquivo:
[`src/renderer/src/voice/voice-config.ts`](../src/renderer/src/voice/voice-config.ts).
A nota é **determinística**: a mesma medição sempre gera a mesma nota (não há números aleatórios).

## 1. O que é medido (por quadro de ~10,7 ms)

O microfone é aberto **sem** cancelamento de eco, supressão de ruído nem ganho automático (eles
distorcem o pitch). A cada 512 amostras analisa-se uma janela de 2048 amostras (~43 ms a 48 kHz):

| Medida                             | Como                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| **Nível** (dBFS)                   | RMS da janela                                                                             |
| **Ruído ambiente**                 | piso estimado: cai rápido, sobe devagar, só com quadros que não são voz; mínimo −58 dBFS  |
| **Pitch** (Hz) e **clareza** (0–1) | método MPM (autocorrelação normalizada), 65–1100 Hz, refinado por interpolação parabólica |
| **Estado do quadro**               | ver abaixo                                                                                |

**Estado do quadro**

- `silêncio`: nível abaixo de `max(−52 dBFS, ruído ambiente + 9 dB)`;
- `voz`: acima disso **e** com pitch claro (clareza ≥ 0,80) na faixa vocal;
- `ruído`: acima do limiar, mas sem pitch claro (chiado, sopro, bateria etc.).

**Limites conhecidos:** não distingue canto de fala nem canto de instrumento melódico; ruído
mascarado por voz contínua não é medido; música do alto-falante captada pelo microfone pode contar
como voz (por isso recomendamos fones de ouvido, sem exigir).

## 2. Resumo da apresentação

Só contam os quadros recebidos **enquanto a música toca** (pausas ficam de fora). A duração é o
**tempo decorrido pelo relógio do microfone**, não uma contagem de quadros: se o computador
atrasar mais de 0,25 s, quadros são descartados (contador "Quadros descartados" no diagnóstico) e
a duração continua correta. Lacunas de até
0,15 s (respiração, consoantes) não interrompem uma "corrida" de voz; corridas com menos de 0,1 s
são ignoradas.

| Grandeza           | Definição                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voicedFraction`   | fração dos quadros em estado `voz`                                                                                                                                                |
| `noiseFraction`    | fração dos quadros em `ruído`                                                                                                                                                     |
| `clippingFraction` | fração dos quadros com pico ≥ 0,99 (saturação)                                                                                                                                    |
| `longestGapSec`    | maior trecho contínuo sem voz                                                                                                                                                     |
| `meanRunSec`       | duração média das corridas de voz                                                                                                                                                 |
| `stableFraction`   | fração dos quadros de voz cujo pitch fica a ≤ 70 centésimos da mediana dos 5 quadros anteriores (tolera vibrato e não penaliza troca de nota: só os ~3 quadros logo após a troca) |
| `ambientNoiseDb`   | mediana do ruído ambiente durante a apresentação                                                                                                                                  |

## 3. Fórmula

Cada componente vai de 0 a 1 (`rampa(x, baixo, alto)` = 0 abaixo de `baixo`, 1 acima de `alto`,
linear entre eles):

| Componente       | Cálculo                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **atividade**    | `min(1, voicedFraction / 0,55)` (músicas têm trechos instrumentais: 55% com voz já vale o máximo)                                                            |
| **estabilidade** | `rampa(stableFraction, 0,40, 0,85)`                                                                                                                          |
| **continuidade** | `rampa(meanRunSec, 0,25 s, 1,5 s)` (0 se não houve corrida de voz)                                                                                           |
| **silêncio**     | `1 − rampa(longestGapSec, 8 s, 30 s)`                                                                                                                        |
| **qualidade**    | `(1 − min(1, noiseFraction / 0,35) − 2·clippingFraction) × qualidadeAmbiente`, com `qualidadeAmbiente` = 1 até −50 dBFS caindo linearmente a 0,3 em −30 dBFS |

```
evidência = atividade
gate      = min(1, voicedFraction / 0,10)

nota = 100 × gate × ( 0,35 × atividade
                    + evidência × ( 0,25 × estabilidade
                                  + 0,20 × continuidade
                                  + 0,10 × silêncio
                                  + 0,10 × qualidade ) )
```

- **`gate`**: com menos de 10% do tempo com voz a nota é reduzida até **0** (silêncio ou só ruído
  nunca recebem pontos).
- **`evidência`**: estabilidade, continuidade, silêncio e qualidade só rendem pontos **em proporção
  a quanto a pessoa realmente cantou**. Sem isso, quem cantasse 1 s de uma música de 11 s ganharia
  pontos de estabilidade "perfeita" sobre quase nada (defeito encontrado e corrigido nos testes).
- Apresentações com menos de **5 s** analisados **não recebem nota** ("curta demais").
- O resultado mostra a nota, o rótulo `AVALIAÇÃO BÁSICA`, a barra de cada componente, a fração da
  música avaliada e o aviso de que a nota não mede afinação. Versão da fórmula: `1`.

### Exemplos (calculados pelos testes com sinais sintéticos)

| Situação                                                                     | Nota |
| ---------------------------------------------------------------------------- | ---- |
| silêncio; só ruído                                                           | 0    |
| tom estável e contínuo                                                       | ≥ 90 |
| melodia de 12 notas com pausas de respiração de 0,15 s (teste ponta a ponta) | 100  |
| 1,2 s de canto numa música de ~11 s                                          | < 25 |

Estes valores vêm de sinais sintéticos. **Os limiares ainda precisam ser ajustados com voz real**
(a Fase 4A entrega a tela de diagnóstico para isso — veja `TESTING.md`).

## 4. Latência

O que o cantor ouve chega atrasado (saída de áudio) e a voz é capturada depois (entrada):

```
tempoDaMúsica = tempoDoPlayerNaAmostra − (latência base + ajuste manual)
latência base = medida por cliques (se houver) senão a informada pelo sistema (saída + entrada)
```

- **Automática:** `AudioContext.baseLatency + outputLatency` + latência de entrada, quando o
  navegador informa.
- **Medida:** o botão "Medir latência" toca cliques e mede quando o microfone os ouve (ida e volta).
  Exige alto-falantes (fones não são ouvidos pelo microfone) e silêncio; só é aceita com ≥ 2 cliques
  consistentes (≤ 15 ms de dispersão); caso contrário nada é aplicado.
- **Manual:** ajuste fino de −200 a +600 ms.

A nota da avaliação básica **não depende** da latência (ela usa contagens, não posições no tempo),
então hardware lento nunca reduz a nota. A latência compensa o **tempo dos quadros**, guardado na
linha do tempo de pitch para a Fase 4B (comparação com a melodia).

## 5. Privacidade e permissão do microfone

- Avaliação **desligada por padrão**; o microfone **nunca** liga sozinho ao abrir o app.
- O microfone só abre (a) ao apertar "Testar microfone" ou (b) durante uma apresentação com a
  avaliação habilitada; é **liberado** ao terminar/parar, ao desabilitar a avaliação e após pausas
  longas (20 s).
- O processo principal só concede a permissão de áudio se o app **armou a trava** imediatamente
  antes (vale para um pedido e expira em 8 s), para o próprio app, e nunca para áudio+vídeo juntos.
  Ativação e liberação são registradas no log.
- O áudio **não é gravado nem enviado**: só são guardados números (nota e resumo) e, em memória, a
  linha do tempo de pitch da apresentação.
