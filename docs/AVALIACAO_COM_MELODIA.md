# Avaliação com melodia de referência (Fase 4B)

Rótulo mostrado ao usuário: **`AVALIAÇÃO COM MELODIA DE REFERÊNCIA`**. Só aparece quando a música
tem um arquivo MIDI/KAR com uma melodia utilizável. Sem ele, o app continua no modo
**`AVALIAÇÃO BÁSICA`** ([AVALIACAO_BASICA.md](AVALIACAO_BASICA.md)), que **não mede afinação** e
nunca é apresentado como tal.

## De onde vem a melodia

- Arquivo ao lado da música com o mesmo nome: `Musica.kar`, `Musica.mid` ou `Musica.midi`
  (`.kar` vence se houver mais de um). Também dentro do ZIP da música (prefere o mesmo nome do MP3).
- Formatos lidos: SMF 0/1/2, KAR (letra em meta-eventos 0x05/0x01, `/` e `\` viram quebra de
  linha), RIFF/RMID, tempo em ticks ou SMPTE, _running status_, mapa de andamento.
- Limite de 5 MB por arquivo. Arquivo corrompido ou sem trilha utilizável → o app avisa
  ("Não foi possível ler a melodia…") e usa a avaliação básica.
- **Trilha da melodia:** escolhida automaticamente (nome "Melody/Vocal/Voz…", monofonia, faixa
  vocal, densidade; exclui bateria/canal 10 e trilhas com menos de 8 notas). Se houver mais de uma
  candidata o usuário pode trocar no painel; a escolha fica guardada por música (tabela
  `melody_choices`). Acordes na trilha viram uma linha só (nota mais aguda, _skyline_).

## Como a comparação é feita

O microfone gera uma linha do tempo de pitch (Fase 4A). A melodia é alinhada a ela pelo relógio do
player, já descontada a latência
(`tempoDaMúsica = tempoDoPlayer − (latência automática + ajuste manual)`).

- **Oitava ignorada.** Homens e mulheres cantam a mesma melodia em oitavas diferentes; o desvio é
  medido em semitons módulo 12 (−6…+6).
- **Transposição.** Se a pessoa canta em outro tom, o app só a aceita quando o desvio mediano é
  quase um semitom exato (resíduo ≤ 0,3 semitom) **e** consistente (≥ 60% das notas). Desvios
  quebrados (150¢ etc.) são desafinação, não transposição. Quando detectada, aparece na tela
  ("transposição detectada: −3 semitons") e a afinação é medida em relação a ela.
- Só entram as notas dentro do trecho realmente coberto pela apresentação.

## Componentes e pesos

| Componente         | Peso | O que mede                                                 |
| ------------------ | ---- | ---------------------------------------------------------- |
| Afinação           | 0,30 | desvio em cents: ≤ 30¢ = 100%, ≥ 200¢ = 0%, linear no meio |
| Notas corretas     | 0,15 | fração de notas com desvio ≤ 50¢                           |
| Ritmo              | 0,15 | entrada de cada nota (≤ 0,1 s = 100%, ≥ 0,4 s = 0%)        |
| Entrada das frases | 0,10 | início da primeira nota de cada frase (pausa ≥ 0,6 s)      |
| Duração            | 0,10 | tempo sustentado em relação à duração escrita              |
| Presença           | 0,10 | quanto da melodia foi efetivamente cantado (% cantado)     |
| Consistência       | 0,10 | regularidade do desvio ao longo da música                  |

Um componente que não pode ser medido (por exemplo, música sem frases) sai da conta e os pesos
restantes são **renormalizados**. Há um _gate_ por presença: cantar quase nada não rende nota alta
mesmo que as poucas notas estejam certas. A latência **nunca** reduz a nota.

Constantes em `src/renderer/src/voice/voice-config.ts` (`REFERENCE_*`, `PITCH_*`, `ONSET_*`, …);
lógica em `src/renderer/src/voice/reference-score.ts`. A nota básica é mantida como complemento
("Avaliação básica (complementar)") e serve de reserva se a comparação for insuficiente.

## Limitações honestas

- A nota é tão boa quanto a melodia do arquivo: MIDI de loja pode não ter uma trilha vocal clara,
  ter andamento diferente da gravação, ou estar defasado em relação ao MP3 (não há alinhamento
  automático; o ajuste manual de latência compensa só deslocamentos pequenos).
- Sem fones, a música captada pelo microfone pode ser lida como voz.
- Os limiares foram validados com sinais sintéticos e testes unitários; **ainda precisam de voz
  real** (ver TESTING.md).
