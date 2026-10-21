# v1.10.12 — Placar na hora, posição da volta, diferença para a melhor e velocidade sem picos

Só o app mudou (**1.10.11 → 1.10.12**). O pacote do rig é o mesmo da v1.10.8.

## Placar atualiza assim que a volta termina

Antes, a volta aparecia cravada no painel do piloto, mas só entrava no placar na próxima consulta ao Grail (a cada 15 s, mais o tempo da consulta). Agora, no instante em que a bolinha cruza a linha:

- a volta entra **na hora** na classificação e no pódio, montada com a telemetria que o Ao vivo já tem (tempo, setores, velocidade máxima);
- a consulta das voltas é refeita no mesmo momento. Quando o Grail devolve a volta (mesmo timestamp), a linha dele substitui a local.

Vale para qualquer piloto na pista, não só o que está em foco. Voltas que já tinham terminado quando o Ao vivo abriu não disparam nada.

## Posição junto do tempo da volta

O cabeçalho da "Telemetria do piloto" mostra a posição da volta no período: **"Volta concluída 2º · 1:41.940"**.

## Coluna "Diferença"

Na classificação, logo depois de "Tempo": quanto cada volta ficou atrás da mais rápida do período (ex.: **+0.800**). A primeira mostra "—". A coluna ordena como número.

## Velocidade máxima sem picos

A velocidade máxima de cada volta passa a ser a **terceira maior amostra**, e não a maior. Teleporte de reinício ou batida geram um ou dois quadros absurdos, como os 386,2 km/h num Porsche Cup. Na reta, a velocidade real se mantém por vários quadros a décimos do máximo, então a terceira maior é praticamente a mesma velocidade.

Testado no Grail: uma volta com um pico de 386,2 sai com 249,0; uma volta normal sai com 251,8 contra máximo de 251,9. O `percentile()` do Grail também ignorava o pico, mas é aproximado (deu 250,6 numa volta de 249,0), por isso não foi usado. O mesmo critério vale para o KPI "Velocidade máxima" do Ao vivo.

## Técnico

- `racing.ts`: `topSpeedOf` (terceira maior amostra), `lapCompletions` (voltas concluídas numa trilha, no formato das linhas da consulta) e o helper `fechaVolta`, compartilhado com `recentLapResult`.
- `Dashboard.tsx`: `LAPS` com `collectArray` + `arraySort(...)[2]`; `DetectorDeVoltas` assina o relógio do Ao vivo, insere a volta localmente e refaz a consulta; coluna "Diferença" (`gap_s`); posição no cabeçalho da telemetria.
- `npm test` (74/74), `npm run lint`, `tsc` e `npm run build` limpos; DQL validada.
