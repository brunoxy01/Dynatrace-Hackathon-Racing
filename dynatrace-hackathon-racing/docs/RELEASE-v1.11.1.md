# v1.11.1 — Selo de volta dentro do card, colunas alinhadas

Ajuste em cima da v1.11.0, confirmado com 2 rigs reais enviando telemetria ao mesmo tempo para o tenant: em colunas estreitas (2+ pilotos lado a lado), o selo "Volta concluída" não cabia numa linha só ao lado de "Telemetria do piloto" e vazava pra fora do card. As colunas de cada piloto também não terminavam na mesma altura.

## O que mudou

- O cabeçalho "Telemetria do piloto" agora quebra linha quando o selo de volta concluída não cabe ao lado — o selo fica sempre dentro do card, nunca vazando.
- As colunas de piloto (quando há 2+ lado a lado) agora esticam para a mesma altura, então as caixas terminam alinhadas embaixo.

## Técnico

- `strato-theme.css`: `.volta-concluida` perde o `white-space:nowrap`.
- `racing.css`: `.telemetry-panel .panel-heading{flex-wrap:wrap}`; `.hero-grid-multi` troca `align-items:flex-start` por `stretch` (o `.telemetry-panel` já era `flex:1` dentro da coluna, então a coluna inteira passa a esticar até a altura da mais alta do grupo).
- Validado com telemetria real: 2 rigs do ensaio local enviando para o tenant ao mesmo tempo (bizevents + logs, sem erros), confirmando os 2 cartões lado a lado antes do ajuste de alinhamento e depois dele.
- `npm run lint`, `npm test` (79/79) e `npm run build` limpos.
