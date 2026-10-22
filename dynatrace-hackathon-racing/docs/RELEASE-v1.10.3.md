# v1.10.3 — Velocidade máxima de cada volta nas tabelas

Só o app mudou (**1.10.2 → 1.10.3**). O pacote do rig é o mesmo da v1.10.2.

## Nova coluna "Vel. máxima"

A pedido: as tabelas de voltas mostram a velocidade máxima atingida **naquela volta**:

- **Top 10 voltas** (abas Ao vivo e Placar);
- **Voltas registradas** (aba Replay).

A coluna ordena como número. Voltas sem a máxima disponível (começaram antes do período escolhido, ou as amostras já saíram da retenção) mostram "—" e vão para o fim.

## O cuidado com a volta certa

Cada volta é identificada pelos quadros que **anunciam** o tempo dela, e esses quadros já pertencem à volta **seguinte**: na captura real, a volta 2 inteira carrega `last_lap_s = 104.015`, que é o tempo da volta 1. Um `max(speed_kmh)` direto no agrupamento das voltas daria a máxima da volta errada — na captura, 300,6 km/h em vez dos 297,2 km/h reais da volta 1.

A consulta de voltas agora calcula a máxima por `lap_number` no Grail e casa com `lap_number - 1` (a volta concluída) via `lookup`, usando o mesmo corte de quadros de teleporte/batida (0–400 km/h) do `parseEvents`.

## Técnico

- `Dashboard.tsx`: `LAPS` ganha o `lookup` com `top_speed_kmh`; coluna `TOP_SPEED_COLUMN` compartilhada pelas duas tabelas.
- `racing.ts`: `Telemetry.top_speed_kmh` opcional, parseado com o mesmo corte de `speed_kmh`.
- DQL validada (sintaxe) e o casamento `lap_number - 1` conferido com dados sintéticos: a volta de 104 s recebe 297,2 km/h, e um quadro de 999 km/h é descartado.
- `npm test` (60/60), `npm run lint`, `tsc` limpos.
