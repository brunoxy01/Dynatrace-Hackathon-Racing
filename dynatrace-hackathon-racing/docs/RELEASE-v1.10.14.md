# v1.10.14 — Voltas com o mesmo tempo não somem mais da classificação

Só o app mudou (**1.10.13 → 1.10.14**). O pacote do rig é o mesmo da v1.10.13.

## O problema

Uma volta de 1:41.120 feita hoje não apareceu na classificação, porque o mesmo piloto, no mesmo simulador, já tinha um 1:41.120 registrado no dia anterior.

## A causa

O app descarta **voltas reanunciadas**: com o jogo aberto, um coletor reiniciado faz o jogo repetir o último tempo de volta, e sem esse filtro a mesma volta apareceria duas vezes. O critério era mesmo simulador + mesmo piloto + **mesmo tempo**, ficando só a ocorrência mais antiga. Duas voltas reais com tempos idênticos eram tratadas como uma.

## A correção

A consulta de voltas passa a trazer o **menor cronômetro** entre os quadros de cada volta (`lap_start_s`):

- **Volta real:** quem carrega o tempo dela são os quadros da volta seguinte, que começa na linha com o cronômetro em ~0 s.
- **Reanúncio:** o coletor reiniciado pega o carro no meio de uma volta, com o cronômetro já em dezenas de segundos.

Todas as voltas reais ficam, mesmo com tempos iguais. O reanúncio só aparece se a volta real não estiver no período escolhido. Linhas sem essa informação seguem a regra anterior.

## Técnico

- `Dashboard.tsx`: `LAPS` com `lap_start_s = min(lap_time_s)`.
- `racing.ts`: `dedupeLaps` mantém todas as voltas reais (`lap_start_s ≤ 3 s`) de cada grupo; `lapCompletions` marca as voltas detectadas ao vivo como reais.
- Testes novos: dois 1:41.120 reais em dias diferentes contam os dois; reanúncio depois de coletor reiniciado continua contando uma vez. Os testes antigos de reanúncio seguem passando. `npm test` (77/77), `npm run lint`, `tsc` limpos; DQL validada.
