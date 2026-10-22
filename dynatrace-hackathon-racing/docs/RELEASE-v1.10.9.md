# v1.10.9 — Ao vivo rodando como relógio

Só o app mudou (**1.10.8 → 1.10.9**). O pacote do rig é o mesmo da v1.10.8.

## O que estava errado

- **O contador de tempo saltava.** O painel "Telemetria do piloto" mostrava a amostra **mais nova** que chegou do Grail, não a amostra no ponto em que a bolinha estava. A cada recarga (2 s) o tempo de volta pulava uns 2 s e ficava parado até a próxima.
- **O carro travava de vez em quando.** Desde a v1.10.2 o carro andava um atraso **fixo** de 5 s atrás da amostra mais nova. Quando a ingestão do Grail oscilava mais que isso, o carro alcançava o fim dos dados e parava até a próxima consulta. Com 8 s, antes, isso quase não acontecia.
- **Engasgo a cada recarga.** As cinco análises da aba Dynatrace Intelligence eram recalculadas a cada 2 s mesmo com o Ao vivo aberto.

## O que mudou

- **Um relógio só** para o carro no mapa e para o painel do piloto: os dois mostram o mesmo instante. O tempo de volta anda como relógio entre as amostras.
- **Atraso adaptativo.** O relógio mede como os dados estão chegando (o maior atraso de ingestão e o maior intervalo entre blocos nos últimos ~30 s) e se mantém com a folga necessária para não alcançar o fim dos dados. Para ajustar, acelera ou desacelera no máximo 8%, de forma imperceptível, em vez de travar ou pular. O atraso total passa a acompanhar a rede: menor com a ingestão estável, maior quando ela oscila.
- **60 quadros por segundo** (`requestAnimationFrame`) em vez de passos de 50 ms. Só o carro e o painel de telemetria redesenham a cada quadro; mapa de calor e tabelas, não.
- **Análises da Intelligence** calculadas só na própria aba.

## Técnico

- `liveClock.ts` (novo): relógio compartilhado, fora do estado do React, assinado com `useSyncExternalStore`.
- `racing.ts`: `liveDelay`, `stepLiveClock` e `lapTimeAt`.
- `TrackMap.tsx`: marcadores usam o relógio compartilhado (sem transição CSS no Ao vivo); calor cortado no instante do relógio.
- `Dashboard.tsx`: `TelemetriaAoVivo` lê a amostra e o tempo de volta no instante do relógio; análises da Intelligence condicionadas à aba.
- Teste de regime quadro a quadro (60 fps, 2 minutos): recarga de 2 s com latência de consulta variável e ingestão de 1 a 3,5 s com pico de 5 s. Zero travadas, zero pulos, ritmo sempre entre 0,92× e 1,08×.
- `npm test` (70/70), `npm run lint`, `tsc` e `npm run build` limpos.
