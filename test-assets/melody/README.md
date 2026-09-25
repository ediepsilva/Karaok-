# Fixtures de melodia (Fase 4B)

Gerados por `npm run fixtures` (`scripts/generate-fixtures.ts`). Conteúdo 100% sintético (tons e
melodias criados por código); sem música de terceiros, livre para redistribuição.

| Música                         | Arquivo | Uso no teste                                         |
| ------------------------------ | ------- | ---------------------------------------------------- |
| Ref Artista - Nota La          | .mid    | A4 × 8 notas; bate com `voice/steady-a440.wav`       |
| Ref Artista - Nota Do          | .kar    | C4 com letra KAR; A4 fica −3 semitons (transposição) |
| Ref Artista - Melodia Quebrada | .mid    | arquivo inválido → aviso e avaliação básica          |
| Ref Artista - Duas Trilhas     | .mid    | duas trilhas candidatas (escolha e persistência)     |
