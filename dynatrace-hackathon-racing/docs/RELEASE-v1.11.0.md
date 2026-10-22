# v1.11.0 — Um cartão por piloto no Ao vivo

Com 2 (ou mais) simuladores rodando ao mesmo tempo, o painel "Piloto na pista" mostrava só **um** piloto — o da amostra mais recente. Os outros ficavam de fora, mesmo transmitindo normalmente.

## O que mudou

- A aba **Ao vivo** agora mostra **um cartão completo por piloto com telemetria fresca** (ficha + telemetria ao vivo própria), não só o mais recente. Sem limite de quantidade: cabe 2, 3 ou quantos simuladores estiverem ativos.
- "Fresco" usa a mesma janela de 60s já usada pelo indicador de pulso ("Ao vivo · N amostras/min") — quem não manda nada há mais de um minuto sai da lista, do mesmo jeito que já "sumia" silenciosamente antes.
- Com um piloto só (ou nenhum), o comportamento é idêntico ao de antes — um cartão, igual sempre foi.
- Escolher um piloto específico no seletor "Todos os pilotos" continua mostrando só aquele, como já era — a lista de vários cartões é só para "Todos os pilotos" com mais de um ativo.

## Técnico

- `racing.ts`: nova função pura `activeDrivers(drivers, now, windowMs)` — filtra e ordena por mais recente primeiro. 2 testes novos (79 no total, eram 77).
- `Dashboard.tsx`: `painelDoPiloto` ganha `cartaoDoPiloto` (extraído do card único de antes) e, quando há 2+ pilotos ativos no Ao vivo com "Todos os pilotos" selecionado, mapeia um `cartaoDoPiloto` + `TelemetriaAoVivo` por piloto em vez de um só `focus`.
- Validado localmente: patch temporário fazendo o Script local (4 participantes simultâneos da demonstração) passar pelo mesmo caminho do Ao vivo confirmou os 4 cartões empilhados, cada um com a própria telemetria rodando; revertido antes do commit.
- `npm run lint`, `npm test` (79/79) e `npm run build` limpos.
