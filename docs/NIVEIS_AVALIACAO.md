# Níveis de dificuldade (Amador / Semiprofissional / Profissional)

Antes de cantar, o cantor escolhe um nível no painel **🎤 Avaliação vocal**. O nível muda **a
tolerância e o peso** de certos componentes da nota — não troca o motor de avaliação: a mesma
AVALIAÇÃO BÁSICA (`basic-score.ts`) e a mesma AVALIAÇÃO COM MELODIA DE REFERÊNCIA
(`reference-score.ts`) da Fase 4 continuam sendo usadas nos três níveis.

| Nível                | Descrição mostrada ao usuário                                                    |
| -------------------- | -------------------------------------------------------------------------------- |
| **Amador**           | "Mais tolerante e voltado à diversão."                                           |
| **Semiprofissional** | "Avaliação intermediária." (neutro — é a fórmula original da Fase 4, sem ajuste) |
| **Profissional**     | "Avaliação mais rigorosa."                                                       |

## Como o nível muda a nota (`src/renderer/src/voice/evaluation-profile.ts`)

Cada nível é um `EvaluationProfile`:

```ts
{
  level: 'amateur' | 'semiPro' | 'professional'
  toleranceExponent: number // curva de tolerância (ver abaixo)
  weight: {
    ;(pitch, timing, stability, continuity)
  } // multiplicadores de peso
}
```

- **Tolerância** (`reshapeForTolerance`): cada componente "de técnica" (afinação, ritmo/entradas,
  estabilidade/consistência, duração das notas) passa por uma curva `valor ^ expoente` antes de
  entrar na conta. Expoente < 1 (Amador) **sobe** valores medianos — a mesma medição rende mais
  crédito. Expoente > 1 (Profissional) **derruba** valores medianos. 0 continua 0 e 1 continua 1:
  a tolerância nunca inventa erro nem tira quem foi perfeito.
- **Peso**: o multiplicador de peso só **sobe** para o Profissional (nunca desce para o Amador).
  Numa fórmula que soma pesos direto (a AVALIAÇÃO BÁSICA), reduzir peso E ao mesmo tempo facilitar
  a tolerância se anulariam; por isso o Amador usa peso neutro (só a tolerância muda) e só o
  Profissional acumula peso maior sobre os mesmos componentes que já ficaram mais rígidos — os
  dois efeitos reforçam um ao outro, em vez de brigar. Tanto a avaliação básica quanto a com
  melodia renormalizam o "pacote" de componentes técnicos pelo próprio peso, então mudar o peso
  só troca a importância relativa entre eles, sem estourar o total.
- Componentes que **não são sobre técnica** (atividade, silêncio, qualidade do sinal na básica;
  notas certas e % cantado na com melodia) **não** são afetados pelo nível.

Notas certas de referência: quem canta 100% perfeito continua com nota máxima em qualquer nível
— não existe nível que "invente" defeito. A diferença só aparece em quem tem imperfeições reais
(afinação instável, ritmo impreciso, notas cortadas), e cresce do Amador ao Profissional.

## Escala mostrada ao usuário

A nota interna continua 0–100 (mesmas fórmulas e limiares da Fase 4). A **tela** mostra 0,0–10,0
(`formatScore10`, em `VoicePanel.tsx`): `nota_exibida = nota_interna / 10`, com vírgula decimal.
O valor interno fica disponível em `data-score-100` no elemento da nota, para os testes
automatizados lerem sem precisar reinterpretar o texto formatado.

## Promoção de nível (semiautomática)

Ao final de uma apresentação com nota ≥ 90 (`PROMOTION_MIN_SCORE`), se o nível atual tem um
próximo nível (`shouldOfferPromotion`), o cartão de resultado oferece a promoção com dois botões —
**"Subir para \<próximo nível\>"** e **"Continuar no \<nível atual\>"**. O cantor decide: o nível
**nunca** muda sozinho. Profissional, por já ser o topo, só recebe um elogio ("Excelente
desempenho em nível Profissional!") quando a nota é alta, sem oferta de promoção.

## Persistência por cantor

O nível fica guardado em `localStorage` (`karaoke.singerLevels`), por **nome do cantor**
normalizado (sem espaços nas pontas, sem diferenciar maiúsculas/minúsculas) — o mesmo modelo que o
resto do app usa para "cantor" (um nome digitado, não uma conta). Um cantor novo começa no
**Amador**. Trocar o nome no campo "Cantor" já mostra/permite trocar o nível daquele nome antes de
apertar Play.

## Testes

- **Unitários**: `tests/evaluation-profile.test.ts` (curva de tolerância, ordem dos níveis,
  regras de promoção), `tests/basic-score-levels.test.ts` e a seção "Níveis de dificuldade" em
  `tests/reference-score.test.ts` (a MESMA apresentação sintética avaliada nos 3 perfis rende nota
  progressivamente menor; sem perfil informado, o resultado é idêntico ao Semiprofissional — ou
  seja, o comportamento da Fase 4 não mudou por padrão), `tests/singer-level-prefs.test.ts`
  (guardar/ler o nível por cantor).
- **Ponta a ponta**: `scripts/e2e-levels.mjs` (`npm run e2e:levels`) — seletor de nível, mesma voz
  em nível diferente, persistência por cantor, oferta de promoção (aceitar/recusar) e o caso do
  Profissional.

## Limitação conhecida

Com o microfone falso de tom perfeitamente estável usado nos testes automatizados, a diferença
entre níveis no e2e é pequena (a tolerância tem pouco o que "perdoar" quando não há imperfeição
nenhuma) — por isso a prova forte da diferenciação está nos testes unitários, com um sinal
sintético propositalmente imperfeito. Com voz real (que sempre tem alguma variação), a diferença
entre os três níveis deve ser mais perceptível; isso ainda precisa de teste manual com voz real.
