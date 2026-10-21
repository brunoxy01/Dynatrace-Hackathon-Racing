# v1.10.10 — Velocidade máxima não some quando o jogo reinicia a sessão

Só o app mudou (**1.10.9 → 1.10.10**). O pacote do rig é o mesmo da v1.10.8.

## O problema

Visto no teste com o tenant: a volta de 1:44.460 mostrava 249 km/h na coluna "Vel. máxima" e, depois de uma nova sessão no jogo, passou a mostrar "—". Os setores continuaram certos.

## A causa

Quando o jogo reinicia a sessão **sem fechar o coletor**, os primeiros quadros da sessão nova ainda anunciam o último tempo de volta, com o contador de voltas zerado. Esses quadros caem no mesmo grupo da volta original. A consulta de voltas usava o **menor** `lap_number` do grupo para achar a volta concluída (`lap_number − 1`), e passava a procurar a "volta 0", que não existe.

## A correção

A consulta usa o **maior** `lap_number` do grupo, que continua sendo o da volta original. O horário de fechamento da volta (`min(timestamp)`) não muda. Conferido com dados sintéticos no Grail: no grupo com o reinício, `min` dá 1 (errado) e `max` dá 14 (o da volta original).

## Técnico

- `Dashboard.tsx`: `LAPS` com `lap_number = max(lap_number)`.
- `npm test` (70/70), `npm run lint`, `tsc` limpos.
