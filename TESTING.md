# Testes

## Automatizados

```bash
npm run typecheck   # TypeScript strict (main + renderer)
npm run lint        # ESLint
npm run format:check
npm test            # Vitest: testes unitários e de integração (SQLite e disco reais)
npm run e2e         # build + abre o Electron de verdade e usa a interface
npm run e2e:voice       # idem, para microfone/avaliação vocal (Fase 4)
npm run e2e:celebration # idem, para aplausos + voz ao fim da apresentação (Fase 5)
npm run e2e:levels      # idem, para os níveis de dificuldade e promoção
```

Para rodar o mesmo teste ponta a ponta no app empacotado (depois de `npm run dist`), no PowerShell:

```powershell
$env:E2E_EXE = "$PWD\release\win-unpacked\Karaoke Studio.exe"; node scripts/e2e.mjs
```

`npm test` cobre: parser de nomes, scanner (subpastas, pares, órfãos, arquivos inválidos), banco
(criação, migrações, duplicados, busca, persistência, corrupção), serviço de biblioteca,
decodificador CD+G (memory/border preset, tile block, XOR, scroll, paleta, transparência,
sincronismo por tempo, seek), estados do player e logger. Na Fase 2: leitor de ZIP (CRC, zip bomb, truncado, entradas perigosas), scanner e mídia de ZIP, migração 1→2, favoritos, edição e validação de metadados, busca por gênero/código, reescaneamento, limpeza de indisponíveis, fila (ordem, mover, status, persistência) e histórico.

`npm run e2e` (`scripts/e2e.mjs`) usa perfil e biblioteca temporários e verifica: inicialização,
criação do SQLite, importação pela interface, busca, reprodução, sincronismo CDG × áudio (cor de
um pixel por segundo), Pause/Continue/Stop/Seek/Volume, tela cheia, MP3 corrompido, CDG inválido,
arquivos removidos, ZIP (tocar, CDG, seek), edição/busca por gênero e código, favoritos, fila (ordem, reordenar, avanço automático, Próxima, remover), histórico, Reescanear/Limpar indisponíveis, persistência após fechar/abrir e logs.

`npm run e2e:voice` (`scripts/e2e-voice.mjs`, Fase 4A) abre o app com um **microfone falso**: o
Chromium reproduz um WAV conhecido (`--use-file-for-fake-audio-capture`, arquivos em
`test-assets/voice/`, gerados por `npm run fixtures`). Cenários: tom A4 estável, silêncio, ruído e
melodia (uma nota por segundo). Verifica a trava de permissão do microfone, dispositivo, frequência
e nota lidas, nível, captura sem eco/supressão/AGC, início e fim da captura, pausa, parada
antecipada, desabilitar no meio da música, persistência (o microfone não liga sozinho ao abrir), o
resultado da avaliação básica e o log. Limite: o microfone falso não escuta o alto-falante, então
a **medição de latência por cliques** só tem o caminho de falha testado (o de sucesso é coberto por
teste unitário e pelo checklist manual).

**Limite:** nenhum script consegue confirmar que o áudio é _audível_, que a imagem está _bonita_,
nem que a nota da avaliação parece _justa_ com voz humana real. Isso é o checklist manual abaixo.

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

### Câmera (Fase 3), com a webcam real

Os testes automáticos usam a câmera virtual do Chromium. Só você confirma a webcam de verdade:

- [ ] “Ligar câmera”: a luz da webcam acende e a sua imagem aparece
- [ ] a imagem tem boa qualidade e não está com atraso perceptível
- [ ] “Espelhar” inverte a imagem como um espelho
- [ ] “Sobre o canto” e “Ao lado do CDG” mostram a câmera e o CDG juntos
- [ ] tela cheia mantém a câmera junto do CDG
- [ ] com uma música tocando, o CDG e o áudio continuam sincronizados
- [ ] “Desligar câmera”: a luz apaga
- [ ] com mais de uma câmera (ex.: USB): trocar no seletor muda a imagem
- [ ] desconectar a webcam USB com a câmera ligada: aparece “A câmera foi desconectada.”
- [ ] em Configurações do Windows › Privacidade › Câmera, bloqueie o acesso: aparece a orientação

### Microfone e avaliação básica (Fase 4A), com o seu microfone real

Os testes automáticos usam um microfone falso (WAV conhecido). Só você confirma o microfone real e
ajusta a sensibilidade com voz de verdade. A fórmula está em
[docs/AVALIACAO_BASICA.md](docs/AVALIACAO_BASICA.md).

**Preparação:** `npm run dev` (ou o `.exe`), abra o painel **🎤 Avaliação vocal** (embaixo do
player). Se puder, use fones de ouvido (recomendado, não obrigatório).

**A. Diagnóstico (sem música)**

1. Escolha o seu microfone em **Microfone** e clique **Testar microfone**. O selo vira
   **MICROFONE ATIVO** e o Windows mostra que o microfone está em uso.
2. Fique em silêncio 5 s: **Estado** = `silêncio`; anote **Ruído ambiente** e **Nível de entrada**.
   Se aparecer "ambiente ruidoso", o ruído de fundo está alto (ventilador, TV).
