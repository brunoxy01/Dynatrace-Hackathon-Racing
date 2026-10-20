# v1.10.2 — Mapa do Ao vivo ~3s mais perto do jogo

App (**1.10.1 → 1.10.2**) e pacote do rig.

## Por que o Ao vivo andava ~10s atrás do jogo

Medido no rig com `sink = bizevents`: cerca de 10s entre o jogo e o mapa. A maior parte disso era proposital — o carro no mapa anda em tempo real sobre as amostras recebidas, mas **8s atrás da amostra mais nova** (`PLAYBACK_TRAIL_MS`), para a animação não alcançar o fim dos dados e travar entre uma consulta e outra. Esse valor tinha sido dimensionado para a recarga antiga de 5s.

## O que mudou

- Rastro do mapa **8s → 5s**.
- Recarga da telemetria do Ao vivo **3s → 2s**. A consulta cobre só os últimos 2 minutos (barata) e, desde a 1.10.1, a troca de dados não aparece na tela.

A regra é rastro ≥ recarga + variação do atraso de ingestão. Com 2s de recarga, 5s de rastro cobre a ingestão variando de 1s a 3,5s sem o carro parar. Atraso esperado jogo → mapa: **~6–7s**.

## Pacote do rig: padrão volta para bizevents

`sink = bizevents` no `racing.ini` do pacote, no `config.exemplo.bat` e no fallback do executável. É o caminho confirmado entregando no tenant do evento; o OTLP depende de o token ter `logs.ingest`. Quem já tem `racing.ini` não é afetado.

## Técnico

- `racing.ts`: `PLAYBACK_TRAIL_MS` e `TELEMETRY_REFRESH_MS` saem do `TrackMap.tsx` / `Dashboard.tsx` e passam a ser exportados, para o teste usar os valores reais.
- Novo teste de regime: recarga real, atraso de ingestão alternando entre 1s e 3,5s (incluindo o pior salto), 60 ciclos — sem o carro congelar, sem ressincronizar. Com 3s de recarga e 5s de rastro esse teste falha, por isso a recarga foi junto para 2s.
- `npm test` (59/59), `npm run lint`, `tsc` e os testes Python limpos.
