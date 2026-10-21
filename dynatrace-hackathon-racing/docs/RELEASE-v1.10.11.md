# v1.10.11 — Tempo da volta concluída cravado no painel do piloto

Só o app mudou (**1.10.10 → 1.10.11**). O pacote do rig é o mesmo da v1.10.8.

## O que aparece

- Assim que o carro cruza a linha, o cabeçalho do quadro **"Telemetria do piloto"** mostra **"Volta concluída 1:41.940"**: o tempo **oficial** da volta, informado pelo jogo, cravado e destacado. Fica por até **1 minuto**, ou até a próxima volta fechar.
- O campo **"Tempo de volta"** continua correndo como relógio para a volta nova.
- O texto **"Última leitura · últimos 2 min"** saiu do cabeçalho da telemetria e foi para o quadro **"Piloto na pista"**.

## Como a conclusão é detectada

É o quadro em que o tempo da última volta muda **e** o cronômetro do jogo zera (ou o quadro anterior já estava no tempo da volta). Sem essa checagem, um coletor reiniciado no meio da volta "reanuncia" o último tempo, e o painel mostraria uma volta antiga como recém-concluída.

A leitura acompanha o relógio do Ao vivo: o tempo aparece no mesmo instante em que a bolinha cruza a linha no mapa.

## Técnico

- `racing.ts`: `recentLapResult` e `LAP_RESULT_HOLD_MS` (60 s).
- `Dashboard.tsx`: `TelemetriaAoVivo` repassa a volta concluída; o cabeçalho da telemetria a exibe; o subtítulo foi para o quadro do piloto.
- Testes novos: tempo cravado logo depois da linha, por até 1 minuto, e nenhum falso "volta concluída" para um tempo reanunciado no meio da volta. `npm test` (72/72), `npm run lint`, `tsc` limpos.