3. Cante uma nota sustentada ("aaaa"): **Estado** = `voz`, **Frequência** e **Nota aproximada**
   seguem a sua voz; **Confiança** deve ficar alta (> 80%). Cante uma nota conhecida (ex.: um lá =
   A4 = 440 Hz num afinador de celular) e compare.
4. Fale normalmente, assobie e bata palmas: anote como o **Estado** reage (fala/assobio contam como
   voz; palma/ruído devem virar `ruído`).
5. Nível: a barra não deve ficar no vermelho (saturação). Se ficar, abaixe o ganho do microfone
   no Windows.
6. **Quadros/s** deve ficar perto de 90; **Quadros descartados** deve ser 0 ou baixo (se subir
   muito, o computador está sobrecarregado).
7. Clique **Parar teste**: o selo volta para **MICROFONE INATIVO** e o indicador do Windows some.

**B. Latência**

1. Com alto-falantes (sem fones) e em silêncio, com o teste ligado, clique **Medir latência**.
   Sucesso: "Latência de ida e volta medida: N ms (aplicada)". Falha (esperada com fones): a
   mensagem explica; nada é aplicado.
2. Ajuste fino: o **Ajuste de latência** (−200 a +600 ms) entra no total exibido em **Latência**.
   Bluetooth costuma ter 150–300 ms.

**C. Apresentação (avaliação)**

1. Marque **Avaliar minha apresentação** (o microfone continua inativo).
2. Toque uma música e cante. O microfone abre sozinho ao começar, "Apresentação em análise" mostra
   segundos e % de voz, e ele **fecha** ao parar/terminar.
3. Ao fim aparece o cartão **AVALIAÇÃO BÁSICA** com a nota e as barras de cada componente. Confira:
   cantar o tempo todo dá nota alta; ficar quieto dá ~0; falar sem melodia contínua dá média.
4. Pause por mais de 20 s: o microfone é liberado e reabre ao retomar.
5. Desmarque **Avaliar minha apresentação** no meio da música: o microfone fecha e não há nota.
6. Feche e reabra o app: a avaliação e o ajuste de latência ficam salvos, mas o microfone **não**
   liga sozinho.

**O que anotar para eu ajustar os limiares:** ruído ambiente e nível em silêncio; nível e confiança
cantando; se houve "ambiente ruidoso"; a nota de 2–3 apresentações (cantando bem, cantando pouco,
só falando); e se a nota pareceu justa. Nenhum desses números é um erro por si: servem para calibrar
`src/renderer/src/voice/voice-config.ts`.

## Fase 4B — Melodia de referência (checklist manual)

Automatizado (não repetir à mão): parser MIDI/KAR, escolha de trilha, pontuação, importação,
etiquetas, transposição, arquivo inválido, troca de trilha, persistência (`npm test`,
`scripts/e2e-voice.mjs`, cenário E).

**F. Com MIDI/KAR real** (coloque um `.kar`/`.mid` com o mesmo nome do seu MP3+G, na mesma pasta):

1. Reescaneie a pasta: a música ganha a etiqueta **KAR/MIDI**.
2. Abra **Avaliação vocal**: deve mostrar **AVALIAÇÃO COM MELODIA DE REFERÊNCIA**, o nome do arquivo
   e o número de notas. Se aparecer "Trilha da melodia", confira qual soa como a voz principal.
3. Cante de verdade (com fones): o cartão final mostra a nota, as barras (afinação, notas, ritmo…),
   "Notas acertadas: X de Y" e se houve transposição.
4. Cante uma oitava acima/abaixo: não deve ser penalizado. Cante meio tom errado de propósito e
   confira que a afinação cai.
5. Se a nota parecer injusta com o áudio certo, o arquivo pode estar **defasado** do MP3: anote a
   música e o tamanho do atraso (o ajuste manual de latência ajuda em deslocamentos pequenos).

**Sem MIDI** (ex.: seu MP3+G sem arquivo de melodia): o app deve continuar em **AVALIAÇÃO BÁSICA**,
avisando que não mede afinação.

## Fase 5 — Aplausos + voz (checklist manual)

Automatizado (não repetir à mão): fórmula nota→plano de aplausos, sorteio de mensagens, ducking e
fade-out com um `AudioContext`/fala falsos (`npm test`), e a fala real acontecendo com o app real
(`npm run e2e:celebration`).

**O que só dá para confirmar ouvindo:**

1. Cante e deixe a avaliação terminar: aplausos tocam e, pouco depois, uma voz fala seu nome e a
   nota, em português. Confira se a voz soa bem no seu Windows (varia por instalação).
2. Repita 2–3 vezes com notas bem diferentes (alta, média, baixa): mais palmas, mais volume e
   assobio nas notas altas; ainda assim uma salva de palmas mesmo na nota mais baixa.
3. Desmarque **Comemorar com aplausos e voz** e cante de novo: nada deve tocar.
4. Ajuste o volume da comemoração e confira que ele não muda o volume da música.
5. Cante de novo enquanto a comemoração anterior ainda está tocando (ou troque de música rápido):
   não deve sobrepor duas falas ao mesmo tempo, nem travar o app.

## Resultados

Ver o relatório final de cada fase (preenchido após a execução).
